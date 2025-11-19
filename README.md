# Task Management System

A production-ready, enterprise-grade task management platform built with microservices architecture. This system provides comprehensive task management capabilities with real-time collaboration, multi-tenant support, and intelligent search features.

## Overview

The Task Management System is designed for organizations that need a scalable, secure, and feature-rich solution for managing tasks, teams, and projects. Built using modern technologies and best practices, it offers a robust backend powered by Go microservices and a responsive frontend using Next.js 14.

## Key Features

### Task Management
- Complete task lifecycle management (create, read, update, delete)
- Advanced task organization with priorities, statuses, and due dates
- Intelligent search with filters, tags, and natural language queries
- Drag-and-drop Kanban board interface
- Task assignments and notifications
- Bulk operations and batch updates

### Multi-Tenancy & Organizations
- Complete organization isolation with row-level security
- Hierarchical team structures with parent-child relationships
- Project-based task grouping
- Workspace management for different contexts
- Custom groups and collections
- Secure invite system with expirable tokens

### Real-Time Collaboration
- WebSocket-based live updates
- Instant notifications for task changes
- Real-time presence indicators
- Collaborative task editing
- Activity streams and audit logs

### Security & Authentication
- JWT-based authentication with refresh tokens
- Role-based access control (RBAC) with granular permissions
- Multi-tenant data isolation
- Token blacklisting for logout
- Password hashing with bcrypt
- Rate limiting and DDoS protection

### Search & Filtering
- Intelligent search parser with mention extraction (@user)
- Tag-based filtering (#urgent)
- Status and priority filters
- Date range queries (created:>7d)
- Full-text search capabilities
- Client-side and server-side filtering

### Search & Filtering
- Intelligent search parser with mention extraction (@user)
- Tag-based filtering (#urgent)
- Status and priority filters
- Date range queries (created:>7d)
- Full-text search capabilities
- Client-side and server-side filtering

## Technical Architecture

### System Design

The system follows a microservices architecture pattern with the following components:

```
Client Layer (Browser/Mobile)
         ↓
API Gateway (HTTP/REST + WebSocket)
Port: 8080
         ↓
Microservices Layer (gRPC Communication)
├── User Service (Port 50051)
├── Task Service (Port 50052)
├── Organization Service (Port 50054)
└── Notification Service (Port 50053)
         ↓
Infrastructure Layer
├── PostgreSQL Database (Port 5432)
├── Redis Cache (Port 6379)
├── Prometheus Metrics (Port 9090)
└── Grafana Dashboards (Port 3001)
```

### Microservices Overview

**User Service** - Port 50051
- User authentication and authorization
- Profile management
- JWT token generation and validation
- Password hashing and verification
- Role and permission management

**Task Service** - Port 50052
- Task CRUD operations
- Intelligent search and filtering
- Task assignments and updates
- Status and priority management
- Due date tracking

**Organization Service** - Port 50054
- Multi-tenant organization management
- Team hierarchy and structure
- Project management
- Workspace administration
- Invite system for user onboarding

**Notification Service** - Port 50053
- Real-time WebSocket notifications
- Notification history and management
- Event broadcasting
- User presence tracking

**API Gateway** - Port 8080
- HTTP/REST to gRPC translation
- WebSocket connection management
- Authentication middleware
- Rate limiting
- CORS handling
- Request logging

## Technology Stack

### Backend Technologies

**Language & Framework**
- Go 1.24+ - Primary programming language
- gRPC - High-performance RPC framework
- Protocol Buffers - Efficient data serialization
- gRPC-Gateway - REST to gRPC transcoding

**Database & Caching**
- PostgreSQL 14+ - Primary relational database
- GORM - Go ORM for database operations
- Redis 6+ - In-memory caching and session storage
- Row-Level Security (RLS) for multi-tenancy

**Authentication & Security**
- JWT (JSON Web Tokens) - Token-based authentication
- golang-jwt/jwt/v5 - JWT implementation
- bcrypt - Password hashing
- Token refresh mechanism
- Blacklist management

**Observability & Monitoring**
- Prometheus - Metrics collection and storage
- Grafana - Metrics visualization
- Zap - Structured logging
- Custom business metrics
- Health check endpoints

**Infrastructure**
- Docker - Containerization
- Docker Compose - Local development orchestration
- Kubernetes - Production container orchestration
- Nginx - Load balancing and reverse proxy

### Frontend Technologies

**Core Framework**
- Next.js 14.2.0 - React framework with App Router
- React 18.3.0 - UI library
- TypeScript 5 - Type-safe JavaScript

**State Management**
- Zustand 4.5.2 - Lightweight state management
- TanStack Query 5.28.0 - Server state management
- React Query Devtools - State debugging

**UI & Styling**
- Tailwind CSS 3.4.1 - Utility-first CSS framework
- Framer Motion 11.18.2 - Animation library
- Lucide React - Icon library
- next-themes - Dark mode support

**Data Fetching & Real-Time**
- Axios 1.6.8 - HTTP client with interceptors
- Native WebSocket API - Real-time communication
- Automatic token refresh
- Request/response interceptors

**Forms & Validation**
- React Hook Form 7.51.2 - Form management
- Zod 3.22.4 - Schema validation
- @hookform/resolvers - Form validation integration

**Drag & Drop**
- @dnd-kit/core 6.3.1 - Drag and drop primitives
- @dnd-kit/sortable 10.0.0 - Sortable lists
- @dnd-kit/utilities 3.2.2 - Helper utilities

**Data Visualization**
- Recharts 2.15.4 - Chart library
- react-confetti 6.4.0 - Celebration effects

**Utilities**
- date-fns 3.6.0 - Date manipulation
- clsx 2.1.0 - Conditional classNames
- class-variance-authority 0.7.1 - CSS variants
- tailwind-merge 2.2.2 - Tailwind class merging
- sonner 1.7.4 - Toast notifications

## Getting Started

### Prerequisites

Before running the application, ensure you have the following installed:

- **Go** 1.24 or higher
- **Node.js** 18 or higher
- **PostgreSQL** 14 or higher
- **Redis** 6 or higher
- **Protocol Buffers** compiler (protoc)
- **Docker** and Docker Compose (optional but recommended)

### Quick Start with Docker Compose (Recommended)

The fastest way to get the entire system running:

```bash
# Clone the repository
git clone https://github.com/yourusername/task-management-system.git
cd task-management-system

# Start all services with Docker Compose
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f

# Access the application
# Frontend: http://localhost:3000
# API Gateway: http://localhost:8080
# API Documentation: http://localhost:8000/api-docs
```

### Local Development Setup

For development without Docker:

**1. Database Setup**

```bash
# Create PostgreSQL database
createdb taskmanagement

# Apply migrations
psql taskmanagement < migrations/000_base_schema.sql
psql taskmanagement < migrations/001_create_organizations_and_add_orgid.sql
psql taskmanagement < migrations/002_create_invites.sql
psql taskmanagement < migrations/006_enterprise_management.sql
```

**2. Redis Setup**

```bash
# Start Redis server
redis-server

# Verify Redis is running
redis-cli ping
```

**3. Backend Services**

```bash
# Install Go dependencies
go mod download

# Generate Protocol Buffer files
./scripts/generate-proto.sh

# Build all services
make build

# Start all services
./start.sh

# Or start services individually
./bin/user-service
./bin/task-service
./bin/org-service
./bin/notification-service
./bin/gateway
```

**4. Frontend Application**

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Create environment file
cp .env.example .env.local

# Update .env.local with backend URL
echo "NEXT_PUBLIC_API_URL=http://localhost:8080" > .env.local
echo "NEXT_PUBLIC_WS_URL=ws://localhost:8080" >> .env.local

# Start development server
npm run dev
```

**5. API Documentation Server**

```bash
# Start API documentation
./start-api-docs.sh

# Or manually
cd docs/api-server
npm install
npm start

# Access at http://localhost:8000/api-docs
```

### Environment Configuration

Create a `.env` file in the project root:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=taskmanagement
DB_SSLMODE=disable

# Redis Configuration
REDIS_ADDR=localhost:6379
REDIS_PASSWORD=
REDIS_DB=0

# JWT Configuration
JWT_SECRET=your_secret_key_change_in_production
JWT_ACCESS_TOKEN_EXPIRY=15m
JWT_REFRESH_TOKEN_EXPIRY=7d

# Server Ports
USER_SERVICE_PORT=50051
TASK_SERVICE_PORT=50052
ORG_SERVICE_PORT=50054
NOTIFICATION_SERVICE_PORT=50053
GATEWAY_PORT=8080

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Metrics
PROMETHEUS_PORT=9090
```

## Project Structure

```
task-management-system/
├── services/                    # Microservices
│   ├── user/                   # User service
│   │   ├── main.go
│   │   ├── handler/            # gRPC handlers
│   │   ├── repository/         # Database operations
│   │   └── proto/              # Generated protobuf code
│   ├── task/                   # Task service
│   ├── org/                    # Organization service
│   └── notification/           # Notification service
├── gateway/                     # API Gateway
│   ├── main.go
│   ├── handlers/               # HTTP handlers
│   ├── middleware/             # Auth, logging, rate limiting
│   └── websocket/              # WebSocket hub
├── frontend/                    # Next.js frontend
│   ├── src/
│   │   ├── app/               # Next.js App Router pages
│   │   ├── components/        # React components
│   │   ├── lib/               # Utilities and API client
│   │   └── store/             # Zustand stores
│   ├── public/                # Static assets
│   └── package.json
├── proto/                       # Protocol Buffer definitions
│   ├── user.proto
│   ├── task.proto
│   ├── organization.proto
│   └── notification.proto
├── pkg/                         # Shared Go packages
│   ├── auth/                  # JWT utilities
│   ├── database/              # Database connection
│   ├── cache/                 # Redis client
│   ├── config/                # Configuration management
│   └── metrics/               # Prometheus metrics
├── migrations/                  # Database migrations
├── deployments/                 # Deployment configurations
│   ├── docker/                # Dockerfiles
│   ├── k8s/                   # Kubernetes manifests
│   └── monitoring/            # Prometheus/Grafana configs
├── scripts/                     # Build and utility scripts
│   ├── build.sh
│   ├── generate-proto.sh
│   ├── load-test.sh
│   └── test.sh
├── docs/                        # Documentation
│   ├── api/                   # API reference
│   ├── architecture/          # Architecture diagrams
│   ├── guides/                # User and developer guides
│   └── deployment/            # Deployment guides
├── bin/                         # Compiled binaries
├── docker-compose.yml
├── Makefile
├── go.mod
└── README.md
```

## API Documentation

### Authentication Endpoints

**Register User**
```
POST /api/v1/auth/register
Content-Type: application/json

{
  "username": "johndoe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "org_id": "org-uuid"
}
```

**Login**
```
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "SecurePass123!"
}

Response:
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc...",
  "user": {...}
}
```

**Refresh Token**
```
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refresh_token": "eyJhbGc..."
}
```

### Task Management Endpoints

**Create Task**
```
POST /api/v1/tasks
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "title": "Implement authentication",
  "description": "Add JWT-based authentication",
  "status": "TODO",
  "priority": "HIGH",
  "assigned_to": "user-uuid",
  "due_date": "2025-12-31T23:59:59Z",
  "tags": ["backend", "security"]
}
```

**List Tasks**
```
GET /api/v1/tasks?status=TODO&priority=HIGH&assigned_to=user-uuid
Authorization: Bearer <access_token>
```

**Update Task**
```
PUT /api/v1/tasks/{task_id}
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "status": "IN_PROGRESS",
  "priority": "URGENT"
}
```

**Delete Task**
```
DELETE /api/v1/tasks/{task_id}
Authorization: Bearer <access_token>
```

**Search Tasks**
```
GET /api/v1/tasks/search?q=@john #urgent status:in_progress created:>7d
Authorization: Bearer <access_token>
```

### Organization Endpoints

**Create Organization**
```
POST /api/v1/organizations
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "name": "Acme Corporation",
  "domain": "acme.com",
  "description": "Leading technology company"
}
```

**Invite User to Organization**
```
POST /api/v1/organizations/{org_id}/invites
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "email": "newuser@example.com",
  "role": "member"
}
```

**List Teams**
```
GET /api/v1/organizations/{org_id}/teams
Authorization: Bearer <access_token>
```

### Notification Endpoints

**Get User Notifications**
```
GET /api/v1/notifications/user/{user_id}
Authorization: Bearer <access_token>
```

**Mark as Read**
```
PUT /api/v1/notifications/{notification_id}/read
Authorization: Bearer <access_token>
```

### WebSocket Connection

**Connect**
```
WS ws://localhost:8080/ws?token=<access_token>
```

**Message Format**
```json
{
  "type": "task.created",
  "data": {
    "id": "task-uuid",
    "title": "New Task",
    "created_by": "user-uuid"
  },
  "timestamp": "2025-11-19T10:30:00Z"
}
```

For complete API documentation with interactive examples, visit the API documentation server at `http://localhost:8000/api-docs`

## Development

### Building from Source

```bash
# Build all services
make build

# Build specific service
go build -o bin/user-service services/user/main.go

# Run tests
make test

# Run tests with coverage
make test-coverage

# Generate Protocol Buffer code
./scripts/generate-proto.sh
```

### Running Tests

```bash
# Run all tests
go test ./...

# Run tests with coverage
go test -cover ./...

# Run tests for specific service
cd services/task && go test -v ./...

# Frontend tests
cd frontend && npm test
```

### Load Testing

```bash
# Run load tests
./scripts/load-test.sh

# Custom load test
hey -n 10000 -c 100 -H "Authorization: Bearer <token>" \
  http://localhost:8080/api/v1/tasks
```

## Deployment

### Docker Deployment

```bash
# Build Docker images
make docker-build

# Tag and push to registry
docker tag task-user-service:latest your-registry/task-user-service:v1.0.0
docker push your-registry/task-user-service:v1.0.0

# Deploy with Docker Compose
docker-compose -f docker-compose.prod.yml up -d
```

### Kubernetes Deployment

```bash
# Create namespace
kubectl create namespace task-management

# Apply ConfigMap and Secrets
kubectl apply -f deployments/k8s/configmap.yaml
kubectl apply -f deployments/k8s/secrets.yaml

# Deploy PostgreSQL and Redis
kubectl apply -f deployments/k8s/postgres.yaml
kubectl apply -f deployments/k8s/redis.yaml

# Deploy services
kubectl apply -f deployments/k8s/user-service.yaml
kubectl apply -f deployments/k8s/task-service.yaml
kubectl apply -f deployments/k8s/notification-service.yaml
kubectl apply -f deployments/k8s/gateway.yaml

# Apply Horizontal Pod Autoscaler
kubectl apply -f deployments/k8s/hpa.yaml

# Check deployment status
kubectl get pods -n task-management
kubectl get services -n task-management

# View logs
kubectl logs -f deployment/task-service -n task-management
```

### Production Considerations

**Security**
- Use strong JWT secrets (256-bit minimum)
- Enable HTTPS/TLS for all communications
- Implement API rate limiting
- Use PostgreSQL SSL mode in production
- Regular security audits
- Keep dependencies updated

**Performance**
- Enable connection pooling (10-20 connections per service)
- Configure Redis caching appropriately
- Use CDN for frontend assets
- Enable gzip compression
- Implement database indexes
- Monitor query performance

**Scalability**
- Horizontal pod autoscaling (2-10 replicas)
- Database read replicas for read-heavy workloads
- Redis cluster for high availability
- Load balancer configuration
- CDN for static assets

**Monitoring**
- Prometheus for metrics collection
- Grafana for visualization
- Alert manager for critical alerts
- Application performance monitoring (APM)
- Error tracking (e.g., Sentry)
- Log aggregation (e.g., ELK stack)

## Monitoring and Observability

### Prometheus Metrics

Each service exposes metrics on dedicated ports:

```bash
# User Service metrics
curl http://localhost:9091/metrics

# Task Service metrics  
curl http://localhost:9092/metrics

# Notification Service metrics
curl http://localhost:9093/metrics

# Gateway metrics
curl http://localhost:9090/metrics
```

### Available Metrics

- `http_requests_total` - Total HTTP requests by method and path
- `http_request_duration_seconds` - Request latency histogram
- `grpc_requests_total` - Total gRPC requests by method
- `grpc_request_duration_seconds` - gRPC request latency
- `db_connections_open` - Number of open database connections
- `db_connections_idle` - Number of idle database connections
- `redis_hits_total` - Redis cache hits
- `redis_misses_total` - Redis cache misses
- `websocket_connections_active` - Active WebSocket connections
- `task_operations_total` - Task operations by type
- `notification_sent_total` - Notifications sent by type

### Health Checks

```bash
# Gateway health
curl http://localhost:8080/health

# Individual service health
curl http://localhost:50051/health  # User Service
curl http://localhost:50052/health  # Task Service
curl http://localhost:50053/health  # Notification Service
```

## Database Schema

### Core Tables

**organizations** - Multi-tenant organization data
- `id` (UUID, PK)
- `name` (VARCHAR)
- `domain` (VARCHAR)
- `description` (TEXT)
- `created_at`, `updated_at`

**users** - User accounts
- `id` (UUID, PK)
- `org_id` (UUID, FK → organizations.id)
- `email` (VARCHAR, UNIQUE)
- `username` (VARCHAR, UNIQUE)
- `password_hash` (VARCHAR)
- `role` (ENUM: super_admin, org_admin, team_lead, member, guest)
- `created_at`, `updated_at`

**tasks** - Task management
- `id` (UUID, PK)
- `org_id` (UUID, FK → organizations.id)
- `title` (VARCHAR)
- `description` (TEXT)
- `status` (ENUM: TODO, IN_PROGRESS, DONE, ARCHIVED)
- `priority` (ENUM: LOW, MEDIUM, HIGH, URGENT)
- `assigned_to` (UUID, FK → users.id)
- `created_by` (UUID, FK → users.id)
- `team_id` (UUID, FK → teams.id)
- `project_id` (UUID, FK → projects.id)
- `workspace_id` (UUID, FK → workspaces.id)
- `due_date` (TIMESTAMP)
- `tags` (VARCHAR[])
- `created_at`, `updated_at`

**teams** - Hierarchical team structure
- `id` (UUID, PK)
- `org_id` (UUID, FK → organizations.id)
- `name` (VARCHAR)
- `parent_team_id` (UUID, FK → teams.id, nullable)
- `team_lead_id` (UUID, FK → users.id)
- `status` (ENUM)
- `created_at`, `updated_at`

**invites** - User invitation system
- `id` (UUID, PK)
- `org_id` (UUID, FK → organizations.id)
- `email` (VARCHAR)
- `role` (VARCHAR)
- `token_hash` (VARCHAR)
- `expires_at` (TIMESTAMP)
- `used_at` (TIMESTAMP, nullable)
- `created_by` (UUID, FK → users.id)
- `created_at`

**notifications** - Notification history
- `id` (UUID, PK)
- `user_id` (UUID, FK → users.id)
- `org_id` (UUID, FK → organizations.id)
- `type` (VARCHAR)
- `title` (VARCHAR)
- `message` (TEXT)
- `is_read` (BOOLEAN)
- `created_at`

### Multi-Tenant Isolation

All tables include `org_id` for complete data isolation. Row-level security (RLS) policies ensure users can only access data from their organization.

## Troubleshooting

### Common Issues

**Service won't start**
```bash
# Check if port is already in use
lsof -i :8080

# Kill process using port
kill -9 $(lsof -t -i:8080)
```

**Database connection errors**
```bash
# Verify PostgreSQL is running
pg_isready

# Check database exists
psql -l | grep taskmanagement

# Test connection
psql -h localhost -U postgres -d taskmanagement
```

**Redis connection errors**
```bash
# Check Redis status
redis-cli ping

# Should return PONG
```

**Proto compilation errors**
```bash
# Install protoc compiler
# macOS
brew install protobuf

# Install Go plugins
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Regenerate proto files
./scripts/generate-proto.sh
```

**Frontend build errors**
```bash
# Clear Next.js cache
cd frontend
rm -rf .next node_modules
npm install
npm run build
```

## Contributing

We welcome contributions from the community. Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Write or update tests
5. Ensure all tests pass (`make test`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Code Standards

- Follow Go best practices and conventions
- Use gofmt for Go code formatting
- Follow React/TypeScript best practices for frontend
- Write meaningful commit messages
- Add tests for new features
- Update documentation as needed

### Commit Message Format

```
type(scope): subject

body

footer
```

Types: feat, fix, docs, style, refactor, test, chore

Example:
```
feat(task-service): add intelligent search parsing

Implemented SearchParser to extract mentions, tags, and filters
from natural language queries. Supports @mentions, #tags, and
key:value filters.

Closes #123
```

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Support and Contact

- **Documentation**: Check the `/docs` directory for comprehensive guides
- **Issues**: Report bugs or request features via GitHub Issues
- **Discussions**: Join community discussions on GitHub Discussions
- **Security**: Report security vulnerabilities to security@example.com

## Acknowledgments

This project leverages several excellent open-source technologies:

**Backend**
- gRPC - High-performance RPC framework by Google
- Protocol Buffers - Efficient data serialization
- GORM - Feature-rich Go ORM
- Zap - Blazing fast structured logging
- Gorilla WebSocket - WebSocket implementation

**Frontend**
- Next.js - React framework by Vercel
- TanStack Query - Powerful data synchronization
- Tailwind CSS - Utility-first CSS framework
- dnd-kit - Modern drag and drop toolkit
- Zustand - Lightweight state management

**Infrastructure**
- PostgreSQL - Advanced open-source database
- Redis - In-memory data structure store
- Prometheus - Monitoring and alerting toolkit
- Docker - Container platform
- Kubernetes - Container orchestration

---

Built with Go, gRPC, Next.js, and modern cloud-native technologies.

For detailed documentation, visit the `/docs` directory or start the API documentation server at `http://localhost:8000/api-docs`
