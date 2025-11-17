# # # 🚀 Task Management System

<div align="center">

![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8?style=for-the-badge&logo=go)
![gRPC](https://img.shields.io/badge/gRPC-Protocol_Buffers-244c5a?style=for-the-badge&logo=grpc)
![Next.js](https://img.shields.io/badge/Next.js-14-black?style=for-the-badge&logo=next.js)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Kubernetes](https://img.shields.io/badge/Kubernetes-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white)

**A production-ready, enterprise-grade task management system built with microservices architecture using gRPC, Go, and Next.js**

[Features](#-features) • [Quick Start](#-quick-start) • [Documentation](#-documentation) • [Architecture](#-architecture) • [API](#-api-overview)

</div>

---

# # ## 🌟 Features

# # ### Core Functionality

- ✅ **Advanced Task Management** - Create, update, delete, and organize tasks with rich metadata
- ✅ **Intelligent Search** - Full-text search with filters, tags, and advanced queries
- ✅ **Real-time Updates** - WebSocket-based live updates and notifications
- ✅ **Workspace & Teams** - Multi-tenant architecture with workspace isolation
- ✅ **Role-Based Access Control** - Granular permissions (Admin, Team Member, Guest)
- ✅ **Drag & Drop Interface** - Intuitive Kanban-style task board

# # ### Technical Excellence

- 🔐 **JWT Authentication** - Secure token-based authentication
- 🚀 **Microservices Architecture** - Scalable, independent services
- ⚡ **High Performance** - Redis caching, connection pooling, optimized queries
- 📊 **Observability** - Prometheus metrics, structured logging, health checks
- 🐳 **Containerized** - Docker & Kubernetes ready
- 🔄 **CI/CD Ready** - Automated testing and deployment pipelines

# # ### Modern Frontend

- 🎨 **Next.js 14** - React Server Components, App Router
- 🎭 **TypeScript** - Type-safe development
- 🎯 **Tailwind CSS** - Modern, responsive UI
- 📱 **Responsive Design** - Works on all devices
- 🔔 **Real-time Notifications** - Instant updates via WebSockets

---

# # ## 🏗️ Architecture

# # ### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js 14)                    │
│                    http://localhost:3000                         │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST API / WebSocket
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway (Go + gRPC-Gateway)               │
│                         :8080 (HTTP/REST)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Rate Limiting │ JWT Auth │ Logging │ CORS │ WebSocket  │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │ gRPC
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  User Service    │ │  Task Service    │ │ Notification     │
│   :50051 (gRPC)  │ │   :50052 (gRPC)  │ │   Service        │
│   :9091 (metrics)│ │   :9092 (metrics)│ │   :50053 (gRPC)  │
│                  │ │                  │ │   :9093 (metrics)│
└────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              ▼
              ┌───────────────────────────────┐
              │     PostgreSQL Database       │
              │      :5432 (taskmanagement)   │
              └───────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Redis Cache    │
                    │      :6379      │
                    └─────────────────┘
```

# # ### Microservices

| Service | Port | Purpose | Tech Stack |
|---------|------|---------|------------|
| **User Service** | 50051 | Authentication, user management, profiles | Go, gRPC, PostgreSQL |
| **Task Service** | 50052 | Task CRUD, search, filtering | Go, gRPC, PostgreSQL |
| **Notification Service** | 50053 | Real-time notifications, streaming | Go, gRPC, Redis |
| **API Gateway** | 8080 | REST proxy, WebSocket, auth middleware | Go, gRPC-Gateway |
| **Frontend** | 3000 | Web UI, user interface | Next.js 14, TypeScript |

---

# # ## 🚀 Quick Start

# # ### Prerequisites

- **Go** 1.21 or higher
- **Node.js** 18+ and npm/yarn
- **PostgreSQL** 14+
- **Redis** 6+
- **Docker** & Docker Compose (optional but recommended)
- **Protocol Buffers** compiler (`protoc`)

# # ### Option 1: Docker Compose (Recommended)

```bash
# # # Clone the repository
git clone <repository-url>
cd task-management-system

# # # Start all services
docker-compose up -d

# # # Check service health
docker-compose ps

# # # View logs
docker-compose logs -f

# # # Frontend: http://localhost:3000
```

# # ### Option 2: Local Development

```bash
# # # 1. Install dependencies
go mod download
cd frontend && npm install && cd ..

# # # 2. Setup database
createdb taskmanagement
psql taskmanagement < scripts/schema.sql

# # # 3. Start Redis
redis-server

# # # 4. Configure environment
cp .env.example .env
# # # Edit .env with your database credentials

# # # 5. Generate Protocol Buffers
./scripts/generate-proto.sh

# # # 6. Start backend services
./start.sh

# # # 7. Start frontend (in new terminal)
cd frontend
npm run dev
```

# # ### Verify Installation

```bash
# # # Check API health
curl http://localhost:8080/health

# # # Check services
curl http://localhost:8080/api/v1/tasks

# # # Access frontend
open http://localhost:3000
```

---

# # ## 📚 Documentation

| Document | Description |
|----------|-------------|
| [📖 Complete Guide](docs/guides/COMPLETE_GUIDE.md) | Comprehensive user and developer guide |
| [🏗️ Architecture](docs/architecture/ARCHITECTURE.md) | System design and architecture details |
| [🔌 API Reference](docs/api/API_REFERENCE.md) | Complete API documentation |
| [🚀 Production Guide](docs/deployment/PRODUCTION_GUIDE.md) | Deployment and operations |
| [🔧 Quick Reference](docs/guides/QUICK_REFERENCE.md) | Quick commands and tips |
| [🔗 Integration Guide](docs/guides/INTEGRATION_GUIDE.md) | External integrations |
| [🎨 Frontend Guide](docs/guides/CUSTOM_FRONTEND_GUIDE.md) | Custom frontend development |

---

# # ## 🔌 API Overview

# # ### Authentication

```bash
# # # Register
POST /api/v1/auth/register
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "secure_password"
}

# # # Login
POST /api/v1/auth/login
{
  "email": "john@example.com",
  "password": "secure_password"
}
```

# # ### Tasks

```bash
# # # Create task
POST /api/v1/tasks
Authorization: Bearer <token>
{
  "title": "Implement feature",
  "description": "Description here",
  "status": "TODO",
  "priority": "HIGH",
  "due_date": "2025-12-31T23:59:59Z"
}

# # # List tasks
GET /api/v1/tasks?status=TODO&priority=HIGH

# # # Update task
PUT /api/v1/tasks/{id}

# # # Delete task
DELETE /api/v1/tasks/{id}
```

See [API Reference](docs/api/API_REFERENCE.md) for complete documentation.

---

# # ## 🛠️ Tech Stack

# # ### Backend

- **Language**: Go 1.21+
- **RPC Framework**: gRPC + Protocol Buffers
- **Database**: PostgreSQL 14+ with GORM
- **Cache**: Redis 6+
- **Auth**: JWT tokens
- **Logging**: Zap (structured logging)
- **Metrics**: Prometheus

# # ### Frontend

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 3
- **State Management**: React Query (TanStack Query)
- **UI Components**: Radix UI, Headless UI
- **Drag & Drop**: @dnd-kit
- **Forms**: React Hook Form + Zod validation

# # ### DevOps

- **Containerization**: Docker
- **Orchestration**: Kubernetes
- **CI/CD**: GitHub Actions (ready)
- **Monitoring**: Prometheus + Grafana
- **Load Balancing**: Nginx (Kubernetes Ingress)

---

# # ## 📊 Project Structure

```
task-management-system/
├── 📁 services/              # Microservices
│   ├── user/                 # User service
│   ├── task/                 # Task service
│   └── notification/         # Notification service
├── 📁 gateway/               # API Gateway
├── 📁 frontend/              # Next.js frontend
│   ├── src/
│   │   ├── app/             # Next.js App Router
│   │   ├── components/      # React components
│   │   ├── lib/             # Utilities & API client
│   │   └── store/           # State management
├── 📁 proto/                 # Protocol Buffer definitions
├── 📁 pkg/                   # Shared Go packages
│   ├── auth/                # Authentication utilities
│   ├── database/            # Database connections
│   ├── cache/               # Redis client
│   └── metrics/             # Prometheus metrics
├── 📁 deployments/           # Deployment configs
│   ├── docker/              # Dockerfiles
│   ├── k8s/                 # Kubernetes manifests
│   └── monitoring/          # Prometheus configs
├── 📁 scripts/               # Build & utility scripts
├── 📁 docs/                  # Documentation
└── 📁 bin/                   # Compiled binaries
```

---

# # ## 🧪 Testing

```bash
# # # Run all tests
make test

# # # Run tests with coverage
make test-coverage

# # # Run specific service tests
cd services/task && go test -v ./...

# # # Load testing
./scripts/load-test.sh

# # # Frontend tests
cd frontend && npm test
```

---

# # ## 📈 Monitoring & Observability

# # ### Prometheus Metrics

- Service health metrics
- Request latency and throughput
- Database connection pool stats
- Cache hit/miss rates
- Custom business metrics

# # ### Access Metrics

```bash
# # # User Service metrics
curl http://localhost:9091/metrics

# # # Task Service metrics
curl http://localhost:9092/metrics

# # # Notification Service metrics
curl http://localhost:9093/metrics

# # # Gateway metrics
curl http://localhost:9090/metrics
```

---

# # ## 🚢 Deployment

# # ### Docker

```bash
# # # Build all services
make docker-build

# # # Push to registry
make docker-push

# # # Deploy with Docker Compose
docker-compose up -d
```

# # ### Kubernetes

```bash
# # # Apply all manifests
kubectl apply -f deployments/k8s/

# # # Check deployments
kubectl get pods

# # # Scale services
kubectl scale deployment task-service --replicas=3

# # # View logs
kubectl logs -f deployment/task-service
```

See [Production Guide](docs/deployment/PRODUCTION_GUIDE.md) for detailed deployment instructions.

---

# # ## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

# # ### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Press to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

# # ## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

# # ## 👥 Team & Support

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](../../issues)
- **Discussions**: [GitHub Discussions](../../discussions)

---

# # ## 🙏 Acknowledgments

- [gRPC](https://grpc.io/) - High-performance RPC framework
- [Protocol Buffers](https://developers.google.com/protocol-buffers) - Efficient serialization
- [Next.js](https://nextjs.org/) - React framework
- [GORM](https://gorm.io/) - Go ORM
- [Zap](https://github.com/uber-go/zap) - Fast structured logging

---

<div align="center">

**Built with ❤️ using Go, gRPC, and Next.js**

⭐ Star this repository if you find it helpful!

</div>
