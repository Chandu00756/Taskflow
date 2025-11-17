package sentry

import (
	"fmt"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/config"
	"github.com/getsentry/sentry-go"
)

// // // InitSentry initializes Sentry for error tracking
func InitSentry(cfg *config.Config, serviceName string) error {
	err := sentry.Init(sentry.ClientOptions{
		Dsn:              cfg.Sentry.DSN,
		Environment:      cfg.Server.Environment,
		Release:          fmt.Sprintf("%s@%s", serviceName, cfg.Sentry.Release),
		TracesSampleRate: cfg.Sentry.TracesSampleRate,

		// 		// 		// Attach stack traces
		AttachStacktrace: true,

		// 		// 		// Configure before send hook
		BeforeSend: func(event *sentry.Event, hint *sentry.EventHint) *sentry.Event {
			// 			// 			// Filter out sensitive data
			if event.Request != nil {
				// 				// 				// Remove sensitive headers
				delete(event.Request.Headers, "Authorization")
				delete(event.Request.Headers, "Cookie")
				delete(event.Request.Headers, "X-Api-Key")
			}

			// 			// 			// Add custom tags
			event.Tags["service"] = serviceName
			event.Tags["go_version"] = cfg.Sentry.GoVersion

			return event
		},

		// 		// 		// Configure integrations
		Integrations: func(integrations []sentry.Integration) []sentry.Integration {
			// 			// 			// Add custom integrations here
			return integrations
		},
	})

	if err != nil {
		return fmt.Errorf("failed to initialize Sentry: %w", err)
	}

	return nil
}

// // // Flush flushes the Sentry buffer
func Flush() {
	sentry.Flush(2 * time.Second)
}

// // // CaptureError captures an error and sends it to Sentry
func CaptureError(err error, tags map[string]string, extra map[string]interface{}) {
	sentry.WithScope(func(scope *sentry.Scope) {
		// 		// 		// Add tags
		for key, value := range tags {
			scope.SetTag(key, value)
		}

		// 		// 		// Add extra context
		for key, value := range extra {
			scope.SetExtra(key, value)
		}

		sentry.CaptureException(err)
	})
}

// // // CaptureMessage captures a message and sends it to Sentry
func CaptureMessage(message string, level sentry.Level, tags map[string]string) {
	sentry.WithScope(func(scope *sentry.Scope) {
		scope.SetLevel(level)

		for key, value := range tags {
			scope.SetTag(key, value)
		}

		sentry.CaptureMessage(message)
	})
}

// // // RecoverPanic recovers from a panic and sends it to Sentry
func RecoverPanic() {
	if err := recover(); err != nil {
		sentry.CurrentHub().Recover(err)
		sentry.Flush(2 * time.Second)
		panic(err) // Re-panic after capturing
	}
}
