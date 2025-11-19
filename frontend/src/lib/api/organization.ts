import { apiClient } from './index';

// ============================================================================
// TYPES
// ============================================================================

export interface Team {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  team_lead_id?: string;
  parent_team_id?: string;
  status: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  team_lead?: {
    id: string;
    full_name: string;
    email: string;
    username: string;
  };
  members?: TeamMember[];
  member_count: number;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  is_active: boolean;
  full_name: string;
  email: string;
  username: string;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  project_manager_id?: string;
  status: string;
  priority: string;
  start_date?: string;
  end_date?: string;
  budget?: number;
  progress: number;
  metadata: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  project_manager?: {
    id: string;
    full_name: string;
    email: string;
    username: string;
  };
  teams?: ProjectTeam[];
  members?: ProjectMember[];
  team_count: number;
  member_count: number;
}

export interface ProjectTeam {
  id: string;
  project_id: string;
  team_id: string;
  assigned_at: string;
  team_name: string;
  team_member_count: number;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
  allocation_percentage: number;
  joined_at: string;
  is_active: boolean;
  full_name: string;
  email: string;
  username: string;
}

export interface Group {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  group_type: string;
  owner_id?: string;
  status: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  owner?: {
    id: string;
    full_name: string;
    email: string;
    username: string;
  };
  members?: GroupMember[];
  member_count: number;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  is_active: boolean;
  full_name: string;
  email: string;
  username: string;
  team_name?: string;
}

export interface Workspace {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  workspace_type: string;
  team_id?: string;
  project_id?: string;
  owner_id?: string;
  settings: string;
  is_private: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// TEAMS API
// ============================================================================

export const teamsAPI = {
  create: (orgId: string, data: {
    name: string;
    description?: string;
    team_lead_id?: string;
    parent_team_id?: string;
  }) => apiClient.post(`/api/v1/organizations/${orgId}/teams`, data),

  list: (orgId: string, params?: { status?: string }) =>
    apiClient.get(`/api/v1/organizations/${orgId}/teams`, { params }),

  get: (teamId: string) =>
    apiClient.get(`/api/v1/teams/${teamId}`),

  update: (teamId: string, data: {
    name?: string;
    description?: string;
    team_lead_id?: string;
    status?: string;
  }) => apiClient.put(`/api/v1/teams/${teamId}`, data),

  delete: (teamId: string) =>
    apiClient.delete(`/api/v1/teams/${teamId}`),

  // Team Members
  addMember: (teamId: string, data: {
    user_id: string;
    role?: string;
  }) => apiClient.post(`/api/v1/teams/${teamId}/members`, data),

  removeMember: (teamId: string, userId: string) =>
    apiClient.delete(`/api/v1/teams/${teamId}/members/${userId}`),

  listMembers: (teamId: string) =>
    apiClient.get(`/api/v1/teams/${teamId}/members`),
};

// ============================================================================
// PROJECTS API
// ============================================================================

export const projectsAPI = {
  create: (orgId: string, data: {
    name: string;
    description?: string;
    project_manager_id?: string;
    priority?: string;
    start_date?: string;
    end_date?: string;
    budget?: number;
  }) => apiClient.post(`/api/v1/organizations/${orgId}/projects`, data),

  list: (orgId: string, params?: {
    status?: string;
    priority?: string;
  }) => apiClient.get(`/api/v1/organizations/${orgId}/projects`, { params }),

  get: (projectId: string) =>
    apiClient.get(`/api/v1/projects/${projectId}`),

  update: (projectId: string, data: {
    name?: string;
    description?: string;
    status?: string;
    priority?: string;
    progress?: number;
    budget?: number;
  }) => apiClient.put(`/api/v1/projects/${projectId}`, data),

  delete: (projectId: string) =>
    apiClient.delete(`/api/v1/projects/${projectId}`),

  // Project Teams
  assignTeam: (projectId: string, data: {
    team_id: string;
  }) => apiClient.post(`/api/v1/projects/${projectId}/teams`, data),

  removeTeam: (projectId: string, teamId: string) =>
    apiClient.delete(`/api/v1/projects/${projectId}/teams/${teamId}`),

  // Project Members
  addMember: (projectId: string, data: {
    user_id: string;
    role?: string;
    allocation_percentage?: number;
  }) => apiClient.post(`/api/v1/projects/${projectId}/members`, data),

  removeMember: (projectId: string, userId: string) =>
    apiClient.delete(`/api/v1/projects/${projectId}/members/${userId}`),
};

// ============================================================================
// GROUPS API
// ============================================================================

export const groupsAPI = {
  create: (orgId: string, data: {
    name: string;
    description?: string;
    group_type?: string;
    owner_id?: string;
  }) => apiClient.post(`/api/v1/organizations/${orgId}/groups`, data),

  list: (orgId: string, params?: { group_type?: string }) =>
    apiClient.get(`/api/v1/organizations/${orgId}/groups`, { params }),

  get: (groupId: string) =>
    apiClient.get(`/api/v1/groups/${groupId}`),

  update: (groupId: string, data: {
    name?: string;
    description?: string;
    status?: string;
  }) => apiClient.put(`/api/v1/groups/${groupId}`, data),

  delete: (groupId: string) =>
    apiClient.delete(`/api/v1/groups/${groupId}`),

  // Group Members
  addMember: (groupId: string, data: {
    user_id: string;
    role?: string;
  }) => apiClient.post(`/api/v1/groups/${groupId}/members`, data),

  removeMember: (groupId: string, userId: string) =>
    apiClient.delete(`/api/v1/groups/${groupId}/members/${userId}`),
};

// ============================================================================
// WORKSPACES API
// ============================================================================

export const workspacesAPI = {
  create: (orgId: string, data: {
    name: string;
    description?: string;
    workspace_type?: string;
    team_id?: string;
    project_id?: string;
    is_private?: boolean;
  }) => apiClient.post(`/api/v1/organizations/${orgId}/workspaces`, data),

  list: (orgId: string, params?: {
    team_id?: string;
    project_id?: string;
  }) => apiClient.get(`/api/v1/organizations/${orgId}/workspaces`, { params }),
};
