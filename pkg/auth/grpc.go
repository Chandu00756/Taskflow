package auth

import (
	"context"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

// identityKeys are metadata keys that carry caller identity. They are only
// trusted when derived from a verified JWT, never from the raw request.
var identityKeys = []string{
	"user_id", "user-id", "x-user-id",
	"org_id", "org-id", "x-org-id",
	"role", "x-role",
	"email", "x-email",
}

// IdentityFromMetadata validates the bearer token carried in the incoming
// metadata and returns its claims, or nil when no valid token is present.
func IdentityFromMetadata(md metadata.MD, jwtManager *JWTManager) *Claims {
	if jwtManager == nil {
		return nil
	}
	for _, raw := range md.Get("authorization") {
		token := strings.TrimSpace(raw)
		if len(token) > 7 && strings.EqualFold(token[:7], "bearer ") {
			token = strings.TrimSpace(token[7:])
		}
		if token == "" {
			continue
		}
		if claims, err := jwtManager.ValidateToken(token); err == nil {
			return claims
		}
	}
	return nil
}

// WithVerifiedIdentity rebuilds the incoming context so that identity values
// (both context values and metadata keys) come exclusively from a verified
// JWT. Any identity metadata supplied by the client is discarded.
func WithVerifiedIdentity(ctx context.Context, jwtManager *JWTManager) context.Context {
	md, _ := metadata.FromIncomingContext(ctx)
	clean := md.Copy()
	if clean == nil {
		clean = metadata.MD{}
	}
	for _, k := range identityKeys {
		delete(clean, k)
		delete(clean, "grpc-metadata-"+k)
	}

	claims := IdentityFromMetadata(md, jwtManager)
	if claims != nil {
		clean.Set("user_id", claims.UserID)
		clean.Set("user-id", claims.UserID)
		clean.Set("x-user-id", claims.UserID)
		clean.Set("org_id", claims.OrgID)
		clean.Set("org-id", claims.OrgID)
		clean.Set("x-org-id", claims.OrgID)
		clean.Set("role", claims.Role)
		clean.Set("x-role", claims.Role)
		clean.Set("email", claims.Email)
	}
	ctx = metadata.NewIncomingContext(ctx, clean)

	if claims != nil {
		//nolint:staticcheck // string keys are read across existing services
		ctx = context.WithValue(ctx, "user_id", claims.UserID)
		//nolint:staticcheck
		ctx = context.WithValue(ctx, "org_id", claims.OrgID)
		//nolint:staticcheck
		ctx = context.WithValue(ctx, "role", claims.Role)
		//nolint:staticcheck
		ctx = context.WithValue(ctx, "email", claims.Email)
	}
	return ctx
}

// UnaryIdentityInterceptor injects verified caller identity into every unary
// RPC. Handlers keep enforcing their own authorization rules.
func UnaryIdentityInterceptor(jwtManager *JWTManager) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		return handler(WithVerifiedIdentity(ctx, jwtManager), req)
	}
}

// StreamIdentityInterceptor is the streaming counterpart of UnaryIdentityInterceptor.
func StreamIdentityInterceptor(jwtManager *JWTManager) grpc.StreamServerInterceptor {
	return func(srv interface{}, ss grpc.ServerStream, _ *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
		return handler(srv, &identityStream{ServerStream: ss, ctx: WithVerifiedIdentity(ss.Context(), jwtManager)})
	}
}

type identityStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (s *identityStream) Context() context.Context { return s.ctx }

// IsPlatformAdmin reports whether a role is the platform-wide super admin.
func IsPlatformAdmin(role string) bool { return role == "super_admin" }

// IsOrgAdminRole reports whether a role administers its organization.
// "admin" is the legacy name used by self-registered org owners.
func IsOrgAdminRole(role string) bool { return role == "org_admin" || role == "admin" }
