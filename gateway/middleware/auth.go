package middleware

import (
	"context"
	"strings"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// AuthInterceptor intercepts requests to validate JWT tokens
type AuthInterceptor struct {
	jwtManager *auth.JWTManager
	publicMethods map[string]bool
}

// NewAuthInterceptor creates a new auth interceptor
func NewAuthInterceptor(jwtManager *auth.JWTManager) *AuthInterceptor {
	// Methods that don't require authentication
	publicMethods := map[string]bool{
		"/user.UserService/Register": true,
		"/user.UserService/Login":    true,
	}

	return &AuthInterceptor{
		jwtManager:    jwtManager,
		publicMethods: publicMethods,
	}
}

// Unary returns a server interceptor for unary RPCs
func (i *AuthInterceptor) Unary() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		// Check if method is public
		if i.publicMethods[info.FullMethod] {
			return handler(ctx, req)
		}

		// Extract and validate token
		newCtx, err := i.authorize(ctx)
		if err != nil {
			return nil, err
		}

		return handler(newCtx, req)
	}
}

// Stream returns a server interceptor for streaming RPCs
func (i *AuthInterceptor) Stream() grpc.StreamServerInterceptor {
	return func(
		srv interface{},
		stream grpc.ServerStream,
		info *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) error {
		// Check if method is public
		if i.publicMethods[info.FullMethod] {
			return handler(srv, stream)
		}

		// Extract and validate token
		newCtx, err := i.authorize(stream.Context())
		if err != nil {
			return err
		}

		wrappedStream := &wrappedServerStream{
			ServerStream: stream,
			ctx:          newCtx,
		}

		return handler(srv, wrappedStream)
	}
}

// authorize validates the JWT token from metadata
func (i *AuthInterceptor) authorize(ctx context.Context) (context.Context, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return nil, status.Error(codes.Unauthenticated, "missing metadata")
	}

	values := md["authorization"]
	if len(values) == 0 {
		return nil, status.Error(codes.Unauthenticated, "missing authorization token")
	}

	accessToken := values[0]
	// Remove "Bearer " prefix if present
	accessToken = strings.TrimPrefix(accessToken, "Bearer ")

	claims, err := i.jwtManager.ValidateToken(accessToken)
	if err != nil {
		return nil, status.Error(codes.Unauthenticated, err.Error())
	}

	// Add claims to context
	ctx = context.WithValue(ctx, "user_id", claims.UserID)
	ctx = context.WithValue(ctx, "email", claims.Email)
	ctx = context.WithValue(ctx, "role", claims.Role)

	return ctx, nil
}

// wrappedServerStream wraps a grpc.ServerStream with a custom context
type wrappedServerStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (w *wrappedServerStream) Context() context.Context {
	return w.ctx
}
