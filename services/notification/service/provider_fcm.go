package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	notificationpb "github.com/chanduchitikam/task-management-system/proto/notification"
)

// FCMProvider sends notifications via Firebase Cloud Messaging (legacy server key API)
type FCMProvider struct {
	serverKey string
	client    *http.Client
}

// NewFCMProvider creates an FCMProvider. serverKey is the legacy server key.
func NewFCMProvider(serverKey string) *FCMProvider {
	return &FCMProvider{
		serverKey: serverKey,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Deliver sends a push notification using FCM. Expects device token in event.Metadata["device_token"].
func (f *FCMProvider) Deliver(ctx context.Context, event *notificationpb.NotificationEvent) error {
	if event == nil {
		return errors.New("nil event")
	}

	// extract device token from metadata
	var deviceToken string
	if event.Metadata != nil {
		if tok, ok := event.Metadata["device_token"]; ok {
			deviceToken = tok
		}
	}
	if deviceToken == "" {
		return fmt.Errorf("missing device_token in metadata for notification %s", event.NotificationId)
	}

	payload := map[string]interface{}{
		"to": deviceToken,
		"notification": map[string]string{
			"title": event.Title,
			"body":  event.Message,
		},
		"data": event.Metadata,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal fcm payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", "https://fcm.googleapis.com/fcm/send", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "key="+f.serverKey)
	req.Header.Set("Content-Type", "application/json")
	req.Body = http.NoBody
	// attach body via reader
	req.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(body)), nil }
	req.ContentLength = int64(len(body))

	// Workaround: use http.NewRequestWithContext with body reader directly
	req, err = http.NewRequestWithContext(ctx, "POST", "https://fcm.googleapis.com/fcm/send", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "key="+f.serverKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := f.client.Do(req)
	if err != nil {
		return fmt.Errorf("fcm request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("fcm returned non-200 status: %d", resp.StatusCode)
	}

	return nil
}
