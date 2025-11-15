// ==================== WORKSPACE & ORGANIZATION ====================

export interface Organization {
  id: string;
  name: string;
  domain: string; // email domain (e.g., "company.com")
  logo_url?: string;
  settings: OrganizationSettings;
  subscription_tier: 'free' | 'team' | 'business' | 'enterprise';
  created_at: string;
  updated_at: string;
}

export interface OrganizationSettings {
  allow_public_signup: boolean; // Auto-join if email domain matches
  require_admin_approval: boolean;
  default_role: 'member' | 'guest';
  sso_enabled: boolean;
  max_teams: number;
  features: {
    advanced_search: boolean;
    custom_fields: boolean;
    api_access: boolean;
    audit_logs: boolean;
  };
}

// ==================== WORKSPACE ====================

export interface Workspace {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  type: 'personal' | 'team' | 'organization';
  visibility: 'private' | 'team' | 'organization' | 'public';
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ==================== TEAMS & GROUPS ====================

export interface Team {
  id: string;
  organization_id: string;
  workspace_id?: string;
  name: string;
  description?: string;
  avatar_url?: string;
  privacy: 'open' | 'closed' | 'secret';
  parent_team_id?: string; // For nested teams/sub-teams
  settings: TeamSettings;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface TeamSettings {
  allow_member_invite: boolean;
  require_approval_to_join: boolean;
  default_task_visibility: 'team' | 'members_only';
  mentions_enabled: boolean;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  permissions: TeamPermissions;
  joined_at: string;
  invited_by?: string;
}

export interface TeamPermissions {
  can_create_tasks: boolean;
  can_assign_tasks: boolean;
  can_delete_tasks: boolean;
  can_manage_members: boolean;
  can_manage_settings: boolean;
}

// ==================== USER & PROFILE ====================

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  full_name?: string;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  title?: string; // Job title
  department?: string;
  location?: string;
  timezone?: string;
  status: 'active' | 'away' | 'busy' | 'offline';
  status_message?: string;
  settings: UserSettings;
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  email_notifications: boolean;
  push_notifications: boolean;
  mention_notifications: boolean;
  task_reminders: boolean;
  digest_frequency: 'never' | 'daily' | 'weekly';
  theme: 'light' | 'dark' | 'auto';
  language: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  department?: string;
  title?: string;
  status: 'active' | 'pending' | 'suspended';
  joined_at: string;
  invited_by?: string;
}

// ==================== INVITATIONS ====================

export interface Invitation {
  id: string;
  type: 'organization' | 'team' | 'workspace';
  target_id: string; // organization_id, team_id, or workspace_id
  inviter_id: string;
  invitee_email: string;
  invitee_user_id?: string; // If user already exists
  role: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  token: string;
  expires_at: string;
  created_at: string;
}

// ==================== MENTIONS & TAGGING ====================

export interface Mention {
  id: string;
  entity_type: 'task' | 'comment' | 'document';
  entity_id: string;
  mentioned_by: string;
  mentioned_user_id?: string;
  mentioned_team_id?: string;
  mention_type: 'user' | 'team' | 'role' | 'everyone';
  mention_text: string; // The @mention text (e.g., "@john", "@engineering")
  context?: string; // Surrounding text for preview
  is_read: boolean;
  created_at: string;
}

// ==================== ADVANCED SEARCH ====================

export interface SearchQuery {
  query: string;
  filters?: SearchFilters;
  sort?: SearchSort;
  pagination?: {
    page: number;
    limit: number;
  };
}

export interface SearchFilters {
  // Entity filters
  entity_types?: ('task' | 'user' | 'team' | 'document' | 'comment')[];
  
  // User/Team filters
  assigned_to?: string[]; // User IDs
  created_by?: string[];
  teams?: string[]; // Team IDs
  organizations?: string[];
  
  // Status filters
  status?: string[];
  priority?: string[];
  labels?: string[];
  
  // Time filters
  created_after?: string;
  created_before?: string;
  due_after?: string;
  due_before?: string;
  
  // Workspace filters
  workspace_ids?: string[];
  visibility?: ('private' | 'team' | 'organization' | 'public')[];
  
  // Advanced filters
  has_attachments?: boolean;
  has_comments?: boolean;
  is_archived?: boolean;
  custom_fields?: Record<string, any>;
}

export interface SearchSort {
  field: 'relevance' | 'created_at' | 'updated_at' | 'due_date' | 'priority' | 'title';
  order: 'asc' | 'desc';
}

export interface SearchResult<T = any> {
  type: 'task' | 'user' | 'team' | 'document' | 'comment';
  id: string;
  title: string;
  description?: string;
  highlights?: string[]; // Highlighted matching text
  metadata: T;
  relevance_score: number;
  breadcrumb?: string[]; // Navigation path
  preview?: string;
  created_at: string;
  updated_at: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  limit: number;
  facets?: SearchFacets;
  suggestions?: string[];
  took_ms: number;
}

export interface SearchFacets {
  entity_types?: Record<string, number>;
  teams?: Record<string, number>;
  assignees?: Record<string, number>;
  status?: Record<string, number>;
  priority?: Record<string, number>;
  labels?: Record<string, number>;
}

// ==================== AUTOCOMPLETE ====================

export interface AutocompleteRequest {
  query: string;
  context: 'mention' | 'search' | 'assignee' | 'team';
  workspace_id?: string;
  team_id?: string;
  limit?: number;
  filters?: {
    exclude_user_ids?: string[];
    only_team_members?: boolean;
    include_teams?: boolean;
    include_roles?: boolean;
  };
}

export interface AutocompleteSuggestion {
  type: 'user' | 'team' | 'role' | 'everyone';
  id: string;
  display_name: string;
  handle: string; // @username or @team-name
  avatar_url?: string;
  metadata?: {
    title?: string;
    department?: string;
    team_name?: string;
    member_count?: number;
  };
  relevance_score: number;
}

// ==================== ACTIVITY & AUDIT ====================

export interface Activity {
  id: string;
  organization_id?: string;
  workspace_id?: string;
  actor_id: string;
  action: ActivityAction;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

export type ActivityAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'assigned'
  | 'mentioned'
  | 'commented'
  | 'completed'
  | 'archived'
  | 'invited'
  | 'joined'
  | 'left'
  | 'role_changed';

// ==================== PERMISSIONS ====================

export interface Permission {
  resource_type: 'task' | 'workspace' | 'team' | 'organization';
  resource_id: string;
  user_id?: string;
  team_id?: string;
  role_id?: string;
  actions: PermissionAction[];
}

export type PermissionAction =
  | 'view'
  | 'create'
  | 'update'
  | 'delete'
  | 'assign'
  | 'comment'
  | 'share'
  | 'manage_members'
  | 'manage_settings'
  | 'manage_permissions';

// ==================== API REQUESTS ====================

export interface CreateOrganizationRequest {
  name: string;
  domain?: string;
  settings?: Partial<OrganizationSettings>;
}

export interface CreateTeamRequest {
  organization_id: string;
  workspace_id?: string;
  name: string;
  description?: string;
  privacy: 'open' | 'closed' | 'secret';
  parent_team_id?: string;
  settings?: Partial<TeamSettings>;
}

export interface InviteMemberRequest {
  type: 'organization' | 'team' | 'workspace';
  target_id: string;
  emails: string[];
  role: string;
  message?: string;
  send_email?: boolean;
}

export interface UpdateUserProfileRequest {
  full_name?: string;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  title?: string;
  department?: string;
  location?: string;
  timezone?: string;
  status?: 'active' | 'away' | 'busy' | 'offline';
  status_message?: string;
}
