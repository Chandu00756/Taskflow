package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"

	"github.com/chanduchitikam/task-management-system/pkg/cache"
	notificationpb "github.com/chanduchitikam/task-management-system/proto/notification"
	"github.com/chanduchitikam/task-management-system/services/notification/models"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// // // NotificationService implements the NotificationService gRPC service
type NotificationService struct {
	notificationpb.UnimplementedNotificationServiceServer
	db          *gorm.DB
	redis       *cache.RedisClient
	subscribers map[string][]chan *notificationpb.NotificationEvent
	mu          sync.RWMutex
	// psub holds the pattern subscription so it can be closed on shutdown
	psub *redis.PubSub
	// providers deliver notifications to external channels
	providers []Provider
}

// // // NewNotificationService creates a new NotificationService instance
func NewNotificationService(db *gorm.DB, redisClient *cache.RedisClient, providers ...Provider) *NotificationService {
	s := &NotificationService{
		db:          db,
		redis:       redisClient,
		subscribers: make(map[string][]chan *notificationpb.NotificationEvent),
		providers:   providers,
	}

	// start redis subscriber to forward published notifications to local subscribers
	if redisClient != nil {
		go s.startRedisSubscriber(context.Background())
	}

	return s
}

// // // SubscribeToNotifications handles bidirectional streaming for notifications
func (s *NotificationService) SubscribeToNotifications(stream notificationpb.NotificationService_SubscribeToNotificationsServer) error {
	ctx := stream.Context()

	// 	// 	// Receive initial subscription request
	req, err := stream.Recv()
	if err != nil {
		return status.Error(codes.InvalidArgument, "failed to receive subscription request")
	}

	userID := req.UserId
	if userID == "" {
		return status.Error(codes.InvalidArgument, "user_id is required")
	}

	log.Printf("User %s subscribed to notifications", userID)

	// 	// 	// Create a channel for this subscriber
	notifChan := make(chan *notificationpb.NotificationEvent, 100)

	// 	// 	// Register subscriber
	s.mu.Lock()
	s.subscribers[userID] = append(s.subscribers[userID], notifChan)
	s.mu.Unlock()

	// 	// 	// Cleanup on disconnect
	defer func() {
		s.mu.Lock()
		channels := s.subscribers[userID]
		for i, ch := range channels {
			if ch == notifChan {
				s.subscribers[userID] = append(channels[:i], channels[i+1:]...)
				break
			}
		}
		if len(s.subscribers[userID]) == 0 {
			delete(s.subscribers, userID)
		}
		s.mu.Unlock()
		close(notifChan)
		log.Printf("User %s unsubscribed from notifications", userID)
	}()

	// 	// 	// Handle incoming messages and outgoing notifications concurrently
	errChan := make(chan error, 2)

	// 	// 	// Goroutine to receive messages from client (for keep-alive or future features)
	go func() {
		for {
			_, err := stream.Recv()
			if err == io.EOF {
				errChan <- nil
				return
			}
			if err != nil {
				errChan <- err
				return
			}
		}
	}()

	// 	// 	// Goroutine to send notifications to client
	go func() {
		for {
			select {
			case <-ctx.Done():
				errChan <- ctx.Err()
				return
			case notif := <-notifChan:
				if err := stream.Send(notif); err != nil {
					errChan <- err
					return
				}
			}
		}
	}()

	// 	// 	// Wait for either goroutine to finish
	return <-errChan
}

// // // SendNotification sends a notification to a user
func (s *NotificationService) SendNotification(ctx context.Context, req *notificationpb.SendNotificationRequest) (*notificationpb.SendNotificationResponse, error) {
	if req.UserId == "" || req.Title == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id and title are required")
	}

	// 	// 	// Convert metadata to JSON
	metadataJSON := "{}"
	if len(req.Metadata) > 0 {
		metadataBytes, err := json.Marshal(req.Metadata)
		if err != nil {
			return nil, status.Error(codes.Internal, "failed to marshal metadata")
		}
		metadataJSON = string(metadataBytes)
	}

	// 	// 	// Save notification to database
	notification := &models.Notification{
		UserID:        req.UserId,
		Type:          s.typeToString(req.Type),
		Title:         req.Title,
		Message:       req.Message,
		TaskID:        req.TaskId,
		RelatedUserID: req.RelatedUserId,
		Read:          false,
		Metadata:      metadataJSON,
	}

	if err := s.db.Create(notification).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to create notification")
	}

	// 	// 	// Broadcast to subscribed clients
	event := s.modelToProto(notification, req.Metadata)
	s.broadcastNotification(req.UserId, event)

	// publish to redis so other instances can deliver to their subscribers
	if s.redis != nil {
		payload, err := protojson.Marshal(event)
		if err != nil {
			log.Printf("failed to marshal notification event for publish: %v", err)
		} else {
			channel := fmt.Sprintf("notifications:%s", req.UserId)
			if err := s.redis.Publish(ctx, channel, string(payload)); err != nil {
				log.Printf("failed to publish notification to redis: %v", err)
			}
		}
	}

	// check user preferences before enqueueing for external delivery
	deliverToProviders := true
	var pref models.NotificationPreference
	if err := s.db.Where("user_id = ?", req.UserId).First(&pref).Error; err == nil {
		var channels map[string]bool
		if err := json.Unmarshal([]byte(pref.Channels), &channels); err == nil {
			if enabled, ok := channels["push"]; ok && !enabled {
				deliverToProviders = false
			}
		}
	}

	// append to a durable Redis Stream for workers to process (durable delivery)
	if s.redis != nil && deliverToProviders {
		if payload, err := protojson.Marshal(event); err == nil {
			values := map[string]interface{}{
				"user_id": req.UserId,
				"payload": string(payload),
			}
			if _, err := s.redis.XAdd(ctx, "notifications:stream", values); err != nil {
				log.Printf("failed to XAdd notification to stream: %v", err)
			}
		} else {
			log.Printf("failed to marshal notification event for stream: %v", err)
		}
	}

	return &notificationpb.SendNotificationResponse{
		NotificationId: notification.ID,
		Message:        "Notification sent successfully",
	}, nil
}

// startRedisSubscriber subscribes to Redis notifications pattern and forwards them to local subscribers
func (s *NotificationService) startRedisSubscriber(ctx context.Context) {
	if s.redis == nil {
		return
	}
	psub := s.redis.PSubscribe(ctx, "notifications:*")
	s.psub = psub
	ch := psub.Channel()
	log.Printf("notification redis subscriber started")

	for msg := range ch {
		// extract user id from channel name notifications:{userID}
		userID := strings.TrimPrefix(msg.Channel, "notifications:")
		if userID == "" {
			continue
		}

		var event notificationpb.NotificationEvent
		if err := protojson.Unmarshal([]byte(msg.Payload), &event); err != nil {
			log.Printf("failed to unmarshal notification payload: %v", err)
			continue
		}

		s.broadcastNotification(userID, &event)
	}

	log.Printf("notification redis subscriber stopped")
}

// Shutdown closes any background resources (redis subscription/client)
func (s *NotificationService) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.psub != nil {
		if err := s.psub.Close(); err != nil {
			log.Printf("error closing redis pubsub: %v", err)
		}
		s.psub = nil
	}

	if s.redis != nil {
		if err := s.redis.Close(); err != nil {
			log.Printf("error closing redis client: %v", err)
		}
		s.redis = nil
	}

	return nil
}

// // // GetNotifications retrieves notification history
func (s *NotificationService) GetNotifications(ctx context.Context, req *notificationpb.GetNotificationsRequest) (*notificationpb.GetNotificationsResponse, error) {
	if req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	page := req.Page
	if page < 1 {
		page = 1
	}

	pageSize := req.PageSize
	if pageSize < 1 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	query := s.db.Model(&models.Notification{}).Where("user_id = ?", req.UserId)

	if req.UnreadOnly {
		query = query.Where("read = ?", false)
	}

	// 	// 	// Get total and unread counts
	var totalCount, unreadCount int64
	if err := query.Count(&totalCount).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to count notifications")
	}

	if err := s.db.Model(&models.Notification{}).Where("user_id = ? AND read = ?", req.UserId, false).Count(&unreadCount).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to count unread notifications")
	}

	// 	// 	// Get notifications
	var notifications []models.Notification
	if err := query.Offset(int(offset)).Limit(int(pageSize)).Order("created_at DESC").Find(&notifications).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to get notifications")
	}

	// 	// 	// Convert to proto
	protoNotifications := make([]*notificationpb.NotificationEvent, len(notifications))
	for i, notif := range notifications {
		var metadata map[string]string
		if err := json.Unmarshal([]byte(notif.Metadata), &metadata); err != nil {
			metadata = make(map[string]string)
		}
		protoNotifications[i] = s.modelToProto(&notif, metadata)
	}

	return &notificationpb.GetNotificationsResponse{
		Notifications: protoNotifications,
		TotalCount:    int32(totalCount),
		UnreadCount:   int32(unreadCount),
	}, nil
}

// // // MarkAsRead marks a notification as read
func (s *NotificationService) MarkAsRead(ctx context.Context, req *notificationpb.MarkAsReadRequest) (*notificationpb.MarkAsReadResponse, error) {
	if req.NotificationId == "" {
		return nil, status.Error(codes.InvalidArgument, "notification_id is required")
	}

	var notification models.Notification
	if err := s.db.Where("id = ? AND user_id = ?", req.NotificationId, req.UserId).First(&notification).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "notification not found")
		}
		return nil, status.Error(codes.Internal, "failed to find notification")
	}

	notification.Read = true
	if err := s.db.Save(&notification).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to mark notification as read")
	}

	return &notificationpb.MarkAsReadResponse{
		Message: "Notification marked as read",
	}, nil
}

// // // Helper methods

func (s *NotificationService) broadcastNotification(userID string, event *notificationpb.NotificationEvent) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	channels, exists := s.subscribers[userID]
	if !exists {
		log.Printf("No subscribers for user %s", userID)
		return
	}

	log.Printf("Broadcasting notification to %d subscribers for user %s", len(channels), userID)

	for _, ch := range channels {
		select {
		case ch <- event:
		default:
			log.Printf("Channel full for user %s, skipping notification", userID)
		}
	}
}

func (s *NotificationService) modelToProto(notif *models.Notification, metadata map[string]string) *notificationpb.NotificationEvent {
	return &notificationpb.NotificationEvent{
		NotificationId: notif.ID,
		UserId:         notif.UserID,
		Type:           s.stringToType(notif.Type),
		Title:          notif.Title,
		Message:        notif.Message,
		TaskId:         notif.TaskID,
		RelatedUserId:  notif.RelatedUserID,
		CreatedAt:      timestamppb.New(notif.CreatedAt),
		Read:           notif.Read,
		Metadata:       metadata,
	}
}

// ProcessStreamEvent performs delivery for events coming from the stream/worker
func (s *NotificationService) ProcessStreamEvent(ctx context.Context, event *notificationpb.NotificationEvent) error {
	// broadcast to any connected local subscribers
	s.broadcastNotification(event.UserId, event)

	// deliver to external providers (run serially to allow error handling; providers should be lightweight)
	for _, p := range s.providers {
		if err := p.Deliver(ctx, event); err != nil {
			log.Printf("provider delivery error for notification %s: %v", event.NotificationId, err)
		}
	}

	return nil
}

func (s *NotificationService) typeToString(t notificationpb.NotificationType) string {
	switch t {
	case notificationpb.NotificationType_NOTIFICATION_TYPE_TASK_ASSIGNED:
		return "task_assigned"
	case notificationpb.NotificationType_NOTIFICATION_TYPE_TASK_UPDATED:
		return "task_updated"
	case notificationpb.NotificationType_NOTIFICATION_TYPE_TASK_COMPLETED:
		return "task_completed"
	case notificationpb.NotificationType_NOTIFICATION_TYPE_TASK_COMMENT:
		return "task_comment"
	case notificationpb.NotificationType_NOTIFICATION_TYPE_TASK_DUE_SOON:
		return "task_due_soon"
	case notificationpb.NotificationType_NOTIFICATION_TYPE_TASK_OVERDUE:
		return "task_overdue"
	default:
		return "unknown"
	}
}

func (s *NotificationService) stringToType(t string) notificationpb.NotificationType {
	switch t {
	case "task_assigned":
		return notificationpb.NotificationType_NOTIFICATION_TYPE_TASK_ASSIGNED
	case "task_updated":
		return notificationpb.NotificationType_NOTIFICATION_TYPE_TASK_UPDATED
	case "task_completed":
		return notificationpb.NotificationType_NOTIFICATION_TYPE_TASK_COMPLETED
	case "task_comment":
		return notificationpb.NotificationType_NOTIFICATION_TYPE_TASK_COMMENT
	case "task_due_soon":
		return notificationpb.NotificationType_NOTIFICATION_TYPE_TASK_DUE_SOON
	case "task_overdue":
		return notificationpb.NotificationType_NOTIFICATION_TYPE_TASK_OVERDUE
	default:
		return notificationpb.NotificationType_NOTIFICATION_TYPE_UNSPECIFIED
	}
}

// // // BroadcastTaskAssignment is a helper to broadcast task assignment notifications
func (s *NotificationService) BroadcastTaskAssignment(userID, taskID, title string) error {
	_, err := s.SendNotification(context.Background(), &notificationpb.SendNotificationRequest{
		UserId:  userID,
		Type:    notificationpb.NotificationType_NOTIFICATION_TYPE_TASK_ASSIGNED,
		Title:   "New Task Assigned",
		Message: fmt.Sprintf("You have been assigned to task: %s", title),
		TaskId:  taskID,
	})
	return err
}
