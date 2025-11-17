package service

import (
	"context"
	"log"

	notificationpb "github.com/chanduchitikam/task-management-system/proto/notification"
)

// Provider delivers notification events to external channels (push/email/webhook)
type Provider interface {
	Deliver(ctx context.Context, event *notificationpb.NotificationEvent) error
}

// ConsoleProvider is a simple provider that logs notifications (useful for local testing)
type ConsoleProvider struct{}

func (c *ConsoleProvider) Deliver(ctx context.Context, event *notificationpb.NotificationEvent) error {
	log.Printf("[ConsoleProvider] Delivering notification %s to user %s: %s - %s", event.NotificationId, event.UserId, event.Title, event.Message)
	return nil
}
