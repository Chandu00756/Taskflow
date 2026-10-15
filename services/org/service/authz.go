package service

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/chanduchitikam/task-management-system/pkg/auth"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

// entityTables maps request fields that reference org-owned rows to the table
// holding that row, so the owning organization can be resolved.
var entityTables = []struct{ field, table string }{
	{"team_id", "teams"},
	{"project_id", "projects"},
	{"group_id", "groups"},
	{"workspace_id", "workspaces"},
}

func stringField(m protoreflect.Message, name string) string {
	fd := m.Descriptor().Fields().ByName(protoreflect.Name(name))
	if fd == nil || fd.Kind() != protoreflect.StringKind || fd.IsList() {
		return ""
	}
	return m.Get(fd).String()
}

func isMutation(method string) bool {
	name := method[strings.LastIndex(method, "/")+1:]
	for _, p := range []string{"Create", "Update", "Delete", "Add", "Remove", "Assign"} {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}

// AuthzUnaryInterceptor enforces tenant isolation for the organization
// service: callers may only touch rows owned by their own organization, and
// only organization admins (or the relevant team lead / project manager) may
// change them.
func AuthzUnaryInterceptor(db *sql.DB) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		callerID, _ := ctx.Value("user_id").(string)
		callerOrg, _ := ctx.Value("org_id").(string)
		role, _ := ctx.Value("role").(string)
		if callerID == "" {
			return nil, status.Error(codes.Unauthenticated, "authentication required")
		}
		if auth.IsPlatformAdmin(role) {
			return handler(ctx, req)
		}
		msg, ok := req.(proto.Message)
		if !ok {
			return nil, status.Error(codes.PermissionDenied, "forbidden")
		}
		m := msg.ProtoReflect()

		targetOrg := stringField(m, "org_id")
		var entityField, entityID string
		for _, e := range entityTables {
			id := stringField(m, e.field)
			if id == "" {
				continue
			}
			if entityField == "" {
				entityField, entityID = e.field, id
			}
			var owner string
			err := db.QueryRowContext(ctx, "SELECT org_id::text FROM "+e.table+" WHERE id::text = $1", id).Scan(&owner)
			if errors.Is(err, sql.ErrNoRows) {
				return nil, status.Errorf(codes.NotFound, "%s not found", strings.TrimSuffix(e.field, "_id"))
			}
			if err != nil {
				return nil, status.Error(codes.Internal, "failed to resolve resource owner")
			}
			if targetOrg != "" && targetOrg != owner {
				return nil, status.Error(codes.PermissionDenied, "resource belongs to another organization")
			}
			targetOrg = owner
		}
		if targetOrg == "" || targetOrg != callerOrg {
			return nil, status.Error(codes.PermissionDenied, "resource belongs to another organization")
		}

		if isMutation(info.FullMethod) {
			if !auth.IsOrgAdminRole(role) && !leadsEntity(ctx, db, info.FullMethod, entityField, entityID, callerID) {
				return nil, status.Error(codes.PermissionDenied, "organization admin access required")
			}
			// Members added to teams/projects/groups must belong to the same org.
			if member := stringField(m, "user_id"); member != "" && strings.Contains(info.FullMethod, "/Add") {
				var memberOrg sql.NullString
				err := db.QueryRowContext(ctx, "SELECT org_id::text FROM users WHERE id::text = $1", member).Scan(&memberOrg)
				if err != nil || !memberOrg.Valid || memberOrg.String != callerOrg {
					return nil, status.Error(codes.InvalidArgument, "user is not a member of this organization")
				}
			}
		}
		return handler(ctx, req)
	}
}

// leadsEntity lets team leads manage their own team and project managers
// manage their own project without full admin rights.
func leadsEntity(ctx context.Context, db *sql.DB, method, field, id, callerID string) bool {
	name := method[strings.LastIndex(method, "/")+1:]
	var query string
	switch {
	case field == "team_id" && (name == "UpdateTeam" || name == "AddTeamMember" || name == "RemoveTeamMember"):
		query = "SELECT 1 FROM teams WHERE id::text = $1 AND team_lead_id::text = $2"
	case field == "project_id" && (name == "UpdateProject" || name == "AddProjectMember" || name == "RemoveProjectMember" || name == "AssignTeamToProject" || name == "RemoveTeamFromProject"):
		query = "SELECT 1 FROM projects WHERE id::text = $1 AND project_manager_id::text = $2"
	case field == "group_id" && (name == "UpdateGroup" || name == "AddGroupMember" || name == "RemoveGroupMember"):
		query = "SELECT 1 FROM groups WHERE id::text = $1 AND owner_id::text = $2"
	default:
		return false
	}
	var one int
	return db.QueryRowContext(ctx, query, id, callerID).Scan(&one) == nil
}
