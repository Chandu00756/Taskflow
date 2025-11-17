package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"time"

	notificationpb "github.com/chanduchitikam/task-management-system/proto/notification"
	"github.com/sideshow/apns2"
	"github.com/sideshow/apns2/token"
)

// APNSProvider sends notifications via Apple Push Notification service (token-based auth)
type APNSProvider struct {
	client *apns2.Client
	topic  string
}

// NewAPNSProvider creates an APNSProvider using token credentials (.p8 key)
// keyPath should point to the .p8 file, keyID and teamID are from Apple Developer account.
// topic is the app bundle id. If sandbox is true, uses the development gateway.
func NewAPNSProvider(keyPath, keyID, teamID, topic string, sandbox bool) (*APNSProvider, error) {
	_, err := ioutil.ReadFile(keyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read apns key: %w", err)
	}
	// Use token helper to parse .p8 key
	authKey, err := token.AuthKeyFromFile(keyPath)
	if err != nil {
		return nil, fmt.Errorf("failed to parse apns auth key: %w", err)
	}

	tk := &token.Token{
		AuthKey: authKey,
		KeyID:   keyID,
		TeamID:  teamID,
	}

	apnsClient := apns2.NewTokenClient(tk)
	if sandbox {
		apnsClient = apnsClient.Development()
	}

	return &APNSProvider{client: apnsClient, topic: topic}, nil
}

// Deliver sends an APNs notification. Expects device token in event.Metadata["device_token"].
func (a *APNSProvider) Deliver(ctx context.Context, event *notificationpb.NotificationEvent) error {
	if event == nil {
		return errors.New("nil event")
	}
	var deviceToken string
	if event.Metadata != nil {
		if tok, ok := event.Metadata["device_token"]; ok {
			deviceToken = tok
		}
	}
	if deviceToken == "" {
		return fmt.Errorf("missing device_token in metadata for notification %s", event.NotificationId)
	}

	aps := map[string]interface{}{"aps": map[string]interface{}{"alert": map[string]string{"title": event.Title, "body": event.Message}}}
	payloadBytes, _ := json.Marshal(aps)

	p := &apns2.Notification{
		DeviceToken: deviceToken,
		Topic:       a.topic,
		Payload:     payloadBytes,
		Expiration:  time.Now().Add(24 * time.Hour),
	}

	res, err := a.client.Push(p)
	if err != nil {
		return fmt.Errorf("apns push failed: %w", err)
	}
	if res.StatusCode >= 400 {
		return fmt.Errorf("apns push failed status %d: %s", res.StatusCode, res.Reason)
	}
	return nil
}
