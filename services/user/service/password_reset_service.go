package service

import (
	"context"
	"encoding/json"
	"fmt"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	userpb "github.com/chanduchitikam/task-management-system/proto/user"
	"github.com/chanduchitikam/task-management-system/services/user/models"
)

// SecurityQuestionAnswer represents a stored security question/answer pair
type SecurityQuestionAnswer struct {
	Question   string `json:"question"`
	AnswerHash string `json:"answer_hash"`
}

// SetSecurityQuestions - User sets 3 security questions (required for all users, one-time)
// For new users: also sets permanent password (replacing temp OTP)
// For existing users: just sets security questions (password unchanged)
func (s *UserService) SetSecurityQuestions(ctx context.Context, req *userpb.SetSecurityQuestionsRequest) (*userpb.SetSecurityQuestionsResponse, error) {
	if req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	if len(req.Questions) != 3 {
		return nil, status.Error(codes.InvalidArgument, "exactly 3 security questions required")
	}

	// Validate questions are from predefined list
	questionTexts := make([]string, len(req.Questions))
	for i, q := range req.Questions {
		questionTexts[i] = q.Question
	}
	if !ValidateSecurityQuestions(questionTexts) {
		return nil, status.Error(codes.InvalidArgument, "invalid security questions")
	}

	// Get user
	var user models.User
	if err := s.db.First(&user, "id = ?", req.UserId).Error; err != nil {
		return nil, status.Error(codes.NotFound, "user not found")
	}

	// Hash answers
	securityQA := make([]SecurityQuestionAnswer, 3)
	for i, q := range req.Questions {
		answerHash, err := auth.HashPassword(q.Answer)
		if err != nil {
			return nil, status.Error(codes.Internal, "failed to hash security answer")
		}
		securityQA[i] = SecurityQuestionAnswer{
			Question:   q.Question,
			AnswerHash: answerHash,
		}
	}

	// Store as JSON
	securityJSON, err := json.Marshal(securityQA)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to store security questions")
	}

	// Build updates map
	updates := map[string]interface{}{
		"security_questions": string(securityJSON),
	}

	// If user has temp password (must_change_password=true), set new permanent password
	if user.MustChangePassword && req.NewPassword != "" {
		hashedPassword, err := auth.HashPassword(req.NewPassword)
		if err != nil {
			return nil, status.Error(codes.Internal, "failed to hash password")
		}
		updates["password"] = hashedPassword
		updates["must_change_password"] = false
	} else if user.MustChangePassword && req.NewPassword == "" {
		return nil, status.Error(codes.InvalidArgument, "new_password required when changing temporary password")
	}
	// For existing users who already have permanent password, new_password is optional/ignored

	updates["has_logged_in"] = true

	if err := s.db.Model(&user).Updates(updates).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to update user")
	}

	return &userpb.SetSecurityQuestionsResponse{
		Message: "Security questions set successfully",
	}, nil
}

// ResetPassword - User resets password with old password
func (s *UserService) ResetPassword(ctx context.Context, req *userpb.ResetPasswordRequest) (*userpb.ResetPasswordResponse, error) {
	if req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	if req.OldPassword == "" || req.NewPassword == "" {
		return nil, status.Error(codes.InvalidArgument, "old_password and new_password are required")
	}

	// Get user
	var user models.User
	if err := s.db.First(&user, "id = ?", req.UserId).Error; err != nil {
		return nil, status.Error(codes.NotFound, "user not found")
	}

	// Super admin cannot reset via this method (security requirement)
	if user.Role == "super_admin" {
		return nil, status.Error(codes.PermissionDenied, "super admin password reset not allowed via this method")
	}

	// Verify old password
	if err := auth.CheckPassword(req.OldPassword, user.Password); err != nil {
		return nil, status.Error(codes.Unauthenticated, "invalid old password")
	}

	// Hash new password
	hashedPassword, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to hash password")
	}

	// Update password
	if err := s.db.Model(&user).Update("password", hashedPassword).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to update password")
	}

	return &userpb.ResetPasswordResponse{
		Message: "Password reset successfully",
	}, nil
}

// ResetPasswordWithQuestions - Reset password by answering security questions
func (s *UserService) ResetPasswordWithQuestions(ctx context.Context, req *userpb.ResetPasswordWithQuestionsRequest) (*userpb.ResetPasswordWithQuestionsResponse, error) {
	if req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}
	if len(req.Questions) != 3 {
		return nil, status.Error(codes.InvalidArgument, "all 3 security questions must be answered")
	}
	if req.NewPassword == "" {
		return nil, status.Error(codes.InvalidArgument, "new_password is required")
	}

	// Get user
	var user models.User
	if err := s.db.First(&user, "id = ?", req.UserId).Error; err != nil {
		return nil, status.Error(codes.NotFound, "user not found")
	}

	// Check if user has security questions set
	if user.SecurityQuestions == "" {
		return nil, status.Error(codes.FailedPrecondition, "no security questions set for this user")
	}

	// Parse stored security questions
	var storedQA []SecurityQuestionAnswer
	if err := json.Unmarshal([]byte(user.SecurityQuestions), &storedQA); err != nil {
		return nil, status.Error(codes.Internal, "failed to parse security questions")
	}

	// Verify all answers
	answeredQuestions := make(map[string]string)
	for _, q := range req.Questions {
		answeredQuestions[q.Question] = q.Answer
	}

	for _, stored := range storedQA {
		answer, exists := answeredQuestions[stored.Question]
		if !exists {
			return nil, status.Error(codes.InvalidArgument, "missing security question answer")
		}

		// Verify answer
		if err := auth.CheckPassword(answer, stored.AnswerHash); err != nil {
			// Increment failed attempts
			s.db.Model(&user).Update("failed_login_attempts", gorm.Expr("failed_login_attempts + ?", 1))
			return nil, status.Error(codes.Unauthenticated, "incorrect security answer")
		}
	}

	// All answers correct - reset password
	hashedPassword, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to hash password")
	}

	// Update password and reset failed attempts
	updates := map[string]interface{}{
		"password":              hashedPassword,
		"failed_login_attempts": 0,
		"must_change_password":  false,
	}

	if err := s.db.Model(&user).Updates(updates).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to update password")
	}

	return &userpb.ResetPasswordWithQuestionsResponse{
		Message: "Password reset successfully using security questions",
	}, nil
}

// AdminResetPassword - Org admin force resets user password (generates new temp password)
func (s *UserService) AdminResetPassword(ctx context.Context, req *userpb.AdminResetPasswordRequest) (*userpb.AdminResetPasswordResponse, error) {
	if req.OrgId == "" || req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id and user_id are required")
	}

	// Get user
	var user models.User
	if err := s.db.First(&user, "id = ?", req.UserId).Error; err != nil {
		return nil, status.Error(codes.NotFound, "user not found")
	}

	// Verify user belongs to the organization
	if user.OrgID == nil || *user.OrgID != req.OrgId {
		return nil, status.Error(codes.PermissionDenied, "user does not belong to this organization")
	}

	// Cannot reset super admin password
	if user.Role == "super_admin" {
		return nil, status.Error(codes.PermissionDenied, "cannot reset super admin password")
	}

	// Generate new temp password
	tempPassword, err := s.generateOneTimePassword()
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to generate temporary password")
	}

	// Hash password
	hashedPassword, err := auth.HashPassword(tempPassword)
	if err != nil {
		return nil, status.Error(codes.Internal, "failed to hash password")
	}

	// Update user with temp password and force password change
	updates := map[string]interface{}{
		"password":              hashedPassword,
		"must_change_password":  true,
		"failed_login_attempts": 0,
	}

	if err := s.db.Model(&user).Updates(updates).Error; err != nil {
		return nil, status.Error(codes.Internal, "failed to reset password")
	}

	return &userpb.AdminResetPasswordResponse{
		NewTempPassword: tempPassword,
		Message:         fmt.Sprintf("Password reset successfully for %s. Share the temporary password with the user.", user.FullName),
	}, nil
}
