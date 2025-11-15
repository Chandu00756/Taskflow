// Type definitions for API requests and responses

export interface User {
  id: string;
  email: string;
  username: string;
  full_name: string;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  full_name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export enum TaskStatus {
  TODO = 'TASK_STATUS_TODO',
  IN_PROGRESS = 'TASK_STATUS_IN_PROGRESS',
  IN_REVIEW = 'TASK_STATUS_IN_REVIEW',
  COMPLETED = 'TASK_STATUS_COMPLETED',
  CANCELLED = 'TASK_STATUS_CANCELLED',
}

export enum TaskPriority {
  LOW = 'TASK_PRIORITY_LOW',
  MEDIUM = 'TASK_PRIORITY_MEDIUM',
  HIGH = 'TASK_PRIORITY_HIGH',
  CRITICAL = 'TASK_PRIORITY_CRITICAL',
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  creator_id: string;
  assignee_id?: string;
  assigned_to?: string; // Single user ID of assignee
  tags?: string[]; // Array of tags/labels
  due_date?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskRequest {
  title: string;
  description: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee_id?: string;
  assigned_to?: string; // Single user ID of assignee
  tags?: string[]; // Array of tags/labels
  due_date?: string;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee_id?: string;
  assigned_to?: string;
  tags?: string[];
  due_date?: string;
}

export interface AssignTaskRequest {
  user_id: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
}

export interface CreateNotificationRequest {
  user_id: string;
  title: string;
  message: string;
  type: string;
}

export interface ListTasksResponse {
  tasks: Task[];
  total: number;
}

export interface ListUsersResponse {
  users: User[];
  total: number;
}

export interface ListNotificationsResponse {
  notifications: Notification[];
  total: number;
}

export interface APIError {
  error: string;
  message: string;
  status: number;
}

export interface WebSocketMessage {
  type: string;
  user_id?: string;
  timestamp: string;
  data: Record<string, any>;
}
