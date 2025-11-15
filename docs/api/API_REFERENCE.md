# API Documentation - Task Management System

**Base URL**: `http://localhost:8080` (Development)

The Task Management System provides both **gRPC** and **REST** APIs, allowing developers to integrate using their preferred protocol.

## Table of Contents

- [Authentication](#authentication)
- [REST API Endpoints](#rest-api-endpoints)
- [gRPC Services](#grpc-services)
- [WebSocket Real-time API](#websocket-real-time-api)
- [Client SDKs](#client-sdks)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)

---

## Authentication

All APIs (except registration and login) require JWT authentication.

### Getting a Token

**Register a new user:**
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "SecurePass123!",
  "full_name": "John Doe"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "username": "johndoe",
    "full_name": "John Doe",
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

**Login:**
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

### Using the Token

Include the access token in the Authorization header:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

---

## REST API Endpoints

### Users

#### Get User Profile
```http
GET /api/v1/users/:id
Authorization: Bearer {token}
```

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "username": "johndoe",
  "full_name": "John Doe",
  "created_at": "2024-01-15T10:00:00Z",
  "updated_at": "2024-01-15T10:00:00Z"
}
```

#### List Users
```http
GET /api/v1/users
Authorization: Bearer {token}
```

**Response:**
```json
{
  "users": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "username": "johndoe",
      "full_name": "John Doe"
    }
  ],
  "total": 1
}
```

#### Update User
```http
PUT /api/v1/users/:id
Authorization: Bearer {token}
Content-Type: application/json

{
  "full_name": "John Updated Doe",
  "username": "john_doe"
}
```

#### Delete User
```http
DELETE /api/v1/users/:id
Authorization: Bearer {token}
```

---

### Tasks

#### Create Task
```http
POST /api/v1/tasks
Authorization: Bearer {token}
Content-Type: application/json

{
  "title": "Implement Authentication",
  "description": "Add JWT-based auth to the API",
  "status": "TODO",
  "priority": "HIGH",
  "assignee_id": "550e8400-e29b-41d4-a716-446655440000",
  "due_date": "2024-02-01T00:00:00Z"
}
```

**Status values**: `TODO`, `IN_PROGRESS`, `DONE`  
**Priority values**: `LOW`, `MEDIUM`, `HIGH`, `URGENT`

**Response:**
```json
{
  "id": "660f9511-f39c-52e5-b827-557766551111",
  "title": "Implement Authentication",
  "description": "Add JWT-based auth to the API",
  "status": "TODO",
  "priority": "HIGH",
  "creator_id": "550e8400-e29b-41d4-a716-446655440000",
  "assignee_id": "550e8400-e29b-41d4-a716-446655440000",
  "due_date": "2024-02-01T00:00:00Z",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

#### Get Task
```http
GET /api/v1/tasks/:id
Authorization: Bearer {token}
```

#### List All Tasks
```http
GET /api/v1/tasks
Authorization: Bearer {token}
```

**Response:**
```json
{
  "tasks": [
    {
      "id": "660f9511-f39c-52e5-b827-557766551111",
      "title": "Implement Authentication",
      "status": "TODO",
      "priority": "HIGH"
    }
  ],
  "total": 1
}
```

#### Get User Tasks
```http
GET /api/v1/tasks/user/:userId
Authorization: Bearer {token}
```

#### Update Task
```http
PUT /api/v1/tasks/:id
Authorization: Bearer {token}
Content-Type: application/json

{
  "status": "IN_PROGRESS",
  "priority": "URGENT"
}
```

#### Delete Task
```http
DELETE /api/v1/tasks/:id
Authorization: Bearer {token}
```

#### Assign Task
```http
POST /api/v1/tasks/:taskId/assign
Authorization: Bearer {token}
Content-Type: application/json

{
  "user_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### Notifications

#### Create Notification
```http
POST /api/v1/notifications
Authorization: Bearer {token}
Content-Type: application/json

{
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Task Assigned",
  "message": "You have been assigned to 'Implement Authentication'",
  "type": "task_assignment"
}
```

#### Get User Notifications
```http
GET /api/v1/notifications/user/:userId
Authorization: Bearer {token}
```

**Response:**
```json
{
  "notifications": [
    {
      "id": "770g0622-g40d-63f6-c938-668877662222",
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Task Assigned",
      "message": "You have been assigned to 'Implement Authentication'",
      "type": "task_assignment",
      "read": false,
      "created_at": "2024-01-15T10:35:00Z"
    }
  ],
  "total": 1
}
```

#### Mark Notification as Read
```http
PUT /api/v1/notifications/:id/read
Authorization: Bearer {token}
```

---

## gRPC Services

For high-performance applications, use the native gRPC services directly.

### Service Definitions

**User Service** (Port 50051)
- `Register(RegisterRequest) returns (AuthResponse)`
- `Login(LoginRequest) returns (AuthResponse)`
- `GetUser(GetUserRequest) returns (User)`
- `UpdateUser(UpdateUserRequest) returns (User)`
- `DeleteUser(DeleteUserRequest) returns (Empty)`
- `ListUsers(ListUsersRequest) returns (ListUsersResponse)`

**Task Service** (Port 50052)
- `CreateTask(CreateTaskRequest) returns (Task)`
- `GetTask(GetTaskRequest) returns (Task)`
- `UpdateTask(UpdateTaskRequest) returns (Task)`
- `DeleteTask(DeleteTaskRequest) returns (Empty)`
- `ListTasks(ListTasksRequest) returns (ListTasksResponse)`
- `GetUserTasks(GetUserTasksRequest) returns (ListTasksResponse)`
- `AssignTask(AssignTaskRequest) returns (Task)`

**Notification Service** (Port 50053)
- `CreateNotification(CreateNotificationRequest) returns (Notification)`
- `GetNotifications(GetNotificationsRequest) returns (ListNotificationsResponse)`
- `MarkAsRead(MarkAsReadRequest) returns (Notification)`

### Proto Files

Proto definitions are available in the `/proto` directory:
- `/proto/user/user.proto`
- `/proto/task/task.proto`
- `/proto/notification/notification.proto`

---

## WebSocket Real-time API

Connect to WebSocket for real-time updates.

### Connection

```javascript
const ws = new WebSocket('ws://localhost:8080/ws?token=YOUR_ACCESS_TOKEN');

ws.onopen = () => {
  console.log('Connected to WebSocket');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Message:', message);
};
```

### Message Types

**Incoming Messages** (Server → Client):

- `task.created` - New task created
- `task.updated` - Task updated
- `task.deleted` - Task deleted
- `task.assigned` - Task assigned to user
- `notification.new` - New notification
- `user.online` - User came online
- `user.offline` - User went offline
- `pong` - Response to ping

**Outgoing Messages** (Client → Server):

- `ping` - Keep connection alive

### Example Message

```json
{
  "type": "task.created",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2024-01-15T10:40:00Z",
  "data": {
    "task_id": "660f9511-f39c-52e5-b827-557766551111",
    "title": "New Task",
    "creator_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

---

## Client SDKs

### JavaScript/TypeScript SDK

The frontend includes a full TypeScript SDK:

```typescript
import { api } from './lib/api';

// Login
const auth = await api.auth.login({
  email: 'user@example.com',
  password: 'password'
});

// Create task
const task = await api.tasks.createTask({
  title: 'New Task',
  description: 'Description',
  priority: 'HIGH'
});

// Get notifications
const notifications = await api.notifications.getUserNotifications(userId);
```

**Location**: `/frontend/src/lib/api/`

### Python SDK Example

```python
import requests

class TaskManagementClient:
    def __init__(self, base_url, access_token=None):
        self.base_url = base_url
        self.access_token = access_token
        self.session = requests.Session()
    
    def login(self, email, password):
        response = self.session.post(
            f"{self.base_url}/api/v1/auth/login",
            json={"email": email, "password": password}
        )
        data = response.json()
        self.access_token = data['access_token']
        self.session.headers['Authorization'] = f"Bearer {self.access_token}"
        return data
    
    def create_task(self, title, description, priority='MEDIUM'):
        return self.session.post(
            f"{self.base_url}/api/v1/tasks",
            json={
                "title": title,
                "description": description,
                "priority": priority
            }
        ).json()
    
    def list_tasks(self):
        return self.session.get(f"{self.base_url}/api/v1/tasks").json()

# Usage
client = TaskManagementClient('http://localhost:8080')
client.login('user@example.com', 'password')
tasks = client.list_tasks()
```

### Go SDK Example

```go
package main

import (
    "context"
    "google.golang.org/grpc"
    userpb "github.com/chanduchitikam/task-management-system/proto/user"
    taskpb "github.com/chanduchitikam/task-management-system/proto/task"
)

func main() {
    // Connect to User Service
    userConn, _ := grpc.Dial("localhost:50051", grpc.WithInsecure())
    defer userConn.Close()
    userClient := userpb.NewUserServiceClient(userConn)
    
    // Login
    authResp, _ := userClient.Login(context.Background(), &userpb.LoginRequest{
        Email:    "user@example.com",
        Password: "password",
    })
    
    // Connect to Task Service
    taskConn, _ := grpc.Dial("localhost:50052", grpc.WithInsecure())
    defer taskConn.Close()
    taskClient := taskpb.NewTaskServiceClient(taskConn)
    
    // Create task
    task, _ := taskClient.CreateTask(context.Background(), &taskpb.CreateTaskRequest{
        Title:       "New Task",
        Description: "Description",
        Priority:    taskpb.TaskPriority_HIGH,
    })
}
```

---

## Error Handling

All errors follow a consistent format:

```json
{
  "error": "validation_error",
  "message": "Invalid email format",
  "status": 400
}
```

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate resource)
- `500` - Internal Server Error

---

## Rate Limiting

The API Gateway implements rate limiting:

- **Limit**: 100 requests per second per IP
- **Burst**: 10 additional requests

When rate limit is exceeded:

```json
{
  "error": "rate_limit_exceeded",
  "message": "Too many requests. Please try again later.",
  "status": 429
}
```

Headers included in response:
- `X-RateLimit-Limit`: Maximum requests per window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Time when the limit resets (Unix timestamp)

---

## CORS Configuration

The API Gateway allows cross-origin requests from any origin by default.

For production, configure allowed origins in `gateway/main.go`:

```go
w.Header().Set("Access-Control-Allow-Origin", "https://yourdomain.com")
```

---

## API Versioning

Current API version: **v1**

All endpoints are prefixed with `/api/v1/`

Future versions will be released as `/api/v2/`, `/api/v3/`, etc.

---

## Support

For questions or issues:
- Open an issue on GitHub
- Check the main README.md
- See INTEGRATION_GUIDE.md for integration examples

---

**Last Updated**: 2024-01-15
**API Version**: v1.0.0
