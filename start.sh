sleep 5
echo -e "${GREEN}Frontend started successfully (PID: $FRONTEND_PID)${NC}"
# # #!/bin/bash

set -e

# # # Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

mkdir -p logs pids

# # # Usage: ./start.sh [local]
MODE="docker"
if [ "$1" = "local" ]; then
    MODE="local"
fi

echo "Starting Task Management System (mode: $MODE)..."
echo "=================================="

if [ "$MODE" = "docker" ] && command -v docker > /dev/null 2>&1 && [ -f docker-compose.yml ]; then
    echo "Starting backend with Docker Compose..."

# # # Stop any local binaries that might conflict
    pkill -f "bin/user-service" 2>/dev/null || true
    pkill -f "bin/task-service" 2>/dev/null || true
    pkill -f "bin/notification-service" 2>/dev/null || true
    pkill -f "bin/gateway" 2>/dev/null || true
    pkill -f "next dev" 2>/dev/null || true

    docker compose up -d --build

    echo "Waiting for containers to initialize..."
    sleep 5
    echo "Containers started:" 
    docker ps --filter "name=taskmanagement-postgres" --filter "status=running" --format "{{.Names}}: {{.Status}}" || true

# # # Start frontend locally (frontend not in compose)
    echo "Starting Frontend (local Next.js)..."
    cd frontend
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}node_modules not found. Installing dependencies...${NC}"
        npm install
    fi
    nohup npm run dev > ../logs/frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > ../pids/frontend.pid
    cd ..
    sleep 3
    if ! ps -p $FRONTEND_PID > /dev/null 2>&1; then
        echo -e "${RED}ERROR: Frontend failed to start${NC}"
        tail -n 20 logs/frontend.log
        exit 1
    fi
    echo -e "${GREEN}Frontend started successfully (PID: $FRONTEND_PID)${NC}"

    echo "=================================="
    echo -e "${GREEN}All services started successfully (Docker mode)!${NC}"
    echo "=================================="
    echo "Backend Services:"
    echo "  - UserService:         http://localhost:50051"
    echo "  - TaskService:         http://localhost:50052"
    echo "  - NotificationService: http://localhost:50053"
    echo "  - API Gateway:         http://localhost:8080"
    echo "Frontend:"
    echo "  - Next.js App:         http://localhost:3000 (PID: $FRONTEND_PID)"
    echo "Logs Location: ./logs/"
    echo "To start in local binary mode instead, run: ./start.sh local"
else
    echo "Starting backend as local binaries..."

# # # If docker-compose containers are running, stop them to avoid port conflicts
    if command -v docker > /dev/null 2>&1; then
        docker compose down 2>/dev/null || true
    fi

# # # Start backend binaries and record PIDs
    echo "[1/5] Starting UserService on port 50051..."
    nohup ./bin/user-service > logs/user-service.log 2>&1 &
    USER_SERVICE_PID=$!
    echo $USER_SERVICE_PID > pids/user-service.pid
    sleep 1
    echo "[2/5] Starting TaskService on port 50052..."
    nohup ./bin/task-service > logs/task-service.log 2>&1 &
    TASK_SERVICE_PID=$!
    echo $TASK_SERVICE_PID > pids/task-service.pid
    sleep 1
    echo "[3/5] Starting NotificationService on port 50053..."
    nohup ./bin/notification-service > logs/notification-service.log 2>&1 &
    NOTIFICATION_SERVICE_PID=$!
    echo $NOTIFICATION_SERVICE_PID > pids/notification-service.pid
    sleep 1
    echo "[4/5] Starting API Gateway on port 8080..."
    nohup ./bin/gateway > logs/gateway.log 2>&1 &
    GATEWAY_PID=$!
    echo $GATEWAY_PID > pids/gateway.pid
    sleep 2

    echo "Verifying API Gateway health..."
    if curl -s --max-time 5 http://localhost:8080/health > /dev/null 2>&1; then
        echo -e "${GREEN}API Gateway is responding${NC}"
    else
        echo -e "${YELLOW}WARNING: Gateway health check failed, but processes are running${NC}"
    fi

# # # Start frontend
    echo "[5/5] Starting Frontend..."
    cd frontend
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}node_modules not found. Installing dependencies...${NC}"
        npm install
    fi
    nohup npm run dev > ../logs/frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > ../pids/frontend.pid
    cd ..
    sleep 3

    echo -e "${GREEN}Frontend started successfully (PID: $FRONTEND_PID)${NC}"

    echo "=================================="
    echo -e "${GREEN}All services started successfully (Local mode)!${NC}"
    echo "=================================="
    echo "Backend Services:"
    echo "  - UserService:         http://localhost:50051 (PID: $USER_SERVICE_PID)"
    echo "  - TaskService:         http://localhost:50052 (PID: $TASK_SERVICE_PID)"
    echo "  - NotificationService: http://localhost:50053 (PID: $NOTIFICATION_SERVICE_PID)"
    echo "  - API Gateway:         http://localhost:8080 (PID: $GATEWAY_PID)"
    echo "Frontend:"
    echo "  - Next.js App:         http://localhost:3000 (PID: $FRONTEND_PID)"
    echo "Logs Location: ./logs/"
    echo "To start in docker mode (recommended): ./start.sh"
fi

echo ""
