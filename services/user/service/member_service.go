package service

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"regexp"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	userpb "github.com/chanduchitikam/task-management-system/proto/user"
	"github.com/chanduchitikam/task-management-system/services/user/models"
)

// GenerateUsername creates a smart username from first and last name
// Pattern: firstname.lastname or f.lastname with numeric suffix if taken
func (s *UserService) generateUsername(firstName, lastName string, orgID string) (string, error) {
	// Sanitize names
	sanitize := func(s string) string {
		reg := regexp.MustCompile("[^a-z0-9]+")
		return reg.ReplaceAllString(strings.ToLower(s), "")
	}

	firstName = sanitize(firstName)
	lastName = sanitize(lastName)

	if firstName == "" || lastName == "" {
		return "", status.Error(codes.InvalidArgument, "first name and last name are required")
	}

	// Try patterns in order: firstname.lastname, f.lastname, firstname.l
	patterns := []string{
		fmt.Sprintf("%s.%s", firstName, lastName),
		fmt.Sprintf("%s.%s", string(firstName[0]), lastName),
		fmt.Sprintf("%s.%s", firstName, string(lastName[0])),
	}

	for _, baseUsername := range patterns {
		// Try base username first
		var existingUser models.User
		err := s.db.Where("username = ?", baseUsername).First(&existingUser).Error
		if err == gorm.ErrRecordNotFound {
			return baseUsername, nil
		}

		// Try with numeric suffix (1-999)
		for i := 1; i < 1000; i++ {
			candidateUsername := fmt.Sprintf("%s%d", baseUsername, i)
			err := s.db.Where("username = ?", candidateUsername).First(&existingUser).Error
			if err == gorm.ErrRecordNotFound {
				return candidateUsername, nil
			}
		}
	}

	return "", status.Error(codes.Internal, "failed to generate unique username")
}

// GenerateOneTimePassword creates a strong random password
func (s *UserService) generateOneTimePassword() (string, error) {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*"
	const length = 16

	password := make([]byte, length)
	for i := range password {
		num, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			return "", err
		}
		password[i] = charset[num.Int64()]
	}

	return string(password), nil
}

// ValidateOrgEmailDomain ensures email matches organization domain
func (s *UserService) validateOrgEmailDomain(email, orgID string) error {
	// Get organization
	var org models.Organization
	if err := s.db.First(&org, "id = ?", orgID).Error; err != nil {
		return status.Error(codes.NotFound, "organization not found")
	}

	if org.Domain == "" {
		// If org doesn't have a domain set, allow any email
		return nil
	}

	// Extract domain from email
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		return status.Error(codes.InvalidArgument, "invalid email format")
	}
	emailDomain := strings.ToLower(parts[1])
	orgDomain := strings.ToLower(org.Domain)

	if emailDomain != orgDomain {
		return status.Errorf(codes.InvalidArgument,
			"email domain must be @%s for this organization", orgDomain)
	}

	return nil
}

// CreateOrganizationMember - Admin creates a member directly with auto-generated credentials
func (s *UserService) CreateOrganizationMember(ctx context.Context, req *userpb.CreateOrganizationMemberRequest) (*userpb.CreateOrganizationMemberResponse, error) {
	// Validate inputs
	if req.OrgId == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id is required")
	}
	if req.FirstName == "" || req.LastName == "" {
		return nil, status.Error(codes.InvalidArgument, "first_name and last_name are required")
	}
	if req.Email == "" {
		return nil, status.Error(codes.InvalidArgument, "email is required")
	}

	// Validate email domain matches organization
	if err := s.validateOrgEmailDomain(req.Email, req.OrgId); err != nil {
		return nil, err
	}

	// Check if email already exists
	var existingUser models.User
	if err := s.db.Where("email = ?", req.Email).First(&existingUser).Error; err == nil {
		return nil, status.Error(codes.AlreadyExists, "user with this email already exists")
	}

	// Generate username
	username, err := s.generateUsername(req.FirstName, req.LastName, req.OrgId)
	if err != nil {
		return nil, err
	}

	// Generate one-time password
	otp, err := s.generateOneTimePassword()
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate password")
	}

	// Hash password
	hashedPassword, err := auth.HashPassword(otp)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to hash password")
	}

	// Set default role
	role := req.Role
	if role == "" {
		role = "member"
	}

	// Create user
	fullName := fmt.Sprintf("%s %s", req.FirstName, req.LastName)
	user := models.User{
		Email:              req.Email,
		Username:           username,
		Password:           hashedPassword,
		FullName:           fullName,
		Role:               role,
		OrgID:              &req.OrgId,
		MustChangePassword: true, // Force password change on first login
	}

	if err := s.db.Create(&user).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to create user")
	}

	// Convert to proto
	member := &userpb.OrganizationMember{
		Id:                   user.ID,
		Email:                user.Email,
		Username:             user.Username,
		FullName:             user.FullName,
		Role:                 user.Role,
		CreatedAt:            timestamppb.New(user.CreatedAt),
		HasLoggedIn:          false,
		MustChangePassword:   true,
		FailedLoginAttempts:  0,
		HasSecurityQuestions: false,
	}

	return &userpb.CreateOrganizationMemberResponse{
		Member:            member,
		GeneratedUsername: username,
		OneTimePassword:   otp, // Return OTP to admin (only visible once)
		Message:           "User created successfully. Share the one-time password with the user.",
	}, nil
}

// GetOrganization - Get organization details
func (s *UserService) GetOrganization(ctx context.Context, req *userpb.GetOrganizationRequest) (*userpb.GetOrganizationResponse, error) {
	if req.OrgId == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id is required")
	}

	var org models.Organization
	if err := s.db.First(&org, "id = ?", req.OrgId).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, status.Error(codes.NotFound, "organization not found")
		}
		return nil, status.Error(codes.Internal, "failed to get organization")
	}

	return &userpb.GetOrganizationResponse{
		Organization: &userpb.Organization{
			Id:          org.ID,
			Name:        org.Name,
			Description: getStringValue(org.Description),
		},
	}, nil
}

// Helper to safely get string value from pointer
func getStringValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
