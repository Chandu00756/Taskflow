package service

import (
	"context"
	"testing"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	userpb "github.com/chanduchitikam/task-management-system/proto/user"
	"github.com/chanduchitikam/task-management-system/services/user/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)

	// Auto-migrate user, organization, and invite models so tests don't fail
	// when service code expects those tables to exist (in-memory sqlite).
	err = db.AutoMigrate(&models.User{}, &models.Organization{}, &models.Invite{})
	require.NoError(t, err)

	return db
}

func TestRegister(t *testing.T) {
	db := setupTestDB(t)
	jwtManager := auth.NewJWTManager("test-secret", 3600, 86400)
	service := NewUserService(db, jwtManager)

	req := &userpb.RegisterRequest{
		Email:    "test@example.com",
		Username: "testuser",
		Password: "password123",
		FullName: "Test User",
		Role:     userpb.UserRole_USER_ROLE_MEMBER,
	}

	resp, err := service.Register(context.Background(), req)
	require.NoError(t, err)
	assert.NotNil(t, resp)
	assert.Equal(t, "test@example.com", resp.User.Email)
	assert.Equal(t, "testuser", resp.User.Username)
}

func TestLogin(t *testing.T) {
	db := setupTestDB(t)
	jwtManager := auth.NewJWTManager("test-secret", 3600, 86400)
	service := NewUserService(db, jwtManager)

	// 	// 	// First register a user
	registerReq := &userpb.RegisterRequest{
		Email:    "test@example.com",
		Username: "testuser",
		Password: "password123",
		FullName: "Test User",
	}
	_, err := service.Register(context.Background(), registerReq)
	require.NoError(t, err)

	// 	// 	// Then login
	loginReq := &userpb.LoginRequest{
		Email:    "test@example.com",
		Password: "password123",
	}

	resp, err := service.Login(context.Background(), loginReq)
	require.NoError(t, err)
	assert.NotNil(t, resp)
	assert.NotEmpty(t, resp.AccessToken)
	assert.NotEmpty(t, resp.RefreshToken)
	assert.Equal(t, "test@example.com", resp.User.Email)
}

func TestGetUser(t *testing.T) {
	db := setupTestDB(t)
	jwtManager := auth.NewJWTManager("test-secret", 3600, 86400)
	service := NewUserService(db, jwtManager)

	// 	// 	// Register a user
	registerReq := &userpb.RegisterRequest{
		Email:    "test@example.com",
		Username: "testuser",
		Password: "password123",
		FullName: "Test User",
	}
	registerResp, err := service.Register(context.Background(), registerReq)
	require.NoError(t, err)

	//  	//  	// Get the user
	getReq := &userpb.GetUserRequest{
		UserId: registerResp.User.UserId,
	}

	// provide authentication context expected by the service
	// lookup created user in test DB to determine OrgID and role
	var created models.User
	if err := db.Where("id = ?", registerResp.User.UserId).First(&created).Error; err != nil {
		t.Fatalf("failed to lookup created user: %v", err)
	}

	roleStr := created.Role
	if roleStr == "" {
		roleStr = "member"
	}

	authCtx := context.Background()
	authCtx = context.WithValue(authCtx, "user_id", registerResp.User.UserId)
	authCtx = context.WithValue(authCtx, "email", registerResp.User.Email)
	authCtx = context.WithValue(authCtx, "role", roleStr)
	// Use the actual OrgID created by registration (may be empty for no-org scenarios)
	orgID := ""
	if created.OrgID != nil {
		orgID = *created.OrgID
	}
	authCtx = context.WithValue(authCtx, "org_id", orgID)

	resp, err := service.GetUser(authCtx, getReq)
	require.NoError(t, err)
	assert.NotNil(t, resp)
	assert.Equal(t, "test@example.com", resp.User.Email)
}

func withVerification(t *testing.T, required bool) {
	t.Helper()
	prev := verificationRequired
	verificationRequired = func() bool { return required }
	t.Cleanup(func() { verificationRequired = prev })
}

func TestLoginBlocksUnverifiedEmail(t *testing.T) {
	withVerification(t, true)
	db := setupTestDB(t)
	service := NewUserService(db, auth.NewJWTManager("test-secret", 3600, 86400))
	_, err := service.Register(context.Background(), &userpb.RegisterRequest{Email: "ann@acme.test", Username: "ann", Password: "password123", FullName: "Ann"})
	require.NoError(t, err)

	// A wrong password must not reveal that the account exists but is unverified.
	_, err = service.Login(context.Background(), &userpb.LoginRequest{Email: "ann@acme.test", Password: "nope"})
	assert.Equal(t, codes.Unauthenticated, status.Code(err))

	_, err = service.Login(context.Background(), &userpb.LoginRequest{Email: "ann@acme.test", Password: "password123"})
	assert.Equal(t, codes.FailedPrecondition, status.Code(err))
	assert.Contains(t, err.Error(), "verify your email")

	require.NoError(t, db.Model(&models.User{}).Where("email = ?", "ann@acme.test").Update("email_verification_pending", false).Error)
	resp, err := service.Login(context.Background(), &userpb.LoginRequest{Email: "ann@acme.test", Password: "password123"})
	require.NoError(t, err)
	assert.NotEmpty(t, resp.AccessToken)
}

func TestRegisterDomainClaim(t *testing.T) {
	db := setupTestDB(t)
	service := NewUserService(db, auth.NewJWTManager("test-secret", 3600, 86400))
	orgOf := func(email string) models.Organization {
		var u models.User
		require.NoError(t, db.Where("email = ?", email).First(&u).Error)
		require.NotNil(t, u.OrgID)
		var o models.Organization
		require.NoError(t, db.Where("id = ?", *u.OrgID).First(&o).Error)
		return o
	}

	// Unverified sign-ups do not claim their company domain.
	withVerification(t, true)
	_, err := service.Register(context.Background(), &userpb.RegisterRequest{Email: "a@squat.test", Username: "a1", Password: "password123"})
	require.NoError(t, err)
	assert.Nil(t, orgOf("a@squat.test").Domain)

	// Without verification the domain is claimed straight away.
	withVerification(t, false)
	_, err = service.Register(context.Background(), &userpb.RegisterRequest{Email: "b@claim.test", Username: "b1", Password: "password123"})
	require.NoError(t, err)
	if d := orgOf("b@claim.test").Domain; assert.NotNil(t, d) {
		assert.Equal(t, "claim.test", *d)
	}

	// Public providers never claim a domain; each sign-up gets its own workspace.
	_, err = service.Register(context.Background(), &userpb.RegisterRequest{Email: "c@gmail.com", Username: "c1", Password: "password123", FullName: "Cara Diaz"})
	require.NoError(t, err)
	_, err = service.Register(context.Background(), &userpb.RegisterRequest{Email: "d@gmail.com", Username: "d1", Password: "password123"})
	require.NoError(t, err, "a second gmail.com sign-up must not be blocked")
	o := orgOf("c@gmail.com")
	assert.Nil(t, o.Domain)
	assert.Equal(t, "Cara Diaz's workspace", o.Name)
}

func TestRegisterOrganizationPendingVerification(t *testing.T) {
	withVerification(t, true)
	db := setupTestDB(t)
	orgs := NewOrganizationService(db, auth.NewJWTManager("test-secret", 3600, 86400))
	org, admin, err := orgs.RegisterOrganization("Acme", "", "boss@acme.test", "Password1!", "Boss")
	require.NoError(t, err)
	assert.True(t, admin.EmailVerificationPending)
	assert.Nil(t, org.Domain, "the domain is claimed once the admin verifies")

	withVerification(t, false)
	org2, admin2, err := orgs.RegisterOrganization("Beta", "", "boss@beta.test", "Password1!", "Boss")
	require.NoError(t, err)
	assert.False(t, admin2.EmailVerificationPending)
	if assert.NotNil(t, org2.Domain) {
		assert.Equal(t, "beta.test", *org2.Domain)
	}
}
