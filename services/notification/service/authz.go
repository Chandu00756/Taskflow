package service

import (
	"context"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	notificationpb "github.com/chanduchitikam/task-management-system/proto/notification"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

func callerFrom(ctx context.Context) (userID, orgID, role string) {
	userID, _ = ctx.Value("user_id").(string)
	orgID, _ = ctx.Value("org_id").(string)
	role, _ = ctx.Value("role").(string)
	return
}

// AuthzUnaryInterceptor enforces that callers only read and modify their own
// notifications and only notify users inside their own organization. It runs
// after auth.UnaryIdentityInterceptor, so identity values are trusted.
func AuthzUnaryInterceptor(db *gorm.DB) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		userID, orgID, role := callerFrom(ctx)
		if userID == "" {
			return nil, status.Error(codes.Unauthenticated, "authentication required")
		}
		platformAdmin := auth.IsPlatformAdmin(role)

		switch r := req.(type) {
		case *notificationpb.GetNotificationsRequest:
			if r.UserId == "" {
				r.UserId = userID
			}
			if r.UserId != userID && !platformAdmin {
				return nil, status.Error(codes.PermissionDenied, "cannot read another user's notifications")
			}
		case *notificationpb.MarkAsReadRequest:
			if !platformAdmin || r.UserId == "" {
				r.UserId = userID
			}
		case *notificationpb.SendNotificationRequest:
			if !platformAdmin {
				var recipientOrg *string
				if err := db.Table("users").Select("org_id").Where("id = ?", r.UserId).Scan(&recipientOrg).Error; err != nil {
					return nil, status.Error(codes.Internal, "failed to resolve recipient")
				}
				if recipientOrg == nil || *recipientOrg != orgID {
					return nil, status.Error(codes.PermissionDenied, "recipient is outside your organization")
				}
			}
		}
		return handler(ctx, req)
	}
}

// AuthzStreamInterceptor requires an authenticated caller for streaming RPCs.
func AuthzStreamInterceptor() grpc.StreamServerInterceptor {
	return func(srv interface{}, ss grpc.ServerStream, _ *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		if userID, _, _ := callerFrom(ss.Context()); userID == "" {
			return status.Error(codes.Unauthenticated, "authentication required")
		}
		return handler(srv, ss)
	}
}
