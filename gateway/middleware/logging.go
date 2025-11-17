package middleware

import (
	"context"
	"time"

	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// // // LoggingInterceptor logs gRPC requests and responses
type LoggingInterceptor struct {
	logger *zap.Logger
}

// // // NewLoggingInterceptor creates a new logging interceptor
func NewLoggingInterceptor(logger *zap.Logger) *LoggingInterceptor {
	return &LoggingInterceptor{
		logger: logger,
	}
}

// // // Unary returns a logging interceptor for unary RPCs
func (l *LoggingInterceptor) Unary() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		start := time.Now()

		// 		// 		// Extract user info from context if available
		userID := ""
		if id, ok := ctx.Value("user_id").(string); ok {
			userID = id
		}

		// 		// 		// Call handler
		resp, err := handler(ctx, req)

		// 		// 		// Log the request
		duration := time.Since(start)
		code := codes.OK
		if err != nil {
			if st, ok := status.FromError(err); ok {
				code = st.Code()
			}
		}

		l.logger.Info("gRPC request",
			zap.String("method", info.FullMethod),
			zap.String("user_id", userID),
			zap.Duration("duration", duration),
			zap.String("code", code.String()),
			zap.Error(err),
		)

		return resp, err
	}
}
