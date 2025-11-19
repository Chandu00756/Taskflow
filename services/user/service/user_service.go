package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	userpb "github.com/chanduchitikam/task-management-system/proto/user"
	"github.com/chanduchitikam/task-management-system/services/user/models"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// Helper to get string from context or metadata
func getStringFromContext(ctx context.Context, key string) string {
	// Try context value first
	if val := ctx.Value(key); val != nil {
		if str, ok := val.(string); ok {
			return str
		}
	}

	// Try metadata
	if md, ok := metadata.FromIncomingContext(ctx); ok {
		if vals := md.Get(key); len(vals) > 0 {
			return vals[0]
		}
		// Also try with grpc-metadata- prefix
		if vals := md.Get("grpc-metadata-" + key); len(vals) > 0 {
			return vals[0]
		}
	}

	return ""
}

// // // UserService implements the UserService gRPC service
type UserService struct {
	userpb.UnimplementedUserServiceServer
	db         *gorm.DB
	jwtManager *auth.JWTManager
	orgService *OrganizationService
}

// // // NewUserService creates a new UserService instance
func NewUserService(db *gorm.DB, jwtManager *auth.JWTManager) *UserService {
	return &UserService{
		db:         db,
		jwtManager: jwtManager,
		orgService: NewOrganizationService(db, jwtManager),
	}
}

// // // Register creates a new user account
func (s *UserService) Register(ctx context.Context, req *userpb.RegisterRequest) (*userpb.RegisterResponse, error) {
	// Validate input
	if req.Email == "" || req.Username == "" || req.Password == "" {
		return nil, status.Error(codes.InvalidArgument, "email, username, and password are required")
	}

	// Normalize email and check existing user
	normalizedEmail := strings.ToLower(req.Email)
	var existingUser models.User
	if err := s.db.Where("LOWER(email) = ? OR username = ?", normalizedEmail, req.Username).First(&existingUser).Error; err == nil {
		return nil, status.Error(codes.AlreadyExists, "user with this email or username already exists")
	}

	// Hash password
	hashedPassword, err := auth.HashPassword(req.Password)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to hash password")
	}

	// Default role
	role := "member"
	if req.Role == userpb.UserRole_USER_ROLE_ADMIN {
		role = "admin"
	}

	// Determine organization by email domain
	domain := ""
	var org models.Organization
	if parts := strings.Split(normalizedEmail, "@"); len(parts) == 2 {
		domain = parts[1]
	}

	if domain != "" {
		// Check if organization exists for this domain
		if err := s.db.Where("domain = ?", domain).First(&org).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				// No org exists: create one (unless DB doesn't have organizations table)
				org = models.Organization{
					Name:   strings.Split(domain, ".")[0],
					Domain: domain,
				}
				if err := s.db.Create(&org).Error; err != nil {
					// If migrations not applied (tests), skip org creation
					if strings.Contains(err.Error(), "no such table") || strings.Contains(err.Error(), "no such column") {
						org = models.Organization{}
					} else {
						return nil, status.Error(codes.Internal, "failed to create organization")
					}
				} else {
					// make user admin of new org
					role = "admin"
				}
			} else {
				// Lookup failed for other reasons
				if strings.Contains(err.Error(), "no such table") {
					org = models.Organization{}
				} else {
					return nil, status.Error(codes.Internal, "failed to lookup organization")
				}
			}
		} else {
			// Org exists: disallow self-registration — must be invited by org admin
			return nil, status.Error(codes.PermissionDenied, "organization already exists for this domain; please request an invite from your organization administrator")
		}
	}

	// Create user associated with org (org.ID may be empty if skipped)
	var orgIDPtr *string
	if org.ID != "" {
		orgIDPtr = &org.ID
	}
	user := &models.User{
		Email:    normalizedEmail,
		Username: req.Username,
		Password: hashedPassword,
		FullName: req.FullName,
		Role:     role,
		OrgID:    orgIDPtr,
	}

	if err := s.db.Create(user).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to create user")
	}

	// Generate tokens including org_id
	tokenOrgID := ""
	if user.OrgID != nil {
		tokenOrgID = *user.OrgID
	}
	accessToken, err := s.jwtManager.GenerateAccessToken(user.ID, user.Email, user.Role, tokenOrgID)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate access token")
	}
	refreshToken, err := s.jwtManager.GenerateRefreshToken(user.ID)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate refresh token")
	}

	// Return response (include tokens for convenience)
	_ = accessToken
	_ = refreshToken

	return &userpb.RegisterResponse{
		User:    s.modelToProto(user),
		Message: "User registered successfully",
	}, nil
}

// // // Login authenticates a user and returns JWT tokens
func (s *UserService) Login(ctx context.Context, req *userpb.LoginRequest) (*userpb.LoginResponse, error) {
	if req.Email == "" || req.Password == "" {
		return nil, status.Error(codes.InvalidArgument, "email and password are required")
	}

	// 	// 	// Find user (case-insensitive on email)
	var user models.User
	normalizedEmail := strings.ToLower(req.Email)
	if err := s.db.Where("LOWER(email) = ?", normalizedEmail).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "invalid email or password")
		}
		return nil, status.Error(codes.Internal, "failed to find user")
	}

	// Check if account is locked due to failed attempts (optional: 5 attempts = lock)
	if user.FailedLoginAttempts >= 5 {
		return nil, status.Error(codes.PermissionDenied, "account locked due to too many failed login attempts. Contact your administrator.")
	}

	// 	// 	// Check password
	if err := auth.CheckPassword(req.Password, user.Password); err != nil {
		// Increment failed login attempts
		s.db.Model(&user).Update("failed_login_attempts", gorm.Expr("failed_login_attempts + ?", 1))
		return nil, status.Error(codes.Unauthenticated, "invalid email or password")
	}

	// Successful login - update login tracking
	now := time.Now()
	updates := map[string]interface{}{
		"has_logged_in":         true,
		"last_login":            &now,
		"failed_login_attempts": 0,
	}
	if err := s.db.Model(&user).Updates(updates).Error; err != nil {
		// Log error but don't fail login
		fmt.Printf("Failed to update login tracking: %v\n", err)
	}

	// Check if user needs to set security questions (one-time for all users)
	mustSetSecurityQuestions := user.SecurityQuestions == "" || user.SecurityQuestions == "null"
	fmt.Printf("🔐 Login - User: %s, SecurityQuestions value: '%s', IsEmpty: %v, MustSet: %v\n",
		user.Email, user.SecurityQuestions, user.SecurityQuestions == "", mustSetSecurityQuestions)

	// 	// 	// Generate tokens
	tokenOrgID := ""
	if user.OrgID != nil {
		tokenOrgID = *user.OrgID
	}
	accessToken, err := s.jwtManager.GenerateAccessToken(user.ID, user.Email, user.Role, tokenOrgID)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate access token")
	}

	refreshToken, err := s.jwtManager.GenerateRefreshToken(user.ID)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate refresh token")
	}

	return &userpb.LoginResponse{
		AccessToken:              accessToken,
		RefreshToken:             refreshToken,
		User:                     s.modelToProto(&user),
		ExpiresIn:                86400, // 24 hours in seconds
		MustChangePassword:       user.MustChangePassword,
		MustSetSecurityQuestions: mustSetSecurityQuestions,
	}, nil
}

// // // GetUser retrieves a user by ID
func (s *UserService) GetUser(ctx context.Context, req *userpb.GetUserRequest) (*userpb.GetUserResponse, error) {
	if req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	// Require authentication context
	roleVal := ctx.Value("role")
	orgVal := ctx.Value("org_id")
	callerIDVal := ctx.Value("user_id")
	if roleVal == nil || orgVal == nil || callerIDVal == nil {
		return nil, status.Error(codes.Unauthenticated, "missing authentication context")
	}
	roleStr, _ := roleVal.(string)
	callerOrg, _ := orgVal.(string)
	callerID, _ := callerIDVal.(string)

	var user models.User
	var err error
	// Global admin (seeded) allowed to fetch any user
	isGlobalAdmin := roleStr == "admin" && callerOrg == "" && strings.ToLower(ctx.Value("email").(string)) == "admin@taskflow.com"
	if isGlobalAdmin {
		err = s.db.Where("id = ?", req.UserId).First(&user).Error
	} else {
		// Org admin or member: scope by org
		// Org admins can fetch any user in their org; members only their own record
		if roleStr == "admin" && callerOrg != "" {
			err = s.db.Where("id = ? AND org_id = ?", req.UserId, callerOrg).First(&user).Error
		} else {
			// member
			if callerID != req.UserId {
				return nil, status.Error(codes.PermissionDenied, "forbidden")
			}
			err = s.db.Where("id = ? AND org_id = ?", req.UserId, callerOrg).First(&user).Error
		}
	}

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "user not found")
		}
		return nil, status.Error(codes.Internal, "failed to get user")
	}

	return &userpb.GetUserResponse{
		User: s.modelToProto(&user),
	}, nil
}

// // // UpdateUser updates user information
func (s *UserService) UpdateUser(ctx context.Context, req *userpb.UpdateUserRequest) (*userpb.UpdateUserResponse, error) {
	if req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	// Require authentication context
	roleVal := ctx.Value("role")
	orgVal := ctx.Value("org_id")
	callerIDVal := ctx.Value("user_id")
	if roleVal == nil || orgVal == nil || callerIDVal == nil {
		return nil, status.Error(codes.Unauthenticated, "missing authentication context")
	}
	roleStr, _ := roleVal.(string)
	callerOrg, _ := orgVal.(string)
	callerID, _ := callerIDVal.(string)

	var user models.User
	var err error
	isGlobalAdmin := roleStr == "admin" && callerOrg == "" && strings.ToLower(ctx.Value("email").(string)) == "admin@taskflow.com"
	if isGlobalAdmin {
		err = s.db.Where("id = ?", req.UserId).First(&user).Error
	} else {
		if roleStr == "admin" && callerOrg != "" {
			// org admin may update users in same org
			err = s.db.Where("id = ? AND org_id = ?", req.UserId, callerOrg).First(&user).Error
		} else {
			// member may only update themselves
			if callerID != req.UserId {
				return nil, status.Error(codes.PermissionDenied, "forbidden")
			}
			err = s.db.Where("id = ? AND org_id = ?", req.UserId, callerOrg).First(&user).Error
		}
	}

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "user not found")
		}
		return nil, status.Error(codes.Internal, "failed to find user")
	}

	// 	// 	// Update fields
	if req.Email != "" {
		user.Email = strings.ToLower(req.Email)
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

// // // DeleteUser deletes a user
func (s *UserService) DeleteUser(ctx context.Context, req *userpb.DeleteUserRequest) (*userpb.DeleteUserResponse, error) {
	if req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	// Require authentication context
	roleVal := ctx.Value("role")
	orgVal := ctx.Value("org_id")
	emailVal := ctx.Value("email")
	callerIDVal := ctx.Value("user_id")
	if roleVal == nil || orgVal == nil || callerIDVal == nil {
		return nil, status.Error(codes.Unauthenticated, "missing authentication context")
	}
	roleStr, _ := roleVal.(string)
	callerOrg, _ := orgVal.(string)
	callerID, _ := callerIDVal.(string)

	isGlobalAdmin := roleStr == "admin" && callerOrg == "" && strings.ToLower(emailVal.(string)) == "admin@taskflow.com"

	var result *gorm.DB
	if isGlobalAdmin {
		result = s.db.Where("id = ?", req.UserId).Delete(&models.User{})
	} else if roleStr == "admin" && callerOrg != "" {
		result = s.db.Where("id = ? AND org_id = ?", req.UserId, callerOrg).Delete(&models.User{})
	} else {
		// member may delete only themselves
		if callerID != req.UserId {
			return nil, status.Error(codes.PermissionDenied, "forbidden")
		}
		result = s.db.Where("id = ? AND org_id = ?", req.UserId, callerOrg).Delete(&models.User{})
	}

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

// // // ListUsers lists all users with pagination
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

	// Require authentication context and scope by org unless global admin
	roleVal := ctx.Value("role")
	orgVal := ctx.Value("org_id")
	emailVal := ctx.Value("email")
	if roleVal == nil || orgVal == nil {
		return nil, status.Error(codes.Unauthenticated, "missing authentication context")
	}
	roleStr, _ := roleVal.(string)
	callerOrg, _ := orgVal.(string)
	emailStr, _ := emailVal.(string)

	var users []models.User
	query := s.db.Model(&models.User{})

	isGlobalAdmin := roleStr == "admin" && callerOrg == "" && strings.ToLower(emailStr) == "admin@taskflow.com"
	if !isGlobalAdmin {
		// only list users in caller's org
		query = query.Where("org_id = ?", callerOrg)
	}

	// 	// 	// Apply role filter
	if req.RoleFilter != "" {
		query = query.Where("role = ?", req.RoleFilter)
	}

	// 	// 	// Get total count
	var totalCount int64
	if err := query.Count(&totalCount).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to count users")
	}

	// 	// 	// Get users
	if err := query.Offset(int(offset)).Limit(int(pageSize)).Find(&users).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to list users")
	}

	// 	// 	// Convert to proto
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

// // // ValidateToken validates a JWT token
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

	// Note: proto ValidateTokenResponse doesn't include org_id. We still return user and role.
	return &userpb.ValidateTokenResponse{
		Valid:  true,
		UserId: claims.UserID,
		Role:   role,
	}, nil
}

// // // Helper function to convert model to proto
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

// generateSecureToken returns a cryptographically secure random token of n bytes encoded as hex
func generateSecureToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func hashString(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// InviteUser creates an invite for a user in an organization. Caller must be org admin for the org.
func (s *UserService) InviteUser(ctx context.Context, req *userpb.InviteRequest) (*userpb.InviteResponse, error) {
	if req == nil || req.Email == "" || req.OrgId == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id and email are required")
	}

	// auth interceptor injects role and org_id into context
	roleVal := ctx.Value("role")
	orgVal := ctx.Value("org_id")
	userIDVal := ctx.Value("user_id")
	if roleVal == nil || orgVal == nil || userIDVal == nil {
		return nil, status.Error(codes.Unauthenticated, "missing authentication context")
	}

	roleStr, _ := roleVal.(string)
	callerOrg, _ := orgVal.(string)
	callerID, _ := userIDVal.(string)

	if roleStr != "admin" || callerOrg != req.OrgId {
		return nil, status.Error(codes.PermissionDenied, "only organization admins may invite users for this org")
	}

	// Ensure no existing user with email
	var existing models.User
	if err := s.db.Where("LOWER(email) = ?", strings.ToLower(req.Email)).First(&existing).Error; err == nil {
		return nil, status.Error(codes.AlreadyExists, "user with this email already exists")
	}

	// generate token and store only hash
	token, err := generateSecureToken(32)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate token")
	}
	tokenHash := hashString(token)

	expires := time.Now().Add(72 * time.Hour)
	if req.ExpiresHours > 0 {
		expires = time.Now().Add(time.Duration(req.ExpiresHours) * time.Hour)
	}

	invite := &models.Invite{
		Email:     strings.ToLower(req.Email),
		OrgID:     req.OrgId,
		Role:      req.Role,
		TokenHash: tokenHash,
		ExpiresAt: expires,
		CreatedBy: callerID,
	}

	if err := s.db.Create(invite).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to create invite")
	}

	// Note: in production we should email the token; do not return it via API.
	return &userpb.InviteResponse{InviteId: invite.ID, Message: "invite created; deliver token to user via secure channel"}, nil
}

// AcceptInvite accepts an invite token and creates a user
func (s *UserService) AcceptInvite(ctx context.Context, req *userpb.AcceptInviteRequest) (*userpb.AcceptInviteResponse, error) {
	if req == nil || req.Token == "" || req.Password == "" || req.Username == "" {
		return nil, status.Error(codes.InvalidArgument, "token, password and username are required")
	}

	tokenHash := hashString(req.Token)
	var invite models.Invite
	if err := s.db.Where("token_hash = ?", tokenHash).First(&invite).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, status.Error(codes.NotFound, "invalid or expired invite token")
		}
		return nil, status.Error(codes.Internal, "failed to lookup invite")
	}

	if invite.UsedAt != nil || invite.ExpiresAt.Before(time.Now()) {
		return nil, status.Error(codes.FailedPrecondition, "invite already used or expired")
	}

	// ensure email not already used
	var existing models.User
	if err := s.db.Where("LOWER(email) = ?", strings.ToLower(invite.Email)).First(&existing).Error; err == nil {
		return nil, status.Error(codes.AlreadyExists, "user with this email already exists")
	}

	hashedPass, err := auth.HashPassword(req.Password)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to hash password")
	}

	newUser := &models.User{
		Email:    strings.ToLower(invite.Email),
		Username: req.Username,
		Password: hashedPass,
		FullName: req.FullName,
		Role:     invite.Role,
	}
	// invite.OrgID is a string; models.User.OrgID is a *string
	if invite.OrgID != "" {
		newUser.OrgID = &invite.OrgID
	}

	if err := s.db.Create(newUser).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to create user")
	}

	now := time.Now()
	invite.UsedAt = &now
	if err := s.db.Save(&invite).Error; err != nil {
		// log only; user created
	}

	return &userpb.AcceptInviteResponse{User: s.modelToProto(newUser), Message: "user created from invite"}, nil
}

// ListInvites lists invites for an organization
func (s *UserService) ListInvites(ctx context.Context, req *userpb.ListInvitesRequest) (*userpb.ListInvitesResponse, error) {
	if req == nil || req.OrgId == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id is required")
	}

	// permission check: caller must be org admin or global admin
	roleVal := ctx.Value("role")
	orgVal := ctx.Value("org_id")
	emailVal := ctx.Value("email")
	if roleVal == nil || orgVal == nil {
		return nil, status.Error(codes.Unauthenticated, "missing authentication context")
	}
	roleStr, _ := roleVal.(string)
	callerOrg, _ := orgVal.(string)
	emailStr, _ := emailVal.(string)

	isOrgAdmin := roleStr == "admin" && callerOrg == req.OrgId
	isGlobalAdmin := roleStr == "admin" && callerOrg == "" && strings.ToLower(emailStr) == "admin@taskflow.com"
	if !isOrgAdmin && !isGlobalAdmin {
		return nil, status.Error(codes.PermissionDenied, "forbidden")
	}

	page := req.Page
	if page < 1 {
		page = 1
	}
	pageSize := req.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	var total int64
	if err := s.db.Model(&models.Invite{}).Where("org_id = ?", req.OrgId).Count(&total).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to count invites")
	}

	var invites []models.Invite
	if err := s.db.Where("org_id = ?", req.OrgId).Offset(int(offset)).Limit(int(pageSize)).Find(&invites).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to list invites")
	}

	protoInvites := make([]*userpb.Invite, 0, len(invites))
	for _, iv := range invites {
		var usedAt *timestamppb.Timestamp
		if iv.UsedAt != nil {
			usedAt = timestamppb.New(*iv.UsedAt)
		}
		protoInvites = append(protoInvites, &userpb.Invite{
			InviteId:  iv.ID,
			Email:     iv.Email,
			OrgId:     iv.OrgID,
			Role:      iv.Role,
			ExpiresAt: timestamppb.New(iv.ExpiresAt),
			UsedAt:    usedAt,
			CreatedBy: iv.CreatedBy,
			CreatedAt: timestamppb.New(iv.CreatedAt),
		})
	}

	return &userpb.ListInvitesResponse{
		Invites:    protoInvites,
		TotalCount: int32(total),
		Page:       page,
		PageSize:   pageSize,
	}, nil
}

// RegisterOrganization creates a new organization with admin user
func (s *UserService) RegisterOrganization(ctx context.Context, req *userpb.RegisterOrganizationRequest) (*userpb.RegisterOrganizationResponse, error) {
	if req.OrgName == "" || req.AdminEmail == "" || req.AdminPassword == "" {
		return nil, status.Error(codes.InvalidArgument, "org_name, admin_email and admin_password are required")
	}

	org, admin, err := s.orgService.RegisterOrganization(req.OrgName, req.Description, req.AdminEmail, req.AdminPassword, req.AdminFullName)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	accessToken, err := s.jwtManager.GenerateAccessToken(admin.ID, admin.Email, admin.Role, org.ID)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate token")
	}

	description := ""
	if org.Description != nil {
		description = *org.Description
	}

	return &userpb.RegisterOrganizationResponse{
		Organization: &userpb.Organization{
			Id:          org.ID,
			Name:        org.Name,
			Description: description,
			CreatedAt:   timestamppb.New(org.CreatedAt),
		},
		Admin: &userpb.User{
			UserId:    admin.ID,
			Email:     admin.Email,
			Username:  admin.Username,
			FullName:  admin.FullName,
			CreatedAt: timestamppb.New(admin.CreatedAt),
			UpdatedAt: timestamppb.New(admin.UpdatedAt),
		},
		AccessToken: accessToken,
		Message:     "Organization registered successfully",
	}, nil
}

// ListAllOrganizations returns all organizations (super admin only)
func (s *UserService) ListAllOrganizations(ctx context.Context, req *userpb.ListAllOrganizationsRequest) (*userpb.ListAllOrganizationsResponse, error) {
	// Check if user is super admin
	role := getStringFromContext(ctx, "role")
	if role != "super_admin" {
		return nil, status.Error(codes.PermissionDenied, "super admin access required")
	}

	orgs, err := s.orgService.ListAllOrganizations()
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	protoOrgs := make([]*userpb.Organization, 0, len(orgs))
	for _, org := range orgs {
		// Count members
		var memberCount int64
		s.db.Model(&models.User{}).Where("org_id = ?", org.ID).Count(&memberCount)

		description := ""
		if org.Description != nil {
			description = *org.Description
		}

		protoOrgs = append(protoOrgs, &userpb.Organization{
			Id:          org.ID,
			Name:        org.Name,
			Description: description,
			CreatedAt:   timestamppb.New(org.CreatedAt),
			MemberCount: int32(memberCount),
		})
	}

	return &userpb.ListAllOrganizationsResponse{
		Organizations: protoOrgs,
	}, nil
}

// GetPlatformAnalytics returns platform-wide statistics (super admin only)
func (s *UserService) GetPlatformAnalytics(ctx context.Context, req *userpb.GetPlatformAnalyticsRequest) (*userpb.GetPlatformAnalyticsResponse, error) {
	// Get role from context/metadata
	role := getStringFromContext(ctx, "role")
	if role != "super_admin" {
		return nil, status.Error(codes.PermissionDenied, "super admin access required")
	}

	analytics, err := s.orgService.GetPlatformAnalytics()
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &userpb.GetPlatformAnalyticsResponse{
		TotalOrganizations: analytics["total_organizations"].(int64),
		TotalUsers:         analytics["total_users"].(int64),
		ActiveUsersToday:   analytics["active_users_today"].(int64),
		TotalTasks:         analytics["total_tasks"].(int64),
	}, nil
}

// ListAllUsers returns all users (super admin only)
func (s *UserService) ListAllUsers(ctx context.Context, req *userpb.ListAllUsersRequest) (*userpb.ListAllUsersResponse, error) {
	role := getStringFromContext(ctx, "role")
	if role != "super_admin" {
		return nil, status.Error(codes.PermissionDenied, "super admin access required")
	}

	var users []models.User
	if err := s.db.Find(&users).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to list users")
	}

	protoUsers := make([]*userpb.UserWithOrg, 0, len(users))
	for _, u := range users {
		orgID := ""
		if u.OrgID != nil {
			orgID = *u.OrgID
		}
		protoUsers = append(protoUsers, &userpb.UserWithOrg{
			Id:        u.ID,
			Email:     u.Email,
			Username:  u.Username,
			FullName:  u.FullName,
			Role:      u.Role,
			OrgId:     orgID,
			CreatedAt: timestamppb.New(u.CreatedAt),
		})
	}

	return &userpb.ListAllUsersResponse{
		Users: protoUsers,
	}, nil
}

// DeleteOrganization deletes an organization (super admin only)
func (s *UserService) DeleteOrganization(ctx context.Context, req *userpb.DeleteOrganizationRequest) (*userpb.DeleteOrganizationResponse, error) {
	role := getStringFromContext(ctx, "role")
	if role != "super_admin" {
		return nil, status.Error(codes.PermissionDenied, "super admin access required")
	}

	if req.OrgId == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id required")
	}

	if err := s.orgService.DeleteOrganization(req.OrgId); err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &userpb.DeleteOrganizationResponse{
		Message: "Organization deleted successfully",
	}, nil
}

// ListOrganizationMembers returns members of an organization
func (s *UserService) ListOrganizationMembers(ctx context.Context, req *userpb.ListOrganizationMembersRequest) (*userpb.ListOrganizationMembersResponse, error) {
	role := getStringFromContext(ctx, "role")
	orgID := getStringFromContext(ctx, "org_id")

	// Allow org admin or super admin
	isOrgAdmin := role == "org_admin" && orgID == req.OrgId
	isSuperAdmin := role == "super_admin"

	if !isOrgAdmin && !isSuperAdmin {
		return nil, status.Error(codes.PermissionDenied, "access denied")
	}

	// Fetch users directly from DB
	var users []models.User
	if err := s.db.Where("org_id = ?", req.OrgId).Find(&users).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to fetch members")
	}

	protoMembers := make([]*userpb.OrganizationMember, 0, len(users))
	for _, user := range users {
		member := &userpb.OrganizationMember{
			Id:                   user.ID,
			Email:                user.Email,
			Username:             user.Username,
			FullName:             user.FullName,
			Role:                 user.Role,
			CreatedAt:            timestamppb.New(user.CreatedAt),
			HasLoggedIn:          user.HasLoggedIn,
			MustChangePassword:   user.MustChangePassword,
			FailedLoginAttempts:  int32(user.FailedLoginAttempts),
			HasSecurityQuestions: user.SecurityQuestions != "",
		}
		if user.LastLogin != nil {
			member.LastLogin = timestamppb.New(*user.LastLogin)
		}
		protoMembers = append(protoMembers, member)
	}

	return &userpb.ListOrganizationMembersResponse{
		Members: protoMembers,
	}, nil
}

// RemoveOrganizationMember removes a member from organization
func (s *UserService) RemoveOrganizationMember(ctx context.Context, req *userpb.RemoveOrganizationMemberRequest) (*userpb.RemoveOrganizationMemberResponse, error) {
	role := getStringFromContext(ctx, "role")
	orgID := getStringFromContext(ctx, "org_id")

	isOrgAdmin := role == "org_admin" && orgID == req.OrgId
	isSuperAdmin := role == "super_admin"

	if !isOrgAdmin && !isSuperAdmin {
		return nil, status.Error(codes.PermissionDenied, "access denied")
	}

	if err := s.orgService.RemoveOrganizationMember(req.OrgId, req.UserId); err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &userpb.RemoveOrganizationMemberResponse{
		Message: "Member removed successfully",
	}, nil
}
