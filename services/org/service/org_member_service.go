package service

import (
	"context"
	"database/sql"

	"github.com/chanduchitikam/task-management-system/proto/organization"
	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ============================================================================
// ORGANIZATION MEMBER MANAGEMENT
// ============================================================================

func (s *OrganizationService) ListOrgMembers(ctx context.Context, req *organization.ListOrgMembersRequest) (*organization.ListOrgMembersResponse, error) {
	// Validate request
	if req.OrgId == "" {
		return nil, status.Error(codes.InvalidArgument, "org_id is required")
	}

	orgID, err := uuid.Parse(req.OrgId)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid org_id")
	}

	// Query to get all users in the organization
	query := `
		SELECT id, full_name, email, username, role, created_at
		FROM users
		WHERE org_id = $1
		ORDER BY full_name ASC
	`

	rows, err := s.db.QueryContext(ctx, query, orgID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to query members: %v", err)
	}
	defer rows.Close()

	var members []*organization.OrgMember
	for rows.Next() {
		var member organization.OrgMember
		var createdAt sql.NullTime

		err := rows.Scan(
			&member.Id,
			&member.FullName,
			&member.Email,
			&member.Username,
			&member.Role,
			&createdAt,
		)
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to scan member: %v", err)
		}

		if createdAt.Valid {
			member.CreatedAt = timestamppb.New(createdAt.Time)
		}

		members = append(members, &member)
	}

	if err = rows.Err(); err != nil {
		return nil, status.Errorf(codes.Internal, "error iterating members: %v", err)
	}

	return &organization.ListOrgMembersResponse{
		Members: members,
		Total:   int32(len(members)),
	}, nil
}
