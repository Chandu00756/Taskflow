#!/bin/bash

# # # Load environment variables
set -a
source .env
set +a

# # # Create logs directory
mkdir -p logs

# # # Start services
echo "🚀 Starting User Service on :50051..."
./bin/user-service > logs/user-service.log 2>&1 &
USER_PID=$!
echo "   PID: $USER_PID"

sleep 2

echo "🚀 Starting Task Service on :50052..."
./bin/task-service > logs/task-service.log 2>&1 &
TASK_PID=$!
echo "   PID: $TASK_PID"

sleep 2

echo "🚀 Starting Notification Service on :50053..."
./bin/notification-service > logs/notification-service.log 2>&1 &
NOTIF_PID=$!
echo "   PID: $NOTIF_PID"

sleep 2

echo "🚀 Starting API Gateway on :8080..."
./bin/gateway > logs/gateway.log 2>&1 &
GATEWAY_PID=$!
echo "   PID: $GATEWAY_PID"

sleep 3

# # # Check if services are running
echo ""
echo "📊 Service Status:"
echo "=================="

if ps -p $USER_PID > /dev/null; then
    echo "✅ User Service     - Running (PID: $USER_PID)"
else
    echo "❌ User Service     - Failed"
    echo "   Last 5 log lines:"
    tail -5 logs/user-service.log | sed 's/^/   /'
fi

if ps -p $TASK_PID > /dev/null; then
    echo "✅ Task Service     - Running (PID: $TASK_PID)"
else
    echo "❌ Task Service     - Failed"
    echo "   Last 5 log lines:"
    tail -5 logs/task-service.log | sed 's/^/   /'
fi

if ps -p $NOTIF_PID > /dev/null; then
    echo "✅ Notification Svc - Running (PID: $NOTIF_PID)"
else
    echo "❌ Notification Svc - Failed"
    echo "   Last 5 log lines:"
    tail -5 logs/notification-service.log | sed 's/^/   /'
fi

if ps -p $GATEWAY_PID > /dev/null; then
    echo "✅ API Gateway      - Running (PID: $GATEWAY_PID)"
else
    echo "❌ API Gateway      - Failed"
    echo "   Last 5 log lines:"
    tail -5 logs/gateway.log | sed 's/^/   /'
fi

echo ""
echo "💡 Tips:"
echo "   - View logs: tail -f logs/<service>.log"
echo "   - Stop all: pkill -f 'user-service|task-service|notification-service|gateway'"
echo "   - API Gateway: http://localhost:8080"
