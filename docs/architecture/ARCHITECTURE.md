# Task Management System - Architecture

## Overview
This is a **backend-only** microservices application built with Go and gRPC. It does not include a frontend - clients interact with the system via REST API through the API Gateway.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLIENT APPLICATIONS                              │
│  (Mobile Apps, Web Apps, CLI Tools, Postman, curl, etc.)               │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ HTTP/REST
                                 │ (Port 8080)
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY                                     │
│  ┌────────────────────────────────────────────────────────────┐         │
│  │  • REST to gRPC Translation (grpc-gateway)                 │         │
│  │  • CORS Middleware                                          │         │
│  │  • Rate Limiting                                            │         │
│  │  • Logging & Metrics                                        │         │
│  │  • HTTP Port: 8080                                          │         │
│  └────────────────────────────────────────────────────────────┘         │
└──────────┬──────────────┬──────────────┬───────────────────────────────┘
           │              │              │
           │ gRPC         │ gRPC         │ gRPC
           │ :50051       │ :50052       │ :50053
           ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│    USER      │ │    TASK      │ │  NOTIFICATION    │
│   SERVICE    │ │   SERVICE    │ │     SERVICE      │
│              │ │              │ │                  │
│ ┌──────────┐ │ │ ┌──────────┐ │ │ ┌──────────────┐ │
│ │ gRPC API │ │ │ │ gRPC API │ │ │ │  gRPC API    │ │
│ │  :50051  │ │ │ │  :50052  │ │ │ │   :50053     │ │
│ └──────────┘ │ │ └──────────┘ │ │ └──────────────┘ │
│              │ │              │ │                  │
│ Features:    │ │ Features:    │ │ Features:        │
│ • Register   │ │ • Create     │ │ • Create         │
│ • Login      │ │ • Update     │ │ • List           │
│ • Profile    │ │ • Delete     │ │ • Mark Read      │
│ • JWT Auth   │ │ • List       │ │ • User Notifs    │
│ • Refresh    │ │ • Filter     │ │                  │
│              │ │ • Assign     │ │                  │
└──────┬───────┘ └──────┬───────┘ └────────┬─────────┘
       │                │                  │
       │                │                  │
       └────────────────┼──────────────────┘
                        │
                        │ SQL/Connection Pool
                        ▼
        ┌───────────────────────────────┐
        │      POSTGRESQL DATABASE       │
        │         (Port 5433)            │
        │  ┌─────────────────────────┐  │
        │  │ Tables:                 │  │
        │  │ • users                 │  │
        │  │ • tasks                 │  │
        │  │ • notifications         │  │
        │  │                         │  │
        │  │ Features:               │  │
        │  │ • UUID primary keys     │  │
        │  │ • Timestamps            │  │
        │  │ • Foreign keys          │  │
        │  └─────────────────────────┘  │
        └───────────────────────────────┘

        ┌───────────────────────────────┐
        │         REDIS CACHE            │
        │         (Port 6379)            │
        │  ┌─────────────────────────┐  │
        │  │ • Session data          │  │
        │  │ • Task cache            │  │
        │  │ • Rate limiting         │  │
        │  └─────────────────────────┘  │
        └───────────────────────────────┘
```

## Technology Stack

### Backend Services
- **Language**: Go 1.24.4
- **RPC Framework**: gRPC + Protocol Buffers v3
- **API Gateway**: grpc-gateway v2.27.3 (HTTP/JSON ↔ gRPC)
- **Authentication**: JWT (golang-jwt/jwt v5.3.0)
  - HMAC-SHA256 signing
  - 24-hour access tokens
  - 7-day refresh tokens
- **Database ORM**: GORM v1.31.1
- **Cache**: Redis v7 (go-redis/v9)
- **Metrics**: Prometheus client
- **Logging**: Uber Zap

### Infrastructure
- **Database**: PostgreSQL 15-alpine (Docker)
- **Cache**: Redis 7-alpine (Docker)
- **Deployment**: Docker + Kubernetes manifests

## Service Details

### 1. User Service (Port 50051)
**Responsibilities:**
- User registration & authentication
- JWT token generation & validation
- Password hashing (bcrypt)
- User profile management

**Key Endpoints (via Gateway):**
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login & get JWT tokens
- `POST /api/v1/auth/refresh` - Refresh access token
- `GET /api/v1/users/{id}` - Get user profile
- `PUT /api/v1/users/{id}` - Update user profile

### 2. Task Service (Port 50052)
**Responsibilities:**
- Task CRUD operations
- Task assignment & status management
- Task filtering & pagination
- Redis caching for performance

**Key Endpoints (via Gateway):**
- `POST /api/v1/tasks` - Create task
- `GET /api/v1/tasks` - List tasks (with filters)
- `GET /api/v1/tasks/{id}` - Get task details
- `PUT /api/v1/tasks/{id}` - Update task
- `DELETE /api/v1/tasks/{id}` - Delete task
- `PUT /api/v1/tasks/{id}/assign` - Assign task to user

### 3. Notification Service (Port 50053)
**Responsibilities:**
- Create notifications for events
- List user notifications
- Mark notifications as read
- Notification persistence

**Key Endpoints (via Gateway):**
- `POST /api/v1/notifications` - Create notification
- `GET /api/v1/notifications/user/{userId}` - Get user notifications
- `PUT /api/v1/notifications/{id}/read` - Mark as read

### 4. API Gateway (Port 8080)
**Responsibilities:**
- HTTP to gRPC translation
- CORS handling
- Rate limiting (100 req/sec, burst 10)
- Request logging
- Metrics collection
- Single entry point for all clients

## Data Flow Example: Creating a Task

```
1. Client (curl/Postman)
   │
   ├─→ POST /api/v1/tasks
   │   Headers: Authorization: Bearer <JWT>
   │   Body: {"title": "My Task", "priority": "HIGH"}
   │
2. API Gateway (:8080)
   │
   ├─→ Validates JWT (extracts user_id)
   ├─→ Translates HTTP → gRPC
   │
3. Task Service (:50052)
   │
   ├─→ Validates request
   ├─→ Checks Redis cache
   ├─→ Inserts into PostgreSQL
   │   └─→ INSERT INTO tasks (title, priority, created_by, ...)
   ├─→ Updates Redis cache
   ├─→ Returns gRPC response
   │
4. API Gateway
   │
   ├─→ Translates gRPC → JSON
   │
5. Client receives response
   └─→ {"task": {"id": "uuid", "title": "My Task", ...}}
```

## Security Features

1. **Authentication**: JWT-based with refresh tokens
2. **Password Security**: Bcrypt hashing with salt
3. **TLS/SSL**: Ready for production (configure in gateway)
4. **Rate Limiting**: Prevents API abuse
5. **CORS**: Configurable for frontend integration

## Scalability Features

1. **Microservices**: Independent scaling of services
2. **Redis Caching**: Reduces database load
3. **Connection Pooling**: Efficient database connections
4. **gRPC**: High-performance RPC
5. **Horizontal Scaling**: Each service can scale independently

## Deployment Options

### Current Setup (Development)
- PostgreSQL & Redis: Docker containers
- Services: Local Go binaries
- Port 5433 for PostgreSQL (avoids local conflict)

### Production Options

1. **Docker Compose** (Single Host)
   ```bash
   docker-compose up -d
   ```

2. **Kubernetes** (Multi-Node Cluster)
   ```bash
   kubectl apply -f deployments/k8s/
   ```

3. **Cloud Native**
   - User Service → Multiple pods with HPA
   - Task Service → Multiple pods with HPA
   - Notification Service → Multiple pods
   - Gateway → Load balanced (Ingress)
   - PostgreSQL → Managed database (AWS RDS, Azure Database)
   - Redis → Managed cache (ElastiCache, Azure Cache)

## Monitoring & Observability

- **Metrics**: Prometheus endpoints on all services
- **Logging**: Structured JSON logs (Zap)
- **Health Checks**: Kubernetes readiness/liveness probes
- **Tracing**: Ready for OpenTelemetry integration

## Missing Components (Future Enhancements)

### Frontend Options
To make this a complete application, you could add:

1. **Web Frontend** (React/Vue/Angular)
   ```
   ┌─────────────────┐
   │  React Web App  │
   │    (Port 3000)  │
   └────────┬────────┘
            │ HTTP REST
            ▼
      API Gateway :8080
   ```

2. **Mobile App** (React Native/Flutter)
   ```
   ┌─────────────────┐
   │  Mobile App     │
   │  (iOS/Android)  │
   └────────┬────────┘
            │ HTTP REST
            ▼
      API Gateway :8080
   ```

3. **Admin Dashboard** (Next.js/Svelte)
   ```
   ┌─────────────────┐
   │ Admin Dashboard │
   │    (Port 3001)  │
   └────────┬────────┘
            │ HTTP REST
            ▼
      API Gateway :8080
   ```

### Additional Services
- **Email Service**: Send task notifications via email
- **WebSocket Service**: Real-time updates
- **File Service**: Task attachments
- **Audit Service**: Track all changes
- **Search Service**: Full-text search (Elasticsearch)

## Quick Start

```bash
# Start all services
./start-services.sh

# Test the API
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "username": "johndoe",
    "password": "SecurePass123!",
    "full_name": "John Doe"
  }'

# Stop all services
pkill -f 'user-service|task-service|notification-service|gateway'
docker stop taskmanagement-postgres taskmanagement-redis
```

## API Documentation

See `API_DOCS.md` for complete API reference with all endpoints, request/response formats, and authentication details.
