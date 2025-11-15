import { apiClient } from './client';
import { API_ENDPOINTS } from './config';
import {
  AuthResponse,
  RegisterRequest,
  LoginRequest,
  User,
  Task,
  TaskStatus,
  TaskPriority,
  CreateTaskRequest,
  UpdateTaskRequest,
  AssignTaskRequest,
  Notification,
  CreateNotificationRequest,
  ListTasksResponse,
  ListUsersResponse,
  ListNotificationsResponse,
} from './types';

// Authentication API
export const authAPI = {
  register: (data: RegisterRequest) =>
    apiClient.post<AuthResponse>(API_ENDPOINTS.AUTH.REGISTER, data),

  login: (data: LoginRequest) =>
    apiClient.post<AuthResponse>(API_ENDPOINTS.AUTH.LOGIN, data),

  logout: () => {
    apiClient.clearTokens();
  },
};

// Users API
export const usersAPI = {
  getUser: (id: string) =>
    apiClient.get<User>(API_ENDPOINTS.USERS.BY_ID(id)),

  listUsers: () =>
    apiClient.get<ListUsersResponse>(API_ENDPOINTS.USERS.LIST),

  updateUser: (id: string, data: Partial<User>) =>
    apiClient.put<User>(API_ENDPOINTS.USERS.BY_ID(id), data),

  deleteUser: (id: string) =>
    apiClient.delete(API_ENDPOINTS.USERS.BY_ID(id)),
};

// Tasks API
export const tasksAPI = {
  createTask: (data: CreateTaskRequest) =>
    apiClient.post<Task>(API_ENDPOINTS.TASKS.BASE, data).then(transformTask),

  getTask: (id: string) =>
    apiClient.get<Task>(API_ENDPOINTS.TASKS.BY_ID(id)).then(transformTask),

  listTasks: () =>
    apiClient.get<ListTasksResponse>(API_ENDPOINTS.TASKS.BASE).then((res) => ({
      ...res,
      tasks: res.tasks.map(transformTask),
    })),

  getUserTasks: (userId: string) =>
    apiClient.get<ListTasksResponse>(API_ENDPOINTS.TASKS.USER_TASKS(userId)).then((res) => ({
      ...res,
      tasks: res.tasks.map(transformTask),
    })),

  updateTask: (id: string, data: UpdateTaskRequest) =>
    apiClient.put<{ task: Task }>(API_ENDPOINTS.TASKS.BY_ID(id), data).then((res) => transformTask(res.task)),

  updateTaskStatus: (id: string, status: TaskStatus) =>
    apiClient.patch<{ task: Task }>(API_ENDPOINTS.TASKS.BY_ID(id) + '/status', { status: status }).then((res) => transformTask(res.task)),

  deleteTask: (id: string) =>
    apiClient.delete(API_ENDPOINTS.TASKS.BY_ID(id)),

  assignTask: (taskId: string, data: AssignTaskRequest) =>
    apiClient.post<Task>(API_ENDPOINTS.TASKS.ASSIGN(taskId), data).then(transformTask),
};

// Transform API response to match frontend types
function transformTask(task: any): Task {
  return {
    id: task.taskId || task.id,
    title: task.title,
    description: task.description,
    status: task.status as TaskStatus,
    priority: task.priority as TaskPriority,
    creator_id: task.createdBy,
    assignee_id: task.assignedTo,
    assigned_to: task.assignedTo,
    tags: task.tags || [],
    due_date: task.dueDate,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

// Notifications API
export const notificationsAPI = {
  createNotification: (data: CreateNotificationRequest) =>
    apiClient.post<Notification>(API_ENDPOINTS.NOTIFICATIONS.BASE, data),

  getUserNotifications: (userId: string) =>
    apiClient.get<ListNotificationsResponse>(
      API_ENDPOINTS.NOTIFICATIONS.BY_USER(userId)
    ),

  markAsRead: (id: string) =>
    apiClient.put<Notification>(API_ENDPOINTS.NOTIFICATIONS.MARK_READ(id), {}),
};

// Export all APIs
export const api = {
  auth: authAPI,
  users: usersAPI,
  tasks: tasksAPI,
  notifications: notificationsAPI,
};
