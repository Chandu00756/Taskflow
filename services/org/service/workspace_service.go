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

// Missing workspace operations: Get, Update, Delete

func (s *OrganizationService) GetWorkspace(ctx context.Context, req *organization.GetWorkspaceRequest) (*organization.GetWorkspaceResponse, error) {
	workspaceID, err := uuid.Parse(req.WorkspaceId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid workspace_id")
	}

	query := `
		SELECT id, org_id, name, description, workspace_type, team_id, project_id, owner_id, settings, is_private, created_at, updated_at
		FROM workspaces
		WHERE id = $1
	`

	var ws models.Workspace
	err = s.db.QueryRowContext(ctx, query, workspaceID).Scan(
		&ws.ID, &ws.OrgID, &ws.Name, &ws.Description, &ws.WorkspaceType,
		&ws.TeamID, &ws.ProjectID, &ws.OwnerID, &ws.Settings, &ws.IsPrivate,
		&ws.CreatedAt, &ws.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, status.Error(codes.NotFound, "workspace not found")
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get workspace: %v", err)
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

	return &organization.GetWorkspaceResponse{Workspace: wsProto}, nil
}

func (s *OrganizationService) UpdateWorkspace(ctx context.Context, req *organization.UpdateWorkspaceRequest) (*organization.UpdateWorkspaceResponse, error) {
	workspaceID, err := uuid.Parse(req.WorkspaceId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid workspace_id")
	}

	query := "UPDATE workspaces SET updated_at = $1"
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
	if req.WorkspaceType != "" {
		query += fmt.Sprintf(", workspace_type = $%d", argCount)
		args = append(args, req.WorkspaceType)
		argCount++
	}
	if req.Settings != "" {
		query += fmt.Sprintf(", settings = $%d", argCount)
		args = append(args, req.Settings)
		argCount++
	}

	query += fmt.Sprintf(" WHERE id = $%d", argCount)
	args = append(args, workspaceID)

	_, err = s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update workspace: %v", err)
	}

	wsResp, err := s.GetWorkspace(ctx, &organization.GetWorkspaceRequest{WorkspaceId: workspaceID.String()})
	if err != nil {
		return nil, err
	}

	return &organization.UpdateWorkspaceResponse{
		Workspace: wsResp.Workspace,
		Message:   "Workspace updated successfully",
	}, nil
}

func (s *OrganizationService) DeleteWorkspace(ctx context.Context, req *organization.DeleteWorkspaceRequest) (*organization.DeleteWorkspaceResponse, error) {
	workspaceID, err := uuid.Parse(req.WorkspaceId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid workspace_id")
	}

	query := "DELETE FROM workspaces WHERE id = $1"
	result, err := s.db.ExecContext(ctx, query, workspaceID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete workspace: %v", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return nil, status.Error(codes.NotFound, "workspace not found")
	}

	return &organization.DeleteWorkspaceResponse{
		Message: "Workspace deleted successfully",
	}, nil
}
