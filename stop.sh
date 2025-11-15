#!/bin/bash

echo " Stopping Task Management System..."
echo ""

# Stop frontend
echo " Stopping Frontend..."
pkill -f "next dev" 2>/dev/null || echo "   Frontend was not running"

# Stop backend services
echo " Stopping Backend Services..."
docker-compose down

echo ""
echo " All services stopped!"
echo ""

