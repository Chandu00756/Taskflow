package auth

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc/metadata"
)

func TestForgedMetadataIsDiscarded(t *testing.T) {
	jwt := NewJWTManager("secret", time.Hour, time.Hour)
	md := metadata.Pairs("role", "super_admin", "x-role", "super_admin", "user_id", "attacker", "grpc-metadata-role", "super_admin")
	ctx := WithVerifiedIdentity(metadata.NewIncomingContext(context.Background(), md), jwt)
	out, _ := metadata.FromIncomingContext(ctx)
	for _, k := range []string{"role", "x-role", "user_id", "grpc-metadata-role"} {
		if len(out.Get(k)) != 0 {
			t.Fatalf("forged %s survived: %v", k, out.Get(k))
		}
	}
	if ctx.Value("role") != nil {
		t.Fatal("unauthenticated context must not carry a role")
	}
}

func TestVerifiedTokenPopulatesIdentity(t *testing.T) {
	jwt := NewJWTManager("secret", time.Hour, time.Hour)
	token, _ := jwt.GenerateAccessToken("u1", "u1@x.test", "member", "org1")
	md := metadata.Pairs("authorization", "Bearer "+token, "role", "super_admin")
	ctx := WithVerifiedIdentity(metadata.NewIncomingContext(context.Background(), md), jwt)
	if ctx.Value("role") != "member" || ctx.Value("user_id") != "u1" || ctx.Value("org_id") != "org1" {
		t.Fatalf("identity = %v %v %v", ctx.Value("role"), ctx.Value("user_id"), ctx.Value("org_id"))
	}
	out, _ := metadata.FromIncomingContext(ctx)
	if got := out.Get("role"); len(got) != 1 || got[0] != "member" {
		t.Fatalf("role metadata = %v", got)
	}
}

func TestTokenSignedWithOtherSecretIsRejected(t *testing.T) {
	other := NewJWTManager("other", time.Hour, time.Hour)
	token, _ := other.GenerateAccessToken("u1", "u1@x.test", "super_admin", "")
	md := metadata.Pairs("authorization", "Bearer "+token)
	ctx := WithVerifiedIdentity(metadata.NewIncomingContext(context.Background(), md), NewJWTManager("secret", time.Hour, time.Hour))
	if ctx.Value("role") != nil {
		t.Fatal("token signed with a different secret must be ignored")
	}
}

func TestRefreshTokensAreUnique(t *testing.T) {
	jwt := NewJWTManager("secret", time.Hour, time.Hour)
	a, _ := jwt.GenerateRefreshToken("u1")
	b, _ := jwt.GenerateRefreshToken("u1")
	if a == b {
		t.Fatal("refresh tokens minted in the same second must differ")
	}
}
