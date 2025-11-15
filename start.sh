#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if a process is running
check_process() {
    local pid=$1
    local service_name=$2
    local log_file=$3
    
    sleep 3
    
    if ! ps -p $pid > /dev/null 2>&1; then
        echo -e "${RED}ERROR: ${service_name} failed to start${NC}"
        echo "Last 20 lines from log:"
        tail -n 20 "$log_file"
        return 1
    fi
    
    # Check for critical error patterns in logs (exclude Redis warnings)
    if grep -i "fatal\|panic" "$log_file" | grep -v "redis.*auto mode fallback" | tail -5 | grep -q .; then
        echo -e "${RED}ERROR: Critical errors detected in ${service_name} logs:${NC}"
        grep -i "fatal\|panic" "$log_file" | grep -v "redis.*auto mode fallback" | tail -5
        echo -e "${RED}${service_name} has critical errors. Please fix before continuing.${NC}"
        return 1
    fi
    
    # Check for connection/startup errors (but not Redis client warnings)
    if grep -i "failed to listen\|failed to connect\|failed to start" "$log_file" | grep -v "redis.*auto mode fallback" | tail -5 | grep -q .; then
        echo -e "${RED}ERROR: Startup errors detected in ${service_name} logs:${NC}"
        grep -i "failed to listen\|failed to connect\|failed to start" "$log_file" | grep -v "redis.*auto mode fallback" | tail -5
        echo -e "${RED}${service_name} has startup errors. Please fix before continuing.${NC}"
        return 1
    fi
    
    return 0
}

# Function to stop all services
cleanup() {
    echo -e "\n${YELLOW}Stopping all services...${NC}"
    pkill -f "bin/user-service" 2>/dev/null || true
    pkill -f "bin/task-service" 2>/dev/null || true
    pkill -f "bin/notification-service" 2>/dev/null || true
    pkill -f "bin/gateway" 2>/dev/null || true
    exit 1
}

trap cleanup ERR

# Create logs directory if it doesn't exist
mkdir -p logs

# Load environment variables (ignore comments and empty lines)
if [ -f .env ]; then
    export $(grep -v '^#' .env | grep -v '^$' | xargs)
fi

echo "Starting Task Management System..."
echo "=================================="
echo ""

# STEP 1: Start Backend Services
echo "[1/5] Starting UserService on port 50051..."
nohup ./bin/user-service > logs/user-service.log 2>&1 &
USER_SERVICE_PID=$!
if ! check_process $USER_SERVICE_PID "UserService" "logs/user-service.log"; then
    cleanup
fi
echo -e "${GREEN}UserService started successfully (PID: $USER_SERVICE_PID)${NC}"
echo ""

echo "[2/5] Starting TaskService on port 50052..."
nohup ./bin/task-service > logs/task-service.log 2>&1 &
TASK_SERVICE_PID=$!
if ! check_process $TASK_SERVICE_PID "TaskService" "logs/task-service.log"; then
    cleanup
fi
echo -e "${GREEN}TaskService started successfully (PID: $TASK_SERVICE_PID)${NC}"
echo ""

echo "[3/5] Starting NotificationService on port 50053..."
nohup ./bin/notification-service > logs/notification-service.log 2>&1 &
NOTIFICATION_SERVICE_PID=$!
if ! check_process $NOTIFICATION_SERVICE_PID "NotificationService" "logs/notification-service.log"; then
    cleanup
fi
echo -e "${GREEN}NotificationService started successfully (PID: $NOTIFICATION_SERVICE_PID)${NC}"
echo ""

echo "[4/5] Starting API Gateway on port 8080..."
nohup ./bin/gateway > logs/gateway.log 2>&1 &
GATEWAY_PID=$!
if ! check_process $GATEWAY_PID "Gateway" "logs/gateway.log"; then
    cleanup
fi
echo -e "${GREEN}API Gateway started successfully (PID: $GATEWAY_PID)${NC}"
echo ""

# Wait a bit more for gateway to be fully ready
sleep 2

# Verify gateway is responding
echo "Verifying API Gateway health..."
if curl -s --max-time 5 http://localhost:8080/health > /dev/null 2>&1; then
    echo -e "${GREEN}API Gateway is responding${NC}"
else
    echo -e "${YELLOW}WARNING: Gateway health check failed, but process is running${NC}"
fi
echo ""

# STEP 2: Start Frontend
echo "[5/5] Starting Frontend..."
cd frontend

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}node_modules not found. Installing dependencies...${NC}"
    npm install
fi

# Start frontend in background
nohup npm run dev > ../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..

sleep 5

if ! ps -p $FRONTEND_PID > /dev/null 2>&1; then
    echo -e "${RED}ERROR: Frontend failed to start${NC}"
    echo "Last 20 lines from log:"
    tail -n 20 logs/frontend.log
    cleanup
fi

echo -e "${GREEN}Frontend started successfully (PID: $FRONTEND_PID)${NC}"
echo ""

# Final Summary
echo "=================================="
echo -e "${GREEN}All services started successfully!${NC}"
echo "=================================="
echo ""
echo "Backend Services:"
echo "  - UserService:         http://localhost:50051 (PID: $USER_SERVICE_PID)"
echo "  - TaskService:         http://localhost:50052 (PID: $TASK_SERVICE_PID)"
echo "  - NotificationService: http://localhost:50053 (PID: $NOTIFICATION_SERVICE_PID)"
echo "  - API Gateway:         http://localhost:8080 (PID: $GATEWAY_PID)"
echo ""
echo "Frontend:"
echo "  - Next.js App:         http://localhost:3000 (PID: $FRONTEND_PID)"
echo ""
echo "Logs Location: ./logs/"
echo ""
echo "To test the API:"
echo "curl http://localhost:8080/api/v1/auth/register -H 'Content-Type: application/json' -d '{\"email\":\"test@example.com\",\"username\":\"testuser\",\"password\":\"password123\",\"full_name\":\"Test User\"}'"
echo ""
echo "To stop all services, run: pkill -f 'bin/user-service|bin/task-service|bin/notification-service|bin/gateway' && pkill -f 'next'"
