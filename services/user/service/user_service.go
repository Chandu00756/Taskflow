package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	userpb "github.com/chanduchitikam/task-management-system/proto/user"
	"github.com/chanduchitikam/task-management-system/services/user/models"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// UserService implements the UserService gRPC service
type UserService struct {
	userpb.UnimplementedUserServiceServer
	db         *gorm.DB
	jwtManager *auth.JWTManager
}

// NewUserService creates a new UserService instance
func NewUserService(db *gorm.DB, jwtManager *auth.JWTManager) *UserService {
	return &UserService{
		db:         db,
		jwtManager: jwtManager,
	}
}

// Register creates a new user account
func (s *UserService) Register(ctx context.Context, req *userpb.RegisterRequest) (*userpb.RegisterResponse, error) {
	// Validate input
	if req.Email == "" || req.Username == "" || req.Password == "" {
		return nil, status.Error(codes.InvalidArgument, "email, username, and password are required")
	}

	// Check if user already exists
	var existingUser models.User
	if err := s.db.Where("email = ? OR username = ?", req.Email, req.Username).First(&existingUser).Error; err == nil {
		return nil, status.Error(codes.AlreadyExists, "user with this email or username already exists")
	}

	// Hash password
	hashedPassword, err := auth.HashPassword(req.Password)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to hash password")
	}

	// Set default role if not provided
	role := "member"
	if req.Role == userpb.UserRole_USER_ROLE_ADMIN {
		role = "admin"
	}

	// Create user
	user := &models.User{
		Email:    req.Email,
		Username: req.Username,
		Password: hashedPassword,
		FullName: req.FullName,
		Role:     role,
	}

	if err := s.db.Create(user).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to create user")
	}

	return &userpb.RegisterResponse{
		User:    s.modelToProto(user),
		Message: "User registered successfully",
	}, nil
}

// Login authenticates a user and returns JWT tokens
func (s *UserService) Login(ctx context.Context, req *userpb.LoginRequest) (*userpb.LoginResponse, error) {
	if req.Email == "" || req.Password == "" {
		return nil, status.Error(codes.InvalidArgument, "email and password are required")
	}

	// Find user
	var user models.User
	if err := s.db.Where("email = ?", req.Email).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "invalid email or password")
		}
		return nil, status.Error(codes.Internal, "failed to find user")
	}

	// Check password
	if err := auth.CheckPassword(req.Password, user.Password); err != nil {
		return nil, status.Error(codes.Unauthenticated, "invalid email or password")
	}

	// Generate tokens
	accessToken, err := s.jwtManager.GenerateAccessToken(user.ID, user.Email, user.Role)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate access token")
	}

	refreshToken, err := s.jwtManager.GenerateRefreshToken(user.ID)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate refresh token")
	}

	return &userpb.LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		User:         s.modelToProto(&user),
		ExpiresIn:    86400, // 24 hours in seconds
	}, nil
}

// GetUser retrieves a user by ID
func (s *UserService) GetUser(ctx context.Context, req *userpb.GetUserRequest) (*userpb.GetUserResponse, error) {
	if req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	var user models.User
	if err := s.db.Where("id = ?", req.UserId).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "user not found")
		}
		return nil, status.Error(codes.Internal, "failed to get user")
	}

	return &userpb.GetUserResponse{
		User: s.modelToProto(&user),
	}, nil
}

// UpdateUser updates user information
func (s *UserService) UpdateUser(ctx context.Context, req *userpb.UpdateUserRequest) (*userpb.UpdateUserResponse, error) {
	if req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	var user models.User
	if err := s.db.Where("id = ?", req.UserId).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "user not found")
		}
		return nil, status.Error(codes.Internal, "failed to find user")
	}

	// Update fields
	if req.Email != "" {
		user.Email = req.Email
	}
	if req.Username != "" {
		user.Username = req.Username
	}
	if req.FullName != "" {
		user.FullName = req.FullName
	}
	if req.Role == userpb.UserRole_USER_ROLE_ADMIN {
		user.Role = "admin"
	} else if req.Role == userpb.UserRole_USER_ROLE_MEMBER {
		user.Role = "member"
	}

	if err := s.db.Save(&user).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to update user")
	}

	return &userpb.UpdateUserResponse{
		User:    s.modelToProto(&user),
		Message: "User updated successfully",
	}, nil
}

// DeleteUser deletes a user
func (s *UserService) DeleteUser(ctx context.Context, req *userpb.DeleteUserRequest) (*userpb.DeleteUserResponse, error) {
	if req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	result := s.db.Where("id = ?", req.UserId).Delete(&models.User{})
	if result.Error != nil {
		return nil, status.Error(codes.Internal, "failed to delete user")
	}

	if result.RowsAffected == 0 {
		return nil, status.Error(codes.NotFound, "user not found")
	}

	return &userpb.DeleteUserResponse{
		Message: "User deleted successfully",
	}, nil
}

// ListUsers lists all users with pagination
func (s *UserService) ListUsers(ctx context.Context, req *userpb.ListUsersRequest) (*userpb.ListUsersResponse, error) {
	page := req.Page
	if page < 1 {
		page = 1
	}

	pageSize := req.PageSize
	if pageSize < 1 {
		pageSize = 10
	}

	offset := (page - 1) * pageSize

	var users []models.User
	query := s.db.Model(&models.User{})

	// Apply role filter
	if req.RoleFilter != "" {
		query = query.Where("role = ?", req.RoleFilter)
	}

	// Get total count
	var totalCount int64
	if err := query.Count(&totalCount).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to count users")
	}

	// Get users
	if err := query.Offset(int(offset)).Limit(int(pageSize)).Find(&users).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to list users")
	}

	// Convert to proto
	protoUsers := make([]*userpb.User, len(users))
	for i, user := range users {
		protoUsers[i] = s.modelToProto(&user)
	}

	return &userpb.ListUsersResponse{
		Users:      protoUsers,
		TotalCount: int32(totalCount),
		Page:       page,
		PageSize:   pageSize,
	}, nil
}

// ValidateToken validates a JWT token
func (s *UserService) ValidateToken(ctx context.Context, req *userpb.ValidateTokenRequest) (*userpb.ValidateTokenResponse, error) {
	if req.Token == "" {
		return nil, status.Error(codes.InvalidArgument, "token is required")
	}

	claims, err := s.jwtManager.ValidateToken(req.Token)
	if err != nil {
		return &userpb.ValidateTokenResponse{
			Valid:   false,
			Message: fmt.Sprintf("invalid token: %v", err),
		}, nil
	}

	role := userpb.UserRole_USER_ROLE_MEMBER
	if claims.Role == "admin" {
		role = userpb.UserRole_USER_ROLE_ADMIN
	}

	return &userpb.ValidateTokenResponse{
		Valid:  true,
		UserId: claims.UserID,
		Role:   role,
	}, nil
}

// Helper function to convert model to proto
func (s *UserService) modelToProto(user *models.User) *userpb.User {
	role := userpb.UserRole_USER_ROLE_MEMBER
	if user.Role == "admin" {
		role = userpb.UserRole_USER_ROLE_ADMIN
	}

	return &userpb.User{
		UserId:    user.ID,
		Email:     user.Email,
		Username:  user.Username,
		FullName:  user.FullName,
		Role:      role,
		CreatedAt: timestamppb.New(user.CreatedAt),
		UpdatedAt: timestamppb.New(user.UpdatedAt),
	}
}
