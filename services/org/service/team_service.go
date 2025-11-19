package service

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/chanduchitikam/task-management-system/proto/organization"
	"github.com/chanduchitikam/task-management-system/services/org/models"
	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type OrganizationService struct {
	organization.UnimplementedOrganizationServiceServer
	db *sql.DB
}

func NewOrganizationService(db *sql.DB) *OrganizationService {
	return &OrganizationService{db: db}
}

// ============================================================================
// TEAM MANAGEMENT
// ============================================================================

func (s *OrganizationService) CreateTeam(ctx context.Context, req *organization.CreateTeamRequest) (*organization.CreateTeamResponse, error) {
	// Validate request
	if req.OrgId == "" || req.Name == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id and name are required")
	}

	teamID := uuid.New()
	var teamLeadID, parentTeamID *uuid.UUID

	if req.TeamLeadId != "" {
		id, err := uuid.Parse(req.TeamLeadId)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "invalid team_lead_id")
		}
		teamLeadID = &id
	}

	if req.ParentTeamId != "" {
		id, err := uuid.Parse(req.ParentTeamId)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "invalid parent_team_id")
		}
		parentTeamID = &id
	}

	orgID, err := uuid.Parse(req.OrgId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid org_id")
	}

	query := `
		INSERT INTO teams (id, org_id, name, description, team_lead_id, parent_team_id, status, metadata, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, created_at, updated_at
	`

	now := time.Now()
	var team models.Team
	err = s.db.QueryRowContext(ctx, query,
		teamID, orgID, req.Name, req.Description, teamLeadID, parentTeamID,
		"active", "{}", now, now,
	).Scan(&team.ID, &team.CreatedAt, &team.UpdatedAt)

	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create team: %v", err)
	}

	// Get full team details
	teamResp, err := s.GetTeam(ctx, &organization.GetTeamRequest{TeamId: teamID.String()})
	if err != nil {
		return nil, err
	}

	return &organization.CreateTeamResponse{
		Team:    teamResp.Team,
		Message: "Team created successfully",
	}, nil
}

func (s *OrganizationService) GetTeam(ctx context.Context, req *organization.GetTeamRequest) (*organization.GetTeamResponse, error) {
	teamID, err := uuid.Parse(req.TeamId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid team_id")
	}

	query := `
		SELECT t.id, t.org_id, t.name, t.description, t.team_lead_id, t.parent_team_id, 
		       t.status, t.metadata, t.created_at, t.updated_at, t.created_by,
		       u.id as lead_id, u.full_name as lead_name, u.email as lead_email, u.username as lead_username
		FROM teams t
		LEFT JOIN users u ON t.team_lead_id = u.id
		WHERE t.id = $1
	`

	var team models.Team
	var leadID sql.NullString
	var leadName, leadEmail, leadUsername sql.NullString

	err = s.db.QueryRowContext(ctx, query, teamID).Scan(
		&team.ID, &team.OrgID, &team.Name, &team.Description, &team.TeamLeadID,
		&team.ParentTeamID, &team.Status, &team.Metadata, &team.CreatedAt,
		&team.UpdatedAt, &team.CreatedBy,
		&leadID, &leadName, &leadEmail, &leadUsername,
	)

	if err == sql.ErrNoRows {
		return nil, status.Error(codes.NotFound, "team not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get team: %v", err)
	}

	// Get team members
	members, err := s.getTeamMembers(ctx, teamID)
	if err != nil {
		return nil, err
	}

	teamProto := &organization.Team{
		Id:          team.ID.String(),
		OrgId:       team.OrgID.String(),
		Name:        team.Name,
		Status:      team.Status,
		Metadata:    team.Metadata,
		CreatedAt:   timestamppb.New(team.CreatedAt),
		UpdatedAt:   timestamppb.New(team.UpdatedAt),
		Members:     members,
		MemberCount: int32(len(members)),
	}

	if team.TeamLeadID != nil {
		teamProto.TeamLeadId = team.TeamLeadID.String()
	}
	if team.Description != nil {
		teamProto.Description = *team.Description
	}
	if team.ParentTeamID != nil {
		teamProto.ParentTeamId = team.ParentTeamID.String()
	}
	if team.CreatedBy != nil {
		teamProto.CreatedBy = team.CreatedBy.String()
	}

	if leadID.Valid {
		teamProto.TeamLead = &organization.TeamLead{
			Id:       leadID.String,
			FullName: leadName.String,
			Email:    leadEmail.String,
			Username: leadUsername.String,
		}
	}

	return &organization.GetTeamResponse{Team: teamProto}, nil
}

func (s *OrganizationService) ListTeams(ctx context.Context, req *organization.ListTeamsRequest) (*organization.ListTeamsResponse, error) {
	orgID, err := uuid.Parse(req.OrgId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid org_id")
	}

	query := `
		SELECT t.id, t.org_id, t.name, t.description, t.team_lead_id, t.parent_team_id,
		       t.status, t.metadata, t.created_at, t.updated_at,
		       u.id as lead_id, u.full_name as lead_name, u.email as lead_email, u.username as lead_username,
		       COALESCE((SELECT COUNT(*) FROM team_members WHERE team_id = t.id AND is_active = true), 0) as member_count
		FROM teams t
		LEFT JOIN users u ON t.team_lead_id = u.id
		WHERE t.org_id = $1
	`

	args := []interface{}{orgID}
	if req.Status != "" {
		query += " AND t.status = $2"
		args = append(args, req.Status)
	}

	query += " ORDER BY t.created_at DESC"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list teams: %v", err)
	}
	defer rows.Close()

	var teams []*organization.Team

	for rows.Next() {
		var team models.Team
		var leadID, leadName, leadEmail, leadUsername sql.NullString
		var memberCount int32

		err := rows.Scan(
			&team.ID, &team.OrgID, &team.Name, &team.Description, &team.TeamLeadID,
			&team.ParentTeamID, &team.Status, &team.Metadata, &team.CreatedAt, &team.UpdatedAt,
			&leadID, &leadName, &leadEmail, &leadUsername, &memberCount,
		)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to scan team: %v", err)
		}

		teamProto := &organization.Team{
			Id:          team.ID.String(),
			OrgId:       team.OrgID.String(),
			Name:        team.Name,
			Status:      team.Status,
			Metadata:    team.Metadata,
			CreatedAt:   timestamppb.New(team.CreatedAt),
			UpdatedAt:   timestamppb.New(team.UpdatedAt),
			MemberCount: memberCount,
		}

		if team.Description != nil {
			teamProto.Description = *team.Description
		}
		if team.TeamLeadID != nil {
			teamProto.TeamLeadId = team.TeamLeadID.String()
		}
		if team.ParentTeamID != nil {
			teamProto.ParentTeamId = team.ParentTeamID.String()
		}

		if leadID.Valid {
			teamProto.TeamLead = &organization.TeamLead{
				Id:       leadID.String,
				FullName: leadName.String,
				Email:    leadEmail.String,
				Username: leadUsername.String,
			}
		}

		// Fetch team members
		membersQuery := `
			SELECT tm.id, tm.user_id, tm.role, tm.joined_at,
			       u.full_name, u.email, u.username
			FROM team_members tm
			JOIN users u ON tm.user_id = u.id
			WHERE tm.team_id = $1 AND tm.is_active = true
			ORDER BY tm.joined_at DESC
		`
		memberRows, err := s.db.QueryContext(ctx, membersQuery, team.ID)
		if err == nil {
			defer memberRows.Close()
			for memberRows.Next() {
				var member models.TeamMember
				var fullName, email, username string
				err := memberRows.Scan(
					&member.ID, &member.UserID, &member.Role, &member.JoinedAt,
					&fullName, &email, &username,
				)
				if err == nil {
					teamProto.Members = append(teamProto.Members, &organization.TeamMember{
						Id:       member.ID.String(),
						UserId:   member.UserID.String(),
						Role:     member.Role,
						FullName: fullName,
						Email:    email,
						Username: username,
						JoinedAt: timestamppb.New(member.JoinedAt),
					})
				}
			}
		}

		teams = append(teams, teamProto)
	}

	return &organization.ListTeamsResponse{
		Teams: teams,
		Total: int32(len(teams)),
	}, nil
}

func (s *OrganizationService) UpdateTeam(ctx context.Context, req *organization.UpdateTeamRequest) (*organization.UpdateTeamResponse, error) {
	teamID, err := uuid.Parse(req.TeamId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid team_id")
	}

	query := "UPDATE teams SET updated_at = $1"
	args := []interface{}{time.Now()}
	argCount := 2

	if req.Name != "" {
		query += fmt.Sprintf(", name = $%d", argCount)
		args = append(args, req.Name)
		argCount++
	}
	if req.Description != "" {
		query += fmt.Sprintf(", description = $%d", argCount)
		args = append(args, req.Description)
		argCount++
	}
	if req.TeamLeadId != "" {
		leadID, err := uuid.Parse(req.TeamLeadId)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "invalid team_lead_id")
		}
		query += fmt.Sprintf(", team_lead_id = $%d", argCount)
		args = append(args, leadID)
		argCount++
	}
	if req.Status != "" {
		query += fmt.Sprintf(", status = $%d", argCount)
		args = append(args, req.Status)
		argCount++
	}

	query += fmt.Sprintf(" WHERE id = $%d", argCount)
	args = append(args, teamID)

	_, err = s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update team: %v", err)
	}

	teamResp, err := s.GetTeam(ctx, &organization.GetTeamRequest{TeamId: teamID.String()})
	if err != nil {
		return nil, err
	}

	return &organization.UpdateTeamResponse{
		Team:    teamResp.Team,
		Message: "Team updated successfully",
	}, nil
}

func (s *OrganizationService) DeleteTeam(ctx context.Context, req *organization.DeleteTeamRequest) (*organization.DeleteTeamResponse, error) {
	teamID, err := uuid.Parse(req.TeamId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid team_id")
	}

	query := "DELETE FROM teams WHERE id = $1"
	result, err := s.db.ExecContext(ctx, query, teamID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete team: %v", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return nil, status.Error(codes.NotFound, "team not found")
	}

	return &organization.DeleteTeamResponse{
		Message: "Team deleted successfully",
	}, nil
}

func (s *OrganizationService) AddTeamMember(ctx context.Context, req *organization.AddTeamMemberRequest) (*organization.AddTeamMemberResponse, error) {
	teamID, err := uuid.Parse(req.TeamId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid team_id")
	}

	userID, err := uuid.Parse(req.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid user_id")
	}

	memberID := uuid.New()
	role := req.Role
	if role == "" {
		role = "member"
	}

	query := `
		INSERT INTO team_members (id, team_id, user_id, role, joined_at, is_active)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (team_id, user_id) DO UPDATE
		SET is_active = true, role = $4, left_at = NULL
		RETURNING id
	`

	err = s.db.QueryRowContext(ctx, query, memberID, teamID, userID, role, time.Now(), true).Scan(&memberID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to add team member: %v", err)
	}

	// Get member details
	member, err := s.getTeamMember(ctx, teamID, userID)
	if err != nil {
		return nil, err
	}

	return &organization.AddTeamMemberResponse{
		Member:  member,
		Message: "Member added to team successfully",
	}, nil
}

func (s *OrganizationService) RemoveTeamMember(ctx context.Context, req *organization.RemoveTeamMemberRequest) (*organization.RemoveTeamMemberResponse, error) {
	teamID, err := uuid.Parse(req.TeamId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid team_id")
	}

	userID, err := uuid.Parse(req.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid user_id")
	}

	query := "UPDATE team_members SET is_active = false, left_at = $1 WHERE team_id = $2 AND user_id = $3"
	_, err = s.db.ExecContext(ctx, query, time.Now(), teamID, userID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to remove team member: %v", err)
	}

	return &organization.RemoveTeamMemberResponse{
		Message: "Member removed from team successfully",
	}, nil
}

func (s *OrganizationService) ListTeamMembers(ctx context.Context, req *organization.ListTeamMembersRequest) (*organization.ListTeamMembersResponse, error) {
	teamID, err := uuid.Parse(req.TeamId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid team_id")
	}

	members, err := s.getTeamMembers(ctx, teamID)
	if err != nil {
		return nil, err
	}

	return &organization.ListTeamMembersResponse{Members: members}, nil
}

// Helper functions

func (s *OrganizationService) getTeamMembers(ctx context.Context, teamID uuid.UUID) ([]*organization.TeamMember, error) {
	query := `
		SELECT tm.id, tm.team_id, tm.user_id, tm.role, tm.joined_at, tm.is_active,
		       u.full_name, u.email, u.username
		FROM team_members tm
		JOIN users u ON tm.user_id = u.id
		WHERE tm.team_id = $1 AND tm.is_active = true
		ORDER BY tm.joined_at DESC
	`

	rows, err := s.db.QueryContext(ctx, query, teamID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get team members: %v", err)
	}
	defer rows.Close()

	var members []*organization.TeamMember

	for rows.Next() {
		var member models.TeamMember
		err := rows.Scan(
			&member.ID, &member.TeamID, &member.UserID, &member.Role, &member.JoinedAt, &member.IsActive,
			&member.FullName, &member.Email, &member.Username,
		)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to scan team member: %v", err)
		}

		members = append(members, &organization.TeamMember{
			Id:       member.ID.String(),
			TeamId:   member.TeamID.String(),
			UserId:   member.UserID.String(),
			Role:     member.Role,
			JoinedAt: timestamppb.New(member.JoinedAt),
			IsActive: member.IsActive,
			FullName: member.FullName,
			Email:    member.Email,
			Username: member.Username,
		})
	}

	return members, nil
}

func (s *OrganizationService) getTeamMember(ctx context.Context, teamID, userID uuid.UUID) (*organization.TeamMember, error) {
	query := `
		SELECT tm.id, tm.team_id, tm.user_id, tm.role, tm.joined_at, tm.is_active,
		       u.full_name, u.email, u.username
		FROM team_members tm
		JOIN users u ON tm.user_id = u.id
		WHERE tm.team_id = $1 AND tm.user_id = $2
	`

	var member models.TeamMember
	err := s.db.QueryRowContext(ctx, query, teamID, userID).Scan(
		&member.ID, &member.TeamID, &member.UserID, &member.Role, &member.JoinedAt, &member.IsActive,
		&member.FullName, &member.Email, &member.Username,
	)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get team member: %v", err)
	}

	return &organization.TeamMember{
		Id:       member.ID.String(),
		TeamId:   member.TeamID.String(),
		UserId:   member.UserID.String(),
		Role:     member.Role,
		JoinedAt: timestamppb.New(member.JoinedAt),
		IsActive: member.IsActive,
		FullName: member.FullName,
		Email:    member.Email,
		Username: member.Username,
	}, nil
}
