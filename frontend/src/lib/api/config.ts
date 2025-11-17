// // // API Configuration
export const API_CONFIG = {
  BASE_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080',
  WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080',
  TIMEOUT: 30000,
  API_VERSION: 'v1',
};

export const API_ENDPOINTS = {
// // // Auth
  AUTH: {
    REGISTER: '/api/v1/auth/register',
    LOGIN: '/api/v1/auth/login',
    REFRESH: '/api/v1/auth/refresh',
  },
// // // Users
  USERS: {
    BASE: '/api/v1/users',
    BY_ID: (id: string) => `/api/v1/users/${id}`,
    LIST: '/api/v1/users',
  },
// // // Tasks
  TASKS: {
    BASE: '/api/v1/tasks',
    BY_ID: (id: string) => `/api/v1/tasks/${id}`,
    USER_TASKS: (userId: string) => `/api/v1/tasks/user/${userId}`,
    ASSIGN: (taskId: string) => `/api/v1/tasks/${taskId}/assign`,
  },
// // // Notifications
  NOTIFICATIONS: {
    BASE: '/api/v1/notifications',
    BY_USER: (userId: string) => `/api/v1/notifications/user/${userId}`,
    MARK_READ: (id: string) => `/api/v1/notifications/${id}/read`,
  },
// // // Invites / Org admin
  INVITES: {
    CREATE: '/api/v1/orgs/users', // POST ?org_id=
    ACCEPT: '/api/v1/invite/accept', // POST
    LIST: '/api/v1/orgs/users/list', // GET ?org_id=
  },
// // // WebSocket
  WEBSOCKET: {
    CONNECT: '/ws',
    STATS: '/ws/stats',
    ONLINE_USERS: '/ws/online-users',
  },
};
