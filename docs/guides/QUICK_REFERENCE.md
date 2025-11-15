# Quick Reference - Task Management System

## 🚀 Quick Start

### Start Everything
```bash
# Backend + Database
docker-compose up -d

# Frontend (separate terminal)
cd frontend
npm install && npm run dev
```

**Access**:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8080
- WebSocket: ws://localhost:8080/ws

---

## 🔌 API Endpoints (REST)

### Auth
```bash
# Register
POST http://localhost:8080/api/v1/auth/register
{"email": "user@example.com", "username": "john", "password": "pass123", "full_name": "John Doe"}

# Login
POST http://localhost:8080/api/v1/auth/login
{"email": "user@example.com", "password": "pass123"}
# Returns: {access_token, refresh_token, user}
```

### Tasks
```bash
# Create
POST http://localhost:8080/api/v1/tasks
Authorization: Bearer {token}
{"title": "New Task", "description": "Details", "priority": "HIGH", "status": "TODO"}

# List
GET http://localhost:8080/api/v1/tasks
Authorization: Bearer {token}

# Get
GET http://localhost:8080/api/v1/tasks/{id}
Authorization: Bearer {token}

# Update
PUT http://localhost:8080/api/v1/tasks/{id}
Authorization: Bearer {token}
{"status": "IN_PROGRESS"}

# Delete
DELETE http://localhost:8080/api/v1/tasks/{id}
Authorization: Bearer {token}
```

---

## 💻 Code Examples

### JavaScript (Fetch)
```javascript
// Login
const { access_token } = await fetch('http://localhost:8080/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
}).then(r => r.json());

// Create Task
await fetch('http://localhost:8080/api/v1/tasks', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${access_token}`
  },
  body: JSON.stringify({ title: 'Task', priority: 'HIGH' })
});
```

### Python
```python
import requests

# Login
r = requests.post('http://localhost:8080/api/v1/auth/login',
                  json={'email': 'user@example.com', 'password': 'pass'})
token = r.json()['access_token']

# Create Task
requests.post('http://localhost:8080/api/v1/tasks',
             headers={'Authorization': f'Bearer {token}'},
             json={'title': 'Task', 'priority': 'HIGH'})
```

### WebSocket
```javascript
const ws = new WebSocket('ws://localhost:8080/ws?token=' + access_token);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log(msg.type, msg.data); // task.created, notification.new, etc.
};
```

---

## 📊 Data Models

### Task
```json
{
  "id": "uuid",
  "title": "string",
  "description": "string",
  "status": "TODO | IN_PROGRESS | DONE",
  "priority": "LOW | MEDIUM | HIGH | URGENT",
  "creator_id": "uuid",
  "assignee_id": "uuid",
  "due_date": "2024-01-01T00:00:00Z",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### User
```json
{
  "id": "uuid",
  "email": "string",
  "username": "string",
  "full_name": "string",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

---

## 🔧 Environment Variables

### Backend (.env)
```bash
DB_HOST=localhost
DB_PORT=5433
DB_USER=taskuser
DB_PASSWORD=taskpassword
DB_NAME=taskmanagement
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your-secret-key
```

### Frontend (.env.local)
```bash
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

---

## 🐳 Docker Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all
docker-compose down

# Rebuild
docker-compose build

# Reset database
docker-compose down -v
docker-compose up -d
```

---

## 🧪 Testing

```bash
# Backend tests
go test ./...

# Frontend tests
cd frontend && npm test

# API testing with curl
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","username":"test","password":"pass123","full_name":"Test User"}'
```

---

## 📁 Project Structure

```
task-management-system/
├── services/          # Go microservices
├── gateway/           # API Gateway + WebSocket
├── frontend/          # Next.js app
├── proto/             # Protocol Buffers
├── deployments/       # K8s, Docker, Monitoring
└── docs/              # All documentation
```

---

## 🔐 Authentication Flow

1. Register/Login → Get `access_token`
2. Store token (localStorage, AsyncStorage)
3. Add to headers: `Authorization: Bearer {token}`
4. Token expires → Use `refresh_token`
5. Logout → Clear tokens

---

## 📚 Documentation

| File | Purpose |
|------|---------|
| `README.md` | Main docs |
| `QUICKSTART.md` | Fast setup |
| `API_REFERENCE.md` | Complete API |
| `CUSTOM_FRONTEND_GUIDE.md` | Use your frontend |
| `PRODUCTION_GUIDE.md` | Deploy guide |
| `COMPLETE_GUIDE.md` | Full overview |

---

## ⚡ Common Tasks

### Add a new endpoint
1. Update proto file
2. Run `make proto`
3. Implement service method
4. Restart service

### Deploy to production
1. Read `PRODUCTION_GUIDE.md`
2. Set up K8s cluster
3. `kubectl apply -f deployments/k8s/`
4. Deploy monitoring

### Debug issues
```bash
# Check service logs
docker-compose logs service-name

# Check database
docker exec -it postgres-db psql -U taskuser -d taskmanagement

# Check Redis
docker exec -it redis-cache redis-cli
```

---

## 🎯 Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 404 | Not Found |
| 500 | Server Error |

---

## 🌐 Ports

| Service | Port |
|---------|------|
| Frontend | 3000 |
| Gateway (HTTP) | 8080 |
| User Service | 50051 |
| Task Service | 50052 |
| Notification | 50053 |
| PostgreSQL | 5433 |
| Redis | 6379 |

---

**Full documentation**: See all `.md` files in project root
