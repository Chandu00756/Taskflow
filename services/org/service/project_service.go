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

// ============================================================================
// PROJECT MANAGEMENT
// ============================================================================

func (s *OrganizationService) CreateProject(ctx context.Context, req *organization.CreateProjectRequest) (*organization.CreateProjectResponse, error) {
	if req.OrgId == "" || req.Name == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id and name are required")
	}

	projectID := uuid.New()
	orgID, err := uuid.Parse(req.OrgId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid org_id")
	}

	var managerID *uuid.UUID
	if req.ProjectManagerId != "" {
		id, err := uuid.Parse(req.ProjectManagerId)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "invalid project_manager_id")
		}
		managerID = &id
	}

	priority := req.Priority
	if priority == "" {
		priority = "medium"
	}

	var startDate, endDate *time.Time
	if req.StartDate != "" {
		t, err := time.Parse("2006-01-02", req.StartDate)
		if err == nil {
			startDate = &t
		}
	}
	if req.EndDate != "" {
		t, err := time.Parse("2006-01-02", req.EndDate)
		if err == nil {
			endDate = &t
		}
	}

	query := `
		INSERT INTO projects (id, org_id, name, description, project_manager_id, status, priority, start_date, end_date, budget, progress, metadata, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
	`

	now := time.Now()
	_, err = s.db.ExecContext(ctx, query,
		projectID, orgID, req.Name, req.Description, managerID, "planning", priority,
		startDate, endDate, req.Budget, 0, "{}", now, now,
	)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create project: %v", err)
	}

	projectResp, err := s.GetProject(ctx, &organization.GetProjectRequest{ProjectId: projectID.String()})
	if err != nil {
		return nil, err
	}

	return &organization.CreateProjectResponse{
		Project: projectResp.Project,
		Message: "Project created successfully",
	}, nil
}

func (s *OrganizationService) GetProject(ctx context.Context, req *organization.GetProjectRequest) (*organization.GetProjectResponse, error) {
	projectID, err := uuid.Parse(req.ProjectId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid project_id")
	}

	query := `
		SELECT p.id, p.org_id, p.name, p.description, p.project_manager_id, p.status, p.priority,
		       p.start_date, p.end_date, p.budget, p.progress, p.metadata, p.created_at, p.updated_at, p.created_by,
		       u.id as manager_id, u.full_name as manager_name, u.email as manager_email, u.username as manager_username,
		       COALESCE((SELECT COUNT(*) FROM project_teams WHERE project_id = p.id), 0) as team_count,
		       COALESCE((SELECT COUNT(*) FROM project_members WHERE project_id = p.id AND is_active = true), 0) as member_count
		FROM projects p
		LEFT JOIN users u ON p.project_manager_id = u.id
		WHERE p.id = $1
	`

	var project models.Project
	var managerID, managerName, managerEmail, managerUsername sql.NullString
	var startDate, endDate sql.NullTime
	var budget sql.NullFloat64
	var teamCount, memberCount int32

	err = s.db.QueryRowContext(ctx, query, projectID).Scan(
		&project.ID, &project.OrgID, &project.Name, &project.Description, &project.ProjectManagerID,
		&project.Status, &project.Priority, &startDate, &endDate, &budget, &project.Progress,
		&project.Metadata, &project.CreatedAt, &project.UpdatedAt, &project.CreatedBy,
		&managerID, &managerName, &managerEmail, &managerUsername, &teamCount, &memberCount,
	)

	if err == sql.ErrNoRows {
		return nil, status.Error(codes.NotFound, "project not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get project: %v", err)
	}

	projectProto := &organization.Project{
		Id:          project.ID.String(),
		OrgId:       project.OrgID.String(),
		Name:        project.Name,
		Status:      project.Status,
		Priority:    project.Priority,
		Progress:    project.Progress,
		Metadata:    project.Metadata,
		CreatedAt:   timestamppb.New(project.CreatedAt),
		UpdatedAt:   timestamppb.New(project.UpdatedAt),
		TeamCount:   teamCount,
		MemberCount: memberCount,
	}

	if project.Description != nil {
		projectProto.Description = *project.Description
	}
	if project.ProjectManagerID != nil {
		projectProto.ProjectManagerId = project.ProjectManagerID.String()
	}
	if project.CreatedBy != nil {
		projectProto.CreatedBy = project.CreatedBy.String()
	}
	if startDate.Valid {
		projectProto.StartDate = startDate.Time.Format("2006-01-02")
	}
	if endDate.Valid {
		projectProto.EndDate = endDate.Time.Format("2006-01-02")
	}
	if budget.Valid {
		projectProto.Budget = budget.Float64
	}

	if managerID.Valid {
		projectProto.ProjectManager = &organization.ProjectManager{
			Id:       managerID.String,
			FullName: managerName.String,
			Email:    managerEmail.String,
			Username: managerUsername.String,
		}
	}

	return &organization.GetProjectResponse{Project: projectProto}, nil
}

func (s *OrganizationService) ListProjects(ctx context.Context, req *organization.ListProjectsRequest) (*organization.ListProjectsResponse, error) {
	orgID, err := uuid.Parse(req.OrgId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid org_id")
	}

	query := `
		SELECT p.id, p.org_id, p.name, p.description, p.project_manager_id, p.status, p.priority,
		       p.start_date, p.end_date, p.budget, p.progress, p.metadata, p.created_at, p.updated_at,
		       u.id as manager_id, u.full_name as manager_name, u.email as manager_email, u.username as manager_username,
		       COALESCE((SELECT COUNT(*) FROM project_teams WHERE project_id = p.id), 0) as team_count,
		       COALESCE((SELECT COUNT(*) FROM project_members WHERE project_id = p.id AND is_active = true), 0) as member_count
		FROM projects p
		LEFT JOIN users u ON p.project_manager_id = u.id
		WHERE p.org_id = $1
	`

	args := []interface{}{orgID}
	argCount := 2

	if req.Status != "" {
		query += fmt.Sprintf(" AND p.status = $%d", argCount)
		args = append(args, req.Status)
		argCount++
	}
	if req.Priority != "" {
		query += fmt.Sprintf(" AND p.priority = $%d", argCount)
		args = append(args, req.Priority)
		argCount++
	}

	query += " ORDER BY p.created_at DESC"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list projects: %v", err)
	}
	defer rows.Close()

	var projects []*organization.Project

	for rows.Next() {
		var project models.Project
		var managerID, managerName, managerEmail, managerUsername sql.NullString
		var startDate, endDate sql.NullTime
		var budget sql.NullFloat64
		var teamCount, memberCount int32

		err := rows.Scan(
			&project.ID, &project.OrgID, &project.Name, &project.Description, &project.ProjectManagerID,
			&project.Status, &project.Priority, &startDate, &endDate, &budget, &project.Progress,
			&project.Metadata, &project.CreatedAt, &project.UpdatedAt,
			&managerID, &managerName, &managerEmail, &managerUsername, &teamCount, &memberCount,
		)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to scan project: %v", err)
		}

		projectProto := &organization.Project{
			Id:          project.ID.String(),
			OrgId:       project.OrgID.String(),
			Name:        project.Name,
			Status:      project.Status,
			Priority:    project.Priority,
			Progress:    project.Progress,
			Metadata:    project.Metadata,
			CreatedAt:   timestamppb.New(project.CreatedAt),
			UpdatedAt:   timestamppb.New(project.UpdatedAt),
			TeamCount:   teamCount,
			MemberCount: memberCount,
		}

		if project.Description != nil {
			projectProto.Description = *project.Description
		}
		if project.ProjectManagerID != nil {
			projectProto.ProjectManagerId = project.ProjectManagerID.String()
		}
		if startDate.Valid {
			projectProto.StartDate = startDate.Time.Format("2006-01-02")
		}
		if endDate.Valid {
			projectProto.EndDate = endDate.Time.Format("2006-01-02")
		}
		if budget.Valid {
			projectProto.Budget = budget.Float64
		}

		if managerID.Valid {
			projectProto.ProjectManager = &organization.ProjectManager{
				Id:       managerID.String,
				FullName: managerName.String,
				Email:    managerEmail.String,
				Username: managerUsername.String,
			}
		}

		// Fetch project members
		membersQuery := `
			SELECT pm.id, pm.user_id, pm.role, pm.joined_at,
			       u.full_name, u.email, u.username
			FROM project_members pm
			JOIN users u ON pm.user_id = u.id
			WHERE pm.project_id = $1 AND pm.is_active = true
			ORDER BY pm.joined_at DESC
		`
		memberRows, err := s.db.QueryContext(ctx, membersQuery, project.ID)
		if err == nil {
			defer memberRows.Close()
			for memberRows.Next() {
				var member models.ProjectMember
				var fullName, email, username string
				err := memberRows.Scan(
					&member.ID, &member.UserID, &member.Role, &member.JoinedAt,
					&fullName, &email, &username,
				)
				if err == nil {
					projectProto.Members = append(projectProto.Members, &organization.ProjectMember{
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

		projects = append(projects, projectProto)
	}

	return &organization.ListProjectsResponse{
		Projects: projects,
		Total:    int32(len(projects)),
	}, nil
}

func (s *OrganizationService) UpdateProject(ctx context.Context, req *organization.UpdateProjectRequest) (*organization.UpdateProjectResponse, error) {
	projectID, err := uuid.Parse(req.ProjectId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid project_id")
	}

	query := "UPDATE projects SET updated_at = $1"
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
	if req.Status != "" {
		query += fmt.Sprintf(", status = $%d", argCount)
		args = append(args, req.Status)
		argCount++
	}
	if req.Priority != "" {
		query += fmt.Sprintf(", priority = $%d", argCount)
		args = append(args, req.Priority)
		argCount++
	}
	if req.Progress > 0 {
		query += fmt.Sprintf(", progress = $%d", argCount)
		args = append(args, req.Progress)
		argCount++
	}
	if req.Budget > 0 {
		query += fmt.Sprintf(", budget = $%d", argCount)
		args = append(args, req.Budget)
		argCount++
	}

	query += fmt.Sprintf(" WHERE id = $%d", argCount)
	args = append(args, projectID)

	_, err = s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update project: %v", err)
	}

	projectResp, err := s.GetProject(ctx, &organization.GetProjectRequest{ProjectId: projectID.String()})
	if err != nil {
		return nil, err
	}

	return &organization.UpdateProjectResponse{
		Project: projectResp.Project,
		Message: "Project updated successfully",
	}, nil
}

func (s *OrganizationService) DeleteProject(ctx context.Context, req *organization.DeleteProjectRequest) (*organization.DeleteProjectResponse, error) {
	projectID, err := uuid.Parse(req.ProjectId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid project_id")
	}

	query := "DELETE FROM projects WHERE id = $1"
	result, err := s.db.ExecContext(ctx, query, projectID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete project: %v", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return nil, status.Error(codes.NotFound, "project not found")
	}

	return &organization.DeleteProjectResponse{
		Message: "Project deleted successfully",
	}, nil
}

func (s *OrganizationService) AssignTeamToProject(ctx context.Context, req *organization.AssignTeamToProjectRequest) (*organization.AssignTeamToProjectResponse, error) {
	projectID, err := uuid.Parse(req.ProjectId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid project_id")
	}

	teamID, err := uuid.Parse(req.TeamId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid team_id")
	}

	ptID := uuid.New()
	query := `
		INSERT INTO project_teams (id, project_id, team_id, assigned_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (project_id, team_id) DO NOTHING
		RETURNING id
	`

	err = s.db.QueryRowContext(ctx, query, ptID, projectID, teamID, time.Now()).Scan(&ptID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to assign team to project: %v", err)
	}

	return &organization.AssignTeamToProjectResponse{
		Message: "Team assigned to project successfully",
	}, nil
}

func (s *OrganizationService) RemoveTeamFromProject(ctx context.Context, req *organization.RemoveTeamFromProjectRequest) (*organization.RemoveTeamFromProjectResponse, error) {
	projectID, err := uuid.Parse(req.ProjectId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid project_id")
	}

	teamID, err := uuid.Parse(req.TeamId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid team_id")
	}

	query := "DELETE FROM project_teams WHERE project_id = $1 AND team_id = $2"
	_, err = s.db.ExecContext(ctx, query, projectID, teamID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to remove team from project: %v", err)
	}

	return &organization.RemoveTeamFromProjectResponse{
		Message: "Team removed from project successfully",
	}, nil
}

func (s *OrganizationService) AddProjectMember(ctx context.Context, req *organization.AddProjectMemberRequest) (*organization.AddProjectMemberResponse, error) {
	projectID, err := uuid.Parse(req.ProjectId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid project_id")
	}

	userID, err := uuid.Parse(req.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid user_id")
	}

	memberID := uuid.New()
	role := req.Role
	if role == "" {
		role = "contributor"
	}
	allocation := req.AllocationPercentage
	if allocation <= 0 {
		allocation = 100
	}

	query := `
		INSERT INTO project_members (id, project_id, user_id, role, allocation_percentage, joined_at, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (project_id, user_id) DO UPDATE
		SET is_active = true, role = $4, allocation_percentage = $5, left_at = NULL
		RETURNING id
	`

	err = s.db.QueryRowContext(ctx, query, memberID, projectID, userID, role, allocation, time.Now(), true).Scan(&memberID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to add project member: %v", err)
	}

	return &organization.AddProjectMemberResponse{
		Message: "Member added to project successfully",
	}, nil
}

func (s *OrganizationService) RemoveProjectMember(ctx context.Context, req *organization.RemoveProjectMemberRequest) (*organization.RemoveProjectMemberResponse, error) {
	projectID, err := uuid.Parse(req.ProjectId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid project_id")
	}

	userID, err := uuid.Parse(req.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid user_id")
	}

	query := "UPDATE project_members SET is_active = false, left_at = $1 WHERE project_id = $2 AND user_id = $3"
	_, err = s.db.ExecContext(ctx, query, time.Now(), projectID, userID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to remove project member: %v", err)
	}

	return &organization.RemoveProjectMemberResponse{
		Message: "Member removed from project successfully",
	}, nil
}
