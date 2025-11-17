# # # Using the Backend with Your Own Frontend

This guide explains how to use the Task Management System backend with your own custom frontend application.

# # ## Overview

The Task Management System backend is **completely frontend-agnostic** and can be integrated with:

- ✅ React, Vue, Angular, Svelte, or any JavaScript framework
- ✅ Mobile apps (React Native, Flutter, Swift, Kotlin)
- ✅ Desktop applications (Electron, Tauri)
- ✅ Server-side rendered apps (Next.js, Nuxt, SvelteKit)
- ✅ Static sites with client-side JavaScript
- ✅ Any application that can make HTTP requests or gRPC calls

# # ## Integration Options

You have **3 ways** to integrate with the backend:

# # ### Option 1: REST API (Recommended for Web/Mobile)

**Best for**: Web frontends, mobile apps, simple integrations

- Standard HTTP/HTTPS protocol
- JSON request/response format
- Easy to use with any HTTP client (fetch, axios, etc.)
- Works with all programming languages
- CORS-enabled for browser apps

**Endpoint**: `http://localhost:8080/api/v1/`

# # ### Option 2: gRPC (Recommended for High Performance)

**Best for**: Microservices, high-performance apps, real-time systems

- Binary protocol (faster than JSON)
- Type-safe with Protocol Buffers
- Streaming support
- Lower latency

**Ports**:
- User Service: `localhost:50051`
- Task Service: `localhost:50052`
- Notification Service: `localhost:50053`

# # ### Option 3: WebSocket (For Real-time Features)

**Best for**: Real-time notifications, live updates, collaborative features

- Bidirectional communication
- Push notifications from server
- Real-time task updates
- User presence tracking

**Endpoint**: `ws://localhost:8080/ws`

---

# # ## Quick Start Guides

# # ### JavaScript/TypeScript Frontend

# # #### Using Fetch API

```javascript
// Login
const loginResponse = await fetch('http://localhost:8080/api/v1/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password'
  })
});

const { access_token, user } = await loginResponse.json();
localStorage.setItem('token', access_token);

// Create a task
const taskResponse = await fetch('http://localhost:8080/api/v1/tasks', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${access_token}`
  },
  body: JSON.stringify({
    title: 'New Task',
    description: 'Task description',
    priority: 'HIGH',
    status: 'TODO'
  })
});

const task = await taskResponse.json();
console.log('Created task:', task);
```

# # #### Using Axios

```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8080',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add token to requests
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Login
const { data } = await api.post('/api/v1/auth/login', {
  email: 'user@example.com',
  password: 'password'
});
localStorage.setItem('token', data.access_token);

// Get tasks
const tasks = await api.get('/api/v1/tasks');
console.log(tasks.data);
```

# # #### WebSocket Connection

```javascript
const token = localStorage.getItem('token');
const ws = new WebSocket(`ws://localhost:8080/ws?token=${token}`);

ws.onopen = () => {
  console.log('Connected to WebSocket');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  switch (message.type) {
    case 'task.created':
      console.log('New task:', message.data);
      // Update your UI
      break;
    case 'notification.new':
      console.log('New notification:', message.data);
      // Show notification
      break;
    case 'task.updated':
      console.log('Task updated:', message.data);
      // Refresh task list
      break;
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

// Send ping to keep connection alive
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 30000);
```

---

# # ### React Example

```jsx
import { useState, useEffect } from 'react';
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8080',
});

function TaskList() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await api.get('/api/v1/tasks', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setTasks(response.data.tasks);
      } catch (error) {
        console.error('Error fetching tasks:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTasks();
  }, []);

  const createTask = async (taskData) => {
    const token = localStorage.getItem('token');
    const response = await api.post('/api/v1/tasks', taskData, {
      headers: { Authorization: `Bearer ${token}` }
    });
    setTasks([...tasks, response.data]);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h1>Tasks</h1>
      {tasks.map(task => (
        <div key={task.id}>
          <h3>{task.title}</h3>
          <p>{task.description}</p>
          <span>Priority: {task.priority}</span>
          <span>Status: {task.status}</span>
        </div>
      ))}
    </div>
  );
}
```

---

# # ### Vue.js Example

```vue
<template>
  <div>
    <h1>Tasks</h1>
    <div v-for="task in tasks" :key="task.id" class="task">
      <h3>{{ task.title }}</h3>
      <p>{{ task.description }}</p>
      <span>Priority: {{ task.priority }}</span>
      <span>Status: {{ task.status }}</span>
    </div>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  data() {
    return {
      tasks: []
    };
  },
  async mounted() {
    await this.fetchTasks();
  },
  methods: {
    async fetchTasks() {
      const token = localStorage.getItem('token');
      const response = await axios.get('http://localhost:8080/api/v1/tasks', {
        headers: { Authorization: `Bearer ${token}` }
      });
      this.tasks = response.data.tasks;
    },
    async createTask(taskData) {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        'http://localhost:8080/api/v1/tasks',
        taskData,
        { headers: { Authorization: `Bearer ${token}` }}
      );
      this.tasks.push(response.data);
    }
  }
};
</script>
```

---

# # ### Python Example

```python
import requests
from typing import Optional, Dict, List

class TaskClient:
    def __init__(self, base_url: str = 'http://localhost:8080'):
        self.base_url = base_url
        self.token: Optional[str] = None
        self.session = requests.Session()
    
    def login(self, email: str, password: str) -> Dict:
        """Login and store access token"""
        response = self.session.post(
            f'{self.base_url}/api/v1/auth/login',
            json={'email': email, 'password': password}
        )
        response.raise_for_status()
        data = response.json()
        self.token = data['access_token']
        self.session.headers.update({
            'Authorization': f'Bearer {self.token}'
        })
        return data
    
    def create_task(self, title: str, description: str, 
                    priority: str = 'MEDIUM', status: str = 'TODO') -> Dict:
        """Create a new task"""
        response = self.session.post(
            f'{self.base_url}/api/v1/tasks',
            json={
                'title': title,
                'description': description,
                'priority': priority,
                'status': status
            }
        )
        response.raise_for_status()
        return response.json()
    
    def get_tasks(self) -> List[Dict]:
        """Get all tasks"""
        response = self.session.get(f'{self.base_url}/api/v1/tasks')
        response.raise_for_status()
        return response.json()['tasks']
    
    def update_task(self, task_id: str, **updates) -> Dict:
        """Update a task"""
        response = self.session.put(
            f'{self.base_url}/api/v1/tasks/{task_id}',
            json=updates
        )
        response.raise_for_status()
        return response.json()

# # # Usage
client = TaskClient()
client.login('user@example.com', 'password')

# # # Create task
task = client.create_task(
    title='Build API Client',
    description='Create Python SDK for the API',
    priority='HIGH'
)
print(f'Created task: {task["id"]}')

# # # Get all tasks
tasks = client.get_tasks()
for task in tasks:
    print(f'{task["title"]} - {task["status"]}')

# # # Update task
updated = client.update_task(task['id'], status='IN_PROGRESS')
print(f'Updated task status to: {updated["status"]}')
```

---

# # ### Mobile App Example (React Native)

```jsx
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, Button } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = 'http://localhost:8080';

export default function TaskScreen() {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    const token = await AsyncStorage.getItem('token');
    const response = await fetch(`${API_URL}/api/v1/tasks`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await response.json();
    setTasks(data.tasks);
  };

  const createTask = async () => {
    const token = await AsyncStorage.getItem('token');
    const response = await fetch(`${API_URL}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        title: 'New Task from Mobile',
        description: 'Created from React Native app',
        priority: 'MEDIUM'
      })
    });
    const newTask = await response.json();
    setTasks([...tasks, newTask]);
  };

  return (
    <View>
      <Button title="Create Task" onPress={createTask} />
      <FlatList
        data={tasks}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View>
            <Text>{item.title}</Text>
            <Text>{item.description}</Text>
            <Text>Status: {item.status}</Text>
          </View>
        )}
      />
    </View>
  );
}
```

---

# # ### Swift (iOS) Example

```swift
import Foundation

class TaskAPI {
    let baseURL = "http://localhost:8080"
    var token: String?
    
    func login(email: String, password: String, completion: @escaping (Result<String, Error>) -> Void) {
        guard let url = URL(string: "\(baseURL)/api/v1/auth/login") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body = ["email": email, "password": password]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            if let data = data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let token = json["access_token"] as? String {
                self.token = token
                completion(.success(token))
            }
        }.resume()
    }
    
    func getTasks(completion: @escaping (Result<[[String: Any]], Error>) -> Void) {
        guard let url = URL(string: "\(baseURL)/api/v1/tasks") else { return }
        guard let token = token else { return }
        
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            if let data = data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let tasks = json["tasks"] as? [[String: Any]] {
                completion(.success(tasks))
            }
        }.resume()
    }
}

// Usage
let api = TaskAPI()
api.login(email: "user@example.com", password: "password") { result in
    switch result {
    case .success(let token):
        print("Logged in: \(token)")
        api.getTasks { result in
            switch result {
            case .success(let tasks):
                print("Tasks: \(tasks)")
            case .failure(let error):
                print("Error: \(error)")
            }
        }
    case .failure(let error):
        print("Login error: \(error)")
    }
}
```

---

# # ## Environment Configuration

# # ### Development
```
API_URL=http://localhost:8080
WS_URL=ws://localhost:8080
```

# # ### Production
```
API_URL=https://api.yourdomain.com
WS_URL=wss://api.yourdomain.com
```

---

# # ## Authentication Flow

1. **Register/Login** → Get access_token and refresh_token
2. **Store tokens** → localStorage (web), AsyncStorage (mobile), Keychain (iOS)
3. **Add token to requests** → Authorization: Bearer {token}
4. **Handle token expiration** → Use refresh_token to get new access_token
5. **Logout** → Clear stored tokens

```javascript
// Token refresh example
async function refreshToken() {
  const refreshToken = localStorage.getItem('refresh_token');
  const response = await fetch('http://localhost:8080/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const { access_token } = await response.json();
  localStorage.setItem('token', access_token);
  return access_token;
}
```

---

# # ## Error Handling

All API errors return this format:

```json
{
  "error": "error_code",
  "message": "Human readable message",
  "status": 400
}
```

**Common error codes**:
- `validation_error` (400) - Invalid input
- `unauthorized` (401) - Missing/invalid token
- `forbidden` (403) - Insufficient permissions
- `not_found` (404) - Resource doesn't exist
- `conflict` (409) - Duplicate resource
- `rate_limit_exceeded` (429) - Too many requests
- `internal_error` (500) - Server error

```javascript
try {
  const response = await api.post('/api/v1/tasks', taskData);
} catch (error) {
  if (error.response) {
    const { status, data } = error.response;
    switch (status) {
      case 401:
        // Redirect to login
        window.location.href = '/login';
        break;
      case 400:
        // Show validation errors
        alert(data.message);
        break;
      case 429:
        // Rate limit exceeded
        alert('Too many requests. Please wait.');
        break;
      default:
        alert('An error occurred');
    }
  }
}
```

---

# # ## CORS Configuration

The backend allows all origins by default for development.

For production, update `gateway/main.go`:

```go
w.Header().Set("Access-Control-Allow-Origin", "https://yourfrontend.com")
```

Or use environment variables:

```go
allowedOrigins := os.Getenv("ALLOWED_ORIGINS") // "https://app.com,https://admin.app.com"
```

---

# # ## Rate Limiting

- **100 requests per second** per IP address
- **Burst of 10** additional requests
- Headers returned:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`

---

# # ## Complete API Reference

See [API_REFERENCE.md](./API_REFERENCE.md) for:
- Full endpoint documentation
- Request/response examples
- gRPC service definitions
- WebSocket message types
- Error codes and handling

---

# # ## Example Projects

# # ### Minimal HTML/JavaScript Example

```html
<!DOCTYPE html>
<html>
<head>
    <title>Task Manager</title>
</head>
<body>
    <div id="app">
        <h1>Task Manager</h1>
        <div id="login-form">
            <input id="email" type="email" placeholder="Email">
            <input id="password" type="password" placeholder="Password">
            <button onclick="login()">Login</button>
        </div>
        <div id="tasks" style="display:none;">
            <button onclick="loadTasks()">Refresh Tasks</button>
            <ul id="task-list"></ul>
        </div>
    </div>

    <script>
        const API_URL = 'http://localhost:8080';
        let token = null;

        async function login() {
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            
            const response = await fetch(`${API_URL}/api/v1/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            token = data.access_token;
            
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('tasks').style.display = 'block';
            loadTasks();
        }

        async function loadTasks() {
            const response = await fetch(`${API_URL}/api/v1/tasks`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            const data = await response.json();
            const taskList = document.getElementById('task-list');
            taskList.innerHTML = '';
            
            data.tasks.forEach(task => {
                const li = document.createElement('li');
                li.textContent = `${task.title} - ${task.status}`;
                taskList.appendChild(li);
            });
        }
    </script>
</body>
</html>
```

---

# # ## Support & Resources

- **API Reference**: [API_REFERENCE.md](./API_REFERENCE.md)
- **Integration Guide**: [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)
- **Frontend Example**: `/frontend` directory
- **Proto Files**: `/proto` directory

---

**Your backend is ready to use with ANY frontend technology!** 🚀
