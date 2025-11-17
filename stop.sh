#!/bin/bash

set -e

# # # Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

mkdir -p pids logs

echo "Stopping Task Management System..."
echo "================================="

# # # Stop frontend (use PID file if present)
echo "Stopping Frontend..."
if [ -f pids/frontend.pid ]; then
	FRONTEND_PID=$(cat pids/frontend.pid)
	if kill -0 "$FRONTEND_PID" 2>/dev/null; then
		kill "$FRONTEND_PID" || true
		echo "  Killed frontend PID $FRONTEND_PID"
	fi
	rm -f pids/frontend.pid
else
	pkill -f "next dev" 2>/dev/null || pkill -f "npm run dev" 2>/dev/null || echo "  Frontend was not running"
fi

# # # Stop local binaries (use PID files if present)
echo "Stopping local backend binaries..."
for svc in user-service task-service notification-service gateway; do
	pidfile="pids/${svc}.pid"
	if [ -f "$pidfile" ]; then
		PID=$(cat "$pidfile")
		if kill -0 "$PID" 2>/dev/null; then
			kill "$PID" || true
			echo "  Killed $svc PID $PID"
		fi
		rm -f "$pidfile"
	fi
done

# # # Fallback: pkill by process name
pkill -f "bin/user-service" 2>/dev/null || true
pkill -f "bin/task-service" 2>/dev/null || true
pkill -f "bin/notification-service" 2>/dev/null || true
pkill -f "bin/gateway" 2>/dev/null || true

# # # Stop Docker compose services if running
if command -v docker > /dev/null 2>&1 && [ -f docker-compose.yml ]; then
	echo "Stopping Docker Compose services..."
	docker compose down --remove-orphans || docker-compose down --remove-orphans || true
fi

# # # Remove any temporary containers we may have created
docker rm -f tmp-postgres 2>/dev/null || true

sleep 1

echo "Verifying no matching processes or containers are running..."
ps aux | egrep 'bin/user-service|bin/task-service|bin/notification-service|bin/gateway|next dev|npm run dev' | egrep -v 'egrep' || true
if command -v docker > /dev/null 2>&1; then
	docker ps --filter "name=api-gateway" --filter "name=user-service" --filter "name=task-service" --filter "name=notification-service" --format "{{.Names}}: {{.Status}}" || true
fi

echo ""
echo -e "${GREEN}All services stopped.${NC}"
echo ""

