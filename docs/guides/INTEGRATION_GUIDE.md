# Integration Guide: Task Management System with Portal VII

## Overview

This guide explains how to integrate your Go-based Task Management System backend with Portal VII (or any web/mobile application).

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    PORTAL VII APPLICATION                        │
│                  (https://www.portalvii.com)                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Frontend (React/Next.js/Vue/etc.)                     │    │
│  │  ┌──────────────────────────────────────────────┐     │    │
│  │  │  Task Management Features:                   │     │    │
│  │  │  • Task Dashboard                            │     │    │
│  │  │  • Create/Edit Tasks                         │     │    │
│  │  │  • Task Assignment                           │     │    │
│  │  │  • Notifications                             │     │    │
│  │  └──────────────────────────────────────────────┘     │    │
│  └────────────┬───────────────────────────────────────────┘    │
└───────────────┼──────────────────────────────────────────────────┘
                │
                │ HTTP REST API Calls
                │ (with JWT Authentication)
                ▼
┌─────────────────────────────────────────────────────────────────┐
│              YOUR TASK MANAGEMENT BACKEND                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              API Gateway (Port 8080)                      │  │
│  │  Endpoints:                                               │  │
│  │  • POST /api/v1/auth/register                            │  │
│  │  • POST /api/v1/auth/login                               │  │
│  │  • GET/POST/PUT/DELETE /api/v1/tasks                     │  │
│  │  • GET /api/v1/notifications                             │  │
│  └────────┬──────────┬──────────┬───────────────────────────┘  │
│           │          │          │                               │
│     ┌─────▼──┐  ┌───▼────┐  ┌─▼──────────┐                    │
│     │ User   │  │ Task   │  │Notification│                    │
│     │Service │  │Service │  │  Service   │                    │
│     └────────┘  └────────┘  └────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

## Integration Methods

### Method 1: Direct API Integration (Recommended)

Portal VII's frontend makes HTTP requests directly to your Task Management API Gateway.

#### Step 1: Enable CORS

Your API Gateway already has CORS enabled. Verify the configuration:

**File**: `gateway/main.go`

```go
// corsMiddleware adds CORS headers
func corsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // Update to allow Portal VII's domain
        w.Header().Set("Access-Control-Allow-Origin", "https://www.portalvii.com")
        // Or allow all origins during development:
        // w.Header().Set("Access-Control-Allow-Origin", "*")
        
        w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

        if r.Method == "OPTIONS" {
            w.WriteHeader(http.StatusOK)
            return
        }

        next.ServeHTTP(w, r)
    })
}
```

#### Step 2: Deploy Your Backend

You need to make your backend accessible from the internet. Options:

**Option A: Deploy to Cloud (Production)**
```bash
# Deploy to Google Cloud Run, AWS ECS, Azure Container Apps, etc.
# Your API Gateway will get a public URL like:
# https://task-api.yourcloud.com
```

**Option B: Use ngrok for Development/Testing**
```bash
# Install ngrok
brew install ngrok

# Start your services
./start-services.sh

# Expose API Gateway (port 8080) to internet
ngrok http 8080

# You'll get a public URL like:
# https://abc123.ngrok.io
```

**Option C: Deploy to Your Own Server**
```bash
# Deploy to VPS (DigitalOcean, Linode, etc.)
# Configure nginx as reverse proxy
# Get SSL certificate with Let's Encrypt
```

#### Step 3: Frontend Integration Code

**Example: JavaScript/TypeScript SDK for Portal VII**

Create a file: `portal-vii/taskManagementAPI.js`

```javascript
// Task Management API SDK
class TaskManagementAPI {
  constructor(baseURL) {
    this.baseURL = baseURL || 'http://localhost:8080';
    this.token = null;
  }

  // Set authentication token
  setToken(token) {
    this.token = token;
    localStorage.setItem('tm_token', token);
  }

  // Get stored token
  getToken() {
    if (!this.token) {
      this.token = localStorage.getItem('tm_token');
    }
    return this.token;
  }

  // Make API request
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.getToken()) {
      headers['Authorization'] = `Bearer ${this.getToken()}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'API request failed');
    }

    return response.json();
  }

  // Auth Methods
  async register(userData) {
    return this.request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async login(email, password) {
    const response = await this.request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    
    if (response.accessToken) {
      this.setToken(response.accessToken);
    }
    
    return response;
  }

  async logout() {
    this.token = null;
    localStorage.removeItem('tm_token');
  }

  // Task Methods
  async getTasks(filters = {}) {
    const params = new URLSearchParams(filters);
    return this.request(`/api/v1/tasks?${params}`);
  }

  async getTask(taskId) {
    return this.request(`/api/v1/tasks/${taskId}`);
  }

  async createTask(taskData) {
    return this.request('/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify(taskData),
    });
  }

  async updateTask(taskId, taskData) {
    return this.request(`/api/v1/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(taskData),
    });
  }

  async deleteTask(taskId) {
    return this.request(`/api/v1/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  async assignTask(taskId, userId) {
    return this.request(`/api/v1/tasks/${taskId}/assign`, {
      method: 'PUT',
      body: JSON.stringify({ userId }),
    });
  }

  // Notification Methods
  async getNotifications(userId) {
    return this.request(`/api/v1/notifications/user/${userId}`);
  }

  async markNotificationRead(notificationId) {
    return this.request(`/api/v1/notifications/${notificationId}/read`, {
      method: 'PUT',
    });
  }
}

// Export for use in Portal VII
export default TaskManagementAPI;
```

#### Step 4: Use in Portal VII Components

**Example: React Component in Portal VII**

```jsx
// portal-vii/src/components/TaskDashboard.jsx
import React, { useState, useEffect } from 'react';
import TaskManagementAPI from '../services/taskManagementAPI';

const taskAPI = new TaskManagementAPI('https://your-backend-url.com');

function TaskDashboard() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    try {
      setLoading(true);
      const response = await taskAPI.getTasks({
        status: 'TASK_STATUS_TODO',
        limit: 10,
      });
      setTasks(response.tasks || []);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (taskData) => {
    try {
      const newTask = await taskAPI.createTask({
        title: taskData.title,
        description: taskData.description,
        priority: 'TASK_PRIORITY_MEDIUM',
        status: 'TASK_STATUS_TODO',
      });
      
      setTasks([newTask, ...tasks]);
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  const handleDeleteTask = async (taskId) => {
    try {
      await taskAPI.deleteTask(taskId);
      setTasks(tasks.filter(task => task.taskId !== taskId));
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  };

  if (loading) return <div>Loading tasks...</div>;

  return (
    <div className="task-dashboard">
      <h1>Task Management</h1>
      
      <button onClick={() => handleCreateTask({ 
        title: 'New Task', 
        description: 'Task description' 
      })}>
        Create Task
      </button>

      <div className="task-list">
        {tasks.map(task => (
          <div key={task.taskId} className="task-card">
            <h3>{task.title}</h3>
            <p>{task.description}</p>
            <span className="priority">{task.priority}</span>
            <span className="status">{task.status}</span>
            <button onClick={() => handleDeleteTask(task.taskId)}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TaskDashboard;
```

### Method 2: Backend-to-Backend Integration

If Portal VII has its own backend, you can integrate server-to-server.

```
Portal VII Backend → Your Task Management API
```

**Example: Node.js Backend Integration**

```javascript
// portal-vii-backend/services/taskService.js
const axios = require('axios');

class TaskService {
  constructor() {
    this.apiURL = process.env.TASK_MANAGEMENT_API_URL || 'http://localhost:8080';
  }

  async createTaskForUser(userId, taskData, authToken) {
    try {
      const response = await axios.post(
        `${this.apiURL}/api/v1/tasks`,
        taskData,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          }
        }
      );
      
      return response.data;
    } catch (error) {
      console.error('Failed to create task:', error.response?.data);
      throw error;
    }
  }

  async getUserTasks(userId, authToken) {
    const response = await axios.get(
      `${this.apiURL}/api/v1/tasks?userId=${userId}`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        }
      }
    );
    
    return response.data;
  }
}

module.exports = new TaskService();
```

### Method 3: Embedded iFrame (Not Recommended)

You could build a simple web UI for your task management system and embed it:

```html
<!-- In Portal VII -->
<iframe 
  src="https://your-task-management-ui.com/dashboard"
  width="100%"
  height="600px"
  frameborder="0"
></iframe>
```

## Authentication Flow

### Step-by-Step Authentication

```javascript
// 1. User registers/logs in via Portal VII
async function authenticateUser(email, password) {
  const api = new TaskManagementAPI('https://your-backend-url.com');
  
  try {
    // Login to task management system
    const response = await api.login(email, password);
    
    // Store tokens
    localStorage.setItem('tm_access_token', response.accessToken);
    localStorage.setItem('tm_refresh_token', response.refreshToken);
    localStorage.setItem('tm_user', JSON.stringify(response.user));
    
    return response.user;
  } catch (error) {
    console.error('Authentication failed:', error);
    throw error;
  }
}

// 2. Check if user is authenticated
function isAuthenticated() {
  const token = localStorage.getItem('tm_access_token');
  
  if (!token) return false;
  
  // Decode JWT to check expiration
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const isExpired = payload.exp * 1000 < Date.now();
    
    return !isExpired;
  } catch {
    return false;
  }
}

// 3. Refresh token when expired
async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('tm_refresh_token');
  
  const response = await fetch('https://your-backend-url.com/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  
  const data = await response.json();
  localStorage.setItem('tm_access_token', data.accessToken);
  
  return data.accessToken;
}
```

## Environment Configuration

### Your Backend (.env)

```bash
# Update these for production deployment
DB_HOST=your-postgres-host.com
DB_PORT=5432
DB_USER=taskuser
DB_PASSWORD=your-secure-password
DB_NAME=taskmanagement

REDIS_HOST=your-redis-host.com
REDIS_PORT=6379

JWT_SECRET=your-super-secret-jwt-key-change-this
JWT_ACCESS_TOKEN_DURATION=24h
JWT_REFRESH_TOKEN_DURATION=168h

# API Gateway
GRPC_PORT=50051
HTTP_PORT=8080

# Production settings
ENVIRONMENT=production
LOG_LEVEL=info
```

### Portal VII Frontend (.env)

```bash
# Add to Portal VII's environment variables
REACT_APP_TASK_API_URL=https://your-task-api.com
VITE_TASK_API_URL=https://your-task-api.com  # If using Vite
NEXT_PUBLIC_TASK_API_URL=https://your-task-api.com  # If using Next.js
```

## Deployment Checklist

- [ ] **1. Deploy Backend to Cloud**
  - [ ] Choose cloud provider (AWS, GCP, Azure, DigitalOcean)
  - [ ] Set up managed PostgreSQL database
  - [ ] Set up managed Redis cache
  - [ ] Deploy services (Docker/Kubernetes)
  - [ ] Configure environment variables
  - [ ] Set up SSL/TLS certificates

- [ ] **2. Update CORS Settings**
  - [ ] Add Portal VII domain to allowed origins
  - [ ] Test CORS with browser dev tools

- [ ] **3. Security Hardening**
  - [ ] Change JWT secret to strong random value
  - [ ] Enable rate limiting
  - [ ] Set up API key authentication (optional)
  - [ ] Configure firewall rules
  - [ ] Enable HTTPS only

- [ ] **4. Portal VII Integration**
  - [ ] Install task management SDK/library
  - [ ] Implement authentication flow
  - [ ] Add task management UI components
  - [ ] Test all API endpoints
  - [ ] Handle errors gracefully

- [ ] **5. Testing**
  - [ ] Test user registration/login
  - [ ] Test task CRUD operations
  - [ ] Test notifications
  - [ ] Test with multiple users
  - [ ] Performance testing

## Quick Start Script for Portal VII

```bash
# 1. Clone or add SDK to Portal VII
cd portal-vii
mkdir -p src/services
curl -o src/services/taskManagementAPI.js \
  https://raw.githubusercontent.com/your-repo/task-sdk/main/taskManagementAPI.js

# 2. Install dependencies (if needed)
npm install axios  # or use fetch API

# 3. Configure environment
echo "REACT_APP_TASK_API_URL=http://localhost:8080" >> .env.local

# 4. Import and use in your components
# See examples above
```

## Example API Calls from Portal VII

### Register a New User
```bash
curl -X POST https://your-backend.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "portaluser@example.com",
    "username": "portaluser",
    "password": "SecurePass123!",
    "full_name": "Portal User"
  }'
```

### Create a Task
```bash
TOKEN="your-jwt-token-here"

curl -X POST https://your-backend.com/api/v1/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title": "Complete Portal VII Integration",
    "description": "Integrate task management with Portal VII",
    "priority": "TASK_PRIORITY_HIGH",
    "status": "TASK_STATUS_TODO"
  }'
```

### Get User's Tasks
```bash
curl -X GET "https://your-backend.com/api/v1/tasks?status=TASK_STATUS_TODO&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

## Support & Troubleshooting

### Common Issues

1. **CORS Errors**
   - Verify Portal VII domain is in CORS allowed origins
   - Check browser console for specific CORS errors
   - Ensure OPTIONS preflight requests are handled

2. **Authentication Failed**
   - Check JWT token is valid and not expired
   - Verify Authorization header format: `Bearer <token>`
   - Check JWT secret matches between services

3. **Connection Refused**
   - Ensure backend is deployed and accessible
   - Check firewall/security group rules
   - Verify correct API URL in Portal VII config

### Need Help?

Check the following files in your project:
- `API_DOCS.md` - Complete API reference
- `ARCHITECTURE.md` - System architecture
- `QUICKSTART.md` - Quick start guide
- `GETTING_STARTED.md` - Development guide

## Next Steps

1. **Deploy your backend** to a cloud provider
2. **Get the public API URL** (e.g., https://task-api.yourcompany.com)
3. **Share the API URL and documentation** with Portal VII developers
4. **Integrate using the SDK** provided in this guide
5. **Test the integration** thoroughly
6. **Deploy to production**

Your task management system is production-ready and can be integrated with Portal VII or any other application! 🚀
