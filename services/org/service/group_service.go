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
// GROUP MANAGEMENT
// ============================================================================

func (s *OrganizationService) CreateGroup(ctx context.Context, req *organization.CreateGroupRequest) (*organization.CreateGroupResponse, error) {
	if req.OrgId == "" || req.Name == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id and name are required")
	}

	groupID := uuid.New()
	orgID, err := uuid.Parse(req.OrgId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid org_id")
	}

	var ownerID *uuid.UUID
	if req.OwnerId != "" {
		id, err := uuid.Parse(req.OwnerId)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "invalid owner_id")
		}
		ownerID = &id
	}

	groupType := req.GroupType
	if groupType == "" {
		groupType = "functional"
	}

	query := `
		INSERT INTO groups (id, org_id, name, description, group_type, owner_id, status, metadata, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`

	now := time.Now()
	_, err = s.db.ExecContext(ctx, query,
		groupID, orgID, req.Name, req.Description, groupType, ownerID, "active", "{}", now, now,
	)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create group: %v", err)
	}

	groupResp, err := s.GetGroup(ctx, &organization.GetGroupRequest{GroupId: groupID.String()})
	if err != nil {
		return nil, err
	}

	return &organization.CreateGroupResponse{
		Group:   groupResp.Group,
		Message: "Group created successfully",
	}, nil
}

func (s *OrganizationService) GetGroup(ctx context.Context, req *organization.GetGroupRequest) (*organization.GetGroupResponse, error) {
	groupID, err := uuid.Parse(req.GroupId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid group_id")
	}

	query := `
		SELECT g.id, g.org_id, g.name, g.description, g.group_type, g.owner_id, g.status, g.metadata, g.created_at, g.updated_at, g.created_by,
		       u.id as owner_id, u.full_name as owner_name, u.email as owner_email, u.username as owner_username,
		       COALESCE((SELECT COUNT(*) FROM group_members WHERE group_id = g.id AND is_active = true), 0) as member_count
		FROM groups g
		LEFT JOIN users u ON g.owner_id = u.id
		WHERE g.id = $1
	`

	var group models.Group
	var ownerID, ownerName, ownerEmail, ownerUsername sql.NullString
	var memberCount int32

	err = s.db.QueryRowContext(ctx, query, groupID).Scan(
		&group.ID, &group.OrgID, &group.Name, &group.Description, &group.GroupType,
		&group.OwnerID, &group.Status, &group.Metadata, &group.CreatedAt, &group.UpdatedAt,
		&group.CreatedBy, &ownerID, &ownerName, &ownerEmail, &ownerUsername, &memberCount,
	)

	if err == sql.ErrNoRows {
		return nil, status.Error(codes.NotFound, "group not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get group: %v", err)
	}

	groupProto := &organization.Group{
		Id:          group.ID.String(),
		OrgId:       group.OrgID.String(),
		Name:        group.Name,
		GroupType:   group.GroupType,
		Status:      group.Status,
		Metadata:    group.Metadata,
		CreatedAt:   timestamppb.New(group.CreatedAt),
		UpdatedAt:   timestamppb.New(group.UpdatedAt),
		MemberCount: memberCount,
	}

	if group.Description != nil {
		groupProto.Description = *group.Description
	}
	if group.OwnerID != nil {
		groupProto.OwnerId = group.OwnerID.String()
	}
	if group.CreatedBy != nil {
		groupProto.CreatedBy = group.CreatedBy.String()
	}

	if ownerID.Valid {
		groupProto.Owner = &organization.GroupOwner{
			Id:       ownerID.String,
			FullName: ownerName.String,
			Email:    ownerEmail.String,
			Username: ownerUsername.String,
		}
	}

	members, err := s.getGroupMembers(ctx, groupID)
	if err != nil {
		return nil, err
	}
	groupProto.Members = members

	return &organization.GetGroupResponse{Group: groupProto}, nil
}

func (s *OrganizationService) ListGroups(ctx context.Context, req *organization.ListGroupsRequest) (*organization.ListGroupsResponse, error) {
	orgID, err := uuid.Parse(req.OrgId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid org_id")
	}

	query := `
		SELECT g.id, g.org_id, g.name, g.description, g.group_type, g.owner_id, g.status, g.metadata, g.created_at, g.updated_at,
		       u.id as owner_id, u.full_name as owner_name, u.email as owner_email, u.username as owner_username,
		       COALESCE((SELECT COUNT(*) FROM group_members WHERE group_id = g.id AND is_active = true), 0) as member_count
		FROM groups g
		LEFT JOIN users u ON g.owner_id = u.id
		WHERE g.org_id = $1
	`

	args := []interface{}{orgID}
	if req.GroupType != "" {
		query += " AND g.group_type = $2"
		args = append(args, req.GroupType)
	}

	query += " ORDER BY g.created_at DESC"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list groups: %v", err)
	}
	defer rows.Close()

	var groups []*organization.Group

	for rows.Next() {
		var group models.Group
		var ownerID, ownerName, ownerEmail, ownerUsername sql.NullString
		var memberCount int32

		err := rows.Scan(
			&group.ID, &group.OrgID, &group.Name, &group.Description, &group.GroupType,
			&group.OwnerID, &group.Status, &group.Metadata, &group.CreatedAt, &group.UpdatedAt,
			&ownerID, &ownerName, &ownerEmail, &ownerUsername, &memberCount,
		)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to scan group: %v", err)
		}

		groupProto := &organization.Group{
			Id:          group.ID.String(),
			OrgId:       group.OrgID.String(),
			Name:        group.Name,
			GroupType:   group.GroupType,
			Status:      group.Status,
			Metadata:    group.Metadata,
			CreatedAt:   timestamppb.New(group.CreatedAt),
			UpdatedAt:   timestamppb.New(group.UpdatedAt),
			MemberCount: memberCount,
		}

		if group.Description != nil {
			groupProto.Description = *group.Description
		}
		if group.OwnerID != nil {
			groupProto.OwnerId = group.OwnerID.String()
		}

		if ownerID.Valid {
			groupProto.Owner = &organization.GroupOwner{
				Id:       ownerID.String,
				FullName: ownerName.String,
				Email:    ownerEmail.String,
				Username: ownerUsername.String,
			}
		}

		groups = append(groups, groupProto)
	}

	return &organization.ListGroupsResponse{
		Groups: groups,
		Total:  int32(len(groups)),
	}, nil
}

func (s *OrganizationService) UpdateGroup(ctx context.Context, req *organization.UpdateGroupRequest) (*organization.UpdateGroupResponse, error) {
	groupID, err := uuid.Parse(req.GroupId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid group_id")
	}

	query := "UPDATE groups SET updated_at = $1"
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

	query += fmt.Sprintf(" WHERE id = $%d", argCount)
	args = append(args, groupID)

	_, err = s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update group: %v", err)
	}

	groupResp, err := s.GetGroup(ctx, &organization.GetGroupRequest{GroupId: groupID.String()})
	if err != nil {
		return nil, err
	}

	return &organization.UpdateGroupResponse{
		Group:   groupResp.Group,
		Message: "Group updated successfully",
	}, nil
}

func (s *OrganizationService) DeleteGroup(ctx context.Context, req *organization.DeleteGroupRequest) (*organization.DeleteGroupResponse, error) {
	groupID, err := uuid.Parse(req.GroupId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid group_id")
	}

	query := "DELETE FROM groups WHERE id = $1"
	result, err := s.db.ExecContext(ctx, query, groupID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete group: %v", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return nil, status.Error(codes.NotFound, "group not found")
	}

	return &organization.DeleteGroupResponse{
		Message: "Group deleted successfully",
	}, nil
}

func (s *OrganizationService) AddGroupMember(ctx context.Context, req *organization.AddGroupMemberRequest) (*organization.AddGroupMemberResponse, error) {
	groupID, err := uuid.Parse(req.GroupId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid group_id")
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
		INSERT INTO group_members (id, group_id, user_id, role, joined_at, is_active)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (group_id, user_id) DO UPDATE
		SET is_active = true, role = $4
		RETURNING id
	`

	err = s.db.QueryRowContext(ctx, query, memberID, groupID, userID, role, time.Now(), true).Scan(&memberID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to add group member: %v", err)
	}

	member, err := s.getGroupMember(ctx, groupID, userID)
	if err != nil {
		return nil, err
	}

	return &organization.AddGroupMemberResponse{
		Member:  member,
		Message: "Member added to group successfully",
	}, nil
}

func (s *OrganizationService) RemoveGroupMember(ctx context.Context, req *organization.RemoveGroupMemberRequest) (*organization.RemoveGroupMemberResponse, error) {
	groupID, err := uuid.Parse(req.GroupId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid group_id")
	}

	userID, err := uuid.Parse(req.UserId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid user_id")
	}

	query := "UPDATE group_members SET is_active = false WHERE group_id = $1 AND user_id = $2"
	_, err = s.db.ExecContext(ctx, query, groupID, userID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to remove group member: %v", err)
	}

	return &organization.RemoveGroupMemberResponse{
		Message: "Member removed from group successfully",
	}, nil
}

// Helper functions

func (s *OrganizationService) getGroupMembers(ctx context.Context, groupID uuid.UUID) ([]*organization.GroupMember, error) {
	query := `
		SELECT gm.id, gm.group_id, gm.user_id, gm.role, gm.joined_at, gm.is_active,
		       u.full_name, u.email, u.username,
		       COALESCE((SELECT t.name FROM team_members tm JOIN teams t ON tm.team_id = t.id WHERE tm.user_id = u.id AND tm.is_active = true LIMIT 1), '') as team_name
		FROM group_members gm
		JOIN users u ON gm.user_id = u.id
		WHERE gm.group_id = $1 AND gm.is_active = true
		ORDER BY gm.joined_at DESC
	`

	rows, err := s.db.QueryContext(ctx, query, groupID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get group members: %v", err)
	}
	defer rows.Close()

	var members []*organization.GroupMember

	for rows.Next() {
		var member models.GroupMember
		err := rows.Scan(
			&member.ID, &member.GroupID, &member.UserID, &member.Role, &member.JoinedAt, &member.IsActive,
			&member.FullName, &member.Email, &member.Username, &member.TeamName,
		)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to scan group member: %v", err)
		}

		members = append(members, &organization.GroupMember{
			Id:       member.ID.String(),
			GroupId:  member.GroupID.String(),
			UserId:   member.UserID.String(),
			Role:     member.Role,
			JoinedAt: timestamppb.New(member.JoinedAt),
			IsActive: member.IsActive,
			FullName: member.FullName,
			Email:    member.Email,
			Username: member.Username,
			TeamName: member.TeamName,
		})
	}

	return members, nil
}

func (s *OrganizationService) getGroupMember(ctx context.Context, groupID, userID uuid.UUID) (*organization.GroupMember, error) {
	query := `
		SELECT gm.id, gm.group_id, gm.user_id, gm.role, gm.joined_at, gm.is_active,
		       u.full_name, u.email, u.username
		FROM group_members gm
		JOIN users u ON gm.user_id = u.id
		WHERE gm.group_id = $1 AND gm.user_id = $2
	`

	var member models.GroupMember
	err := s.db.QueryRowContext(ctx, query, groupID, userID).Scan(
		&member.ID, &member.GroupID, &member.UserID, &member.Role, &member.JoinedAt, &member.IsActive,
		&member.FullName, &member.Email, &member.Username,
	)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get group member: %v", err)
	}

	return &organization.GroupMember{
		Id:       member.ID.String(),
		GroupId:  member.GroupID.String(),
		UserId:   member.UserID.String(),
		Role:     member.Role,
		JoinedAt: timestamppb.New(member.JoinedAt),
		IsActive: member.IsActive,
		FullName: member.FullName,
		Email:    member.Email,
		Username: member.Username,
	}, nil
}

// ============================================================================
// WORKSPACE MANAGEMENT
// ============================================================================

func (s *OrganizationService) CreateWorkspace(ctx context.Context, req *organization.CreateWorkspaceRequest) (*organization.CreateWorkspaceResponse, error) {
	if req.OrgId == "" || req.Name == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id and name are required")
	}

	workspaceID := uuid.New()
	orgID, err := uuid.Parse(req.OrgId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid org_id")
	}

	var teamID, projectID *uuid.UUID
	if req.TeamId != "" {
		id, err := uuid.Parse(req.TeamId)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "invalid team_id")
		}
		teamID = &id
	}
	if req.ProjectId != "" {
		id, err := uuid.Parse(req.ProjectId)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "invalid project_id")
		}
		projectID = &id
	}

	workspaceType := req.WorkspaceType
	if workspaceType == "" {
		workspaceType = "general"
	}

	query := `
		INSERT INTO workspaces (id, org_id, name, description, workspace_type, team_id, project_id, settings, is_private, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, created_at, updated_at
	`

	now := time.Now()
	var workspace models.Workspace
	err = s.db.QueryRowContext(ctx, query,
		workspaceID, orgID, req.Name, req.Description, workspaceType, teamID, projectID,
		"{}", req.IsPrivate, now, now,
	).Scan(&workspace.ID, &workspace.CreatedAt, &workspace.UpdatedAt)

	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create workspace: %v", err)
	}

	workspaceProto := &organization.Workspace{
		Id:            workspace.ID.String(),
		OrgId:         orgID.String(),
		Name:          req.Name,
		Description:   req.Description,
		WorkspaceType: workspaceType,
		Settings:      "{}",
		IsPrivate:     req.IsPrivate,
		CreatedAt:     timestamppb.New(workspace.CreatedAt),
		UpdatedAt:     timestamppb.New(workspace.UpdatedAt),
	}

	if teamID != nil {
		workspaceProto.TeamId = teamID.String()
	}
	if projectID != nil {
		workspaceProto.ProjectId = projectID.String()
	}

	return &organization.CreateWorkspaceResponse{
		Workspace: workspaceProto,
		Message:   "Workspace created successfully",
	}, nil
}

func (s *OrganizationService) ListWorkspaces(ctx context.Context, req *organization.ListWorkspacesRequest) (*organization.ListWorkspacesResponse, error) {
	orgID, err := uuid.Parse(req.OrgId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid org_id")
	}

	query := `
		SELECT id, org_id, name, description, workspace_type, team_id, project_id, owner_id, settings, is_private, created_at, updated_at
		FROM workspaces
		WHERE org_id = $1
	`

	args := []interface{}{orgID}
	argCount := 2

	if req.TeamId != "" {
		query += fmt.Sprintf(" AND team_id = $%d", argCount)
		teamID, err := uuid.Parse(req.TeamId)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "invalid team_id")
		}
		args = append(args, teamID)
		argCount++
	}

	if req.ProjectId != "" {
		query += fmt.Sprintf(" AND project_id = $%d", argCount)
		projectID, err := uuid.Parse(req.ProjectId)
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "invalid project_id")
		}
		args = append(args, projectID)
	}

	query += " ORDER BY created_at DESC"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list workspaces: %v", err)
	}
	defer rows.Close()

	var workspaces []*organization.Workspace

	for rows.Next() {
		var ws models.Workspace
		err := rows.Scan(
			&ws.ID, &ws.OrgID, &ws.Name, &ws.Description, &ws.WorkspaceType,
			&ws.TeamID, &ws.ProjectID, &ws.OwnerID, &ws.Settings, &ws.IsPrivate,
			&ws.CreatedAt, &ws.UpdatedAt,
		)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to scan workspace: %v", err)
		}

		wsProto := &organization.Workspace{
			Id:            ws.ID.String(),
			OrgId:         ws.OrgID.String(),
			Name:          ws.Name,
			WorkspaceType: ws.WorkspaceType,
			Settings:      ws.Settings,
			IsPrivate:     ws.IsPrivate,
			CreatedAt:     timestamppb.New(ws.CreatedAt),
			UpdatedAt:     timestamppb.New(ws.UpdatedAt),
		}

		if ws.Description != nil {
			wsProto.Description = *ws.Description
		}
		if ws.TeamID != nil {
			wsProto.TeamId = ws.TeamID.String()
		}
		if ws.ProjectID != nil {
			wsProto.ProjectId = ws.ProjectID.String()
		}
		if ws.OwnerID != nil {
			wsProto.OwnerId = ws.OwnerID.String()
		}

		workspaces = append(workspaces, wsProto)
	}

	return &organization.ListWorkspacesResponse{
		Workspaces: workspaces,
	}, nil
}
