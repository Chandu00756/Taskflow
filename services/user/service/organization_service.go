package service

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"github.com/chanduchitikam/task-management-system/services/user/models"
	"gorm.io/gorm"
)

type OrganizationService struct {
	db         *gorm.DB
	jwtManager *auth.JWTManager
}

func NewOrganizationService(db *gorm.DB, jwtManager *auth.JWTManager) *OrganizationService {
	return &OrganizationService{
		db:         db,
		jwtManager: jwtManager,
	}
}

// RegisterOrganization creates a new organization and its admin user atomically
func (s *OrganizationService) RegisterOrganization(orgName, orgDescription, adminEmail, adminPassword, adminFullName string) (*models.Organization, *models.User, error) {
	// Check if organization name already exists
	var existing models.Organization
	if err := s.db.Where("LOWER(name) = ?", strings.ToLower(orgName)).First(&existing).Error; err == nil {
		return nil, nil, errors.New("organization with this name already exists")
	}

	// Check if admin email already exists
	var existingUser models.User
	if err := s.db.Where("LOWER(email) = ?", strings.ToLower(adminEmail)).First(&existingUser).Error; err == nil {
		return nil, nil, errors.New("user with this email already exists")
	}

	// Hash admin password
	hashedPassword, err := auth.HashPassword(adminPassword)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to hash password: %v", err)
	}

	// Start transaction
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Create organization
	org := &models.Organization{
		Name:        orgName,
		Description: &orgDescription,
	}
	if err := tx.Create(org).Error; err != nil {
		tx.Rollback()
		return nil, nil, fmt.Errorf("failed to create organization: %v", err)
	}

	// Create admin user
	// Generate unique username from organization name (not email!)
	// Example: "Acme Corp" -> "acmecorp_admin"
	// Remove special characters and spaces, convert to lowercase
	baseUsername := strings.ToLower(strings.ReplaceAll(orgName, " ", ""))
	// Remove any non-alphanumeric characters
	reg := regexp.MustCompile("[^a-z0-9]+")
	baseUsername = reg.ReplaceAllString(baseUsername, "")
	// Add _admin suffix to make it clear this is an admin user
	baseUsername = baseUsername + "_admin"

	username := baseUsername

	// Check if username already exists, if so add incremental suffix
	counter := 1
	for {
		var existingWithUsername models.User
		err := tx.Where("LOWER(username) = ?", strings.ToLower(username)).First(&existingWithUsername).Error
		if err != nil {
			// Username is available
			break
		}
		// Username exists, try with numeric suffix
		username = fmt.Sprintf("%s%d", baseUsername, counter)
		counter++

		// Safety check to prevent infinite loop (max 1000 attempts)
		if counter > 1000 {
			tx.Rollback()
			return nil, nil, errors.New("unable to generate unique username")
		}
	}

	admin := &models.User{
		Email:    strings.ToLower(adminEmail),
		Username: username,
		Password: hashedPassword,
		FullName: adminFullName,
		Role:     "org_admin",
		OrgID:    &org.ID,
	}
	if err := tx.Create(admin).Error; err != nil {
		tx.Rollback()
		return nil, nil, fmt.Errorf("failed to create admin user: %v", err)
	}

	// Commit transaction
	if err := tx.Commit().Error; err != nil {
		return nil, nil, fmt.Errorf("failed to commit transaction: %v", err)
	}

	return org, admin, nil
}

// ListAllOrganizations returns all organizations (super admin only)
func (s *OrganizationService) ListAllOrganizations() ([]models.Organization, error) {
	var orgs []models.Organization
	if err := s.db.Find(&orgs).Error; err != nil {
		return nil, fmt.Errorf("failed to list organizations: %v", err)
	}
	return orgs, nil
}

// GetOrganizationWithStats returns organization details with member count
func (s *OrganizationService) GetOrganizationWithStats(orgID string) (map[string]interface{}, error) {
	var org models.Organization
	if err := s.db.Where("id = ?", orgID).First(&org).Error; err != nil {
		return nil, errors.New("organization not found")
	}

	var memberCount int64
	s.db.Model(&models.User{}).Where("org_id = ?", orgID).Count(&memberCount)

	result := map[string]interface{}{
		"id":           org.ID,
		"name":         org.Name,
		"description":  org.Description,
		"created_at":   org.CreatedAt,
		"member_count": memberCount,
	}

	return result, nil
}

// ListOrganizationMembers returns all members of an organization
func (s *OrganizationService) ListOrganizationMembers(orgID string) ([]map[string]interface{}, error) {
	var users []models.User
	if err := s.db.Where("org_id = ?", orgID).Find(&users).Error; err != nil {
		return nil, fmt.Errorf("failed to list members: %v", err)
	}

	members := make([]map[string]interface{}, 0, len(users))
	for _, u := range users {
		members = append(members, map[string]interface{}{
			"id":         u.ID,
			"email":      u.Email,
			"username":   u.Username,
			"full_name":  u.FullName,
			"role":       u.Role,
			"created_at": u.CreatedAt,
		})
	}

	return members, nil
}

// RemoveOrganizationMember removes a user from an organization
func (s *OrganizationService) RemoveOrganizationMember(orgID, userID string) error {
	var user models.User
	if err := s.db.Where("id = ? AND org_id = ?", userID, orgID).First(&user).Error; err != nil {
		return errors.New("user not found in this organization")
	}

	// Prevent removing the last org admin
	if user.Role == "org_admin" {
		var adminCount int64
		s.db.Model(&models.User{}).Where("org_id = ? AND role = ?", orgID, "org_admin").Count(&adminCount)
		if adminCount <= 1 {
			return errors.New("cannot remove the last organization admin")
		}
	}

	// Set org_id to NULL (soft remove from org)
	if err := s.db.Model(&user).Update("org_id", nil).Error; err != nil {
		return fmt.Errorf("failed to remove member: %v", err)
	}

	return nil
}

// DeleteOrganization deletes an organization and all its members (super admin only)
func (s *OrganizationService) DeleteOrganization(orgID string) error {
	// Start transaction
	tx := s.db.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Remove all users from this organization
	if err := tx.Model(&models.User{}).Where("org_id = ?", orgID).Update("org_id", nil).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("failed to remove organization members: %v", err)
	}

	// Delete the organization
	if err := tx.Where("id = ?", orgID).Delete(&models.Organization{}).Error; err != nil {
		tx.Rollback()
		return fmt.Errorf("failed to delete organization: %v", err)
	}

	// Commit transaction
	if err := tx.Commit().Error; err != nil {
		return fmt.Errorf("failed to commit transaction: %v", err)
	}

	return nil
}

// GetPlatformAnalytics returns platform-wide statistics (super admin only)
func (s *OrganizationService) GetPlatformAnalytics() (map[string]interface{}, error) {
	var totalOrgs int64
	var totalUsers int64
	var activeUsersToday int64
	var totalTasks int64 // This would need task service integration

	s.db.Model(&models.Organization{}).Count(&totalOrgs)
	s.db.Model(&models.User{}).Count(&totalUsers)

	// Count users created today
	today := time.Now().Truncate(24 * time.Hour)
	s.db.Model(&models.User{}).Where("created_at >= ?", today).Count(&activeUsersToday)

	// TODO: Get task count from task service via gRPC
	totalTasks = 0

	return map[string]interface{}{
		"total_organizations": totalOrgs,
		"total_users":         totalUsers,
		"active_users_today":  activeUsersToday,
		"total_tasks":         totalTasks,
	}, nil
}
