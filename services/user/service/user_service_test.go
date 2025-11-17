package service

import (
	"context"
	"testing"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	userpb "github.com/chanduchitikam/task-management-system/proto/user"
	"github.com/chanduchitikam/task-management-system/services/user/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
	authCtx = context.WithValue(authCtx, "org_id", created.OrgID)

	resp, err := service.GetUser(authCtx, getReq)
	require.NoError(t, err)
	assert.NotNil(t, resp)
	assert.Equal(t, "test@example.com", resp.User.Email)
}
