#!/bin/bash

# # # Build script for all services

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Building Task Management System...${NC}"

# # # Generate proto files first
echo -e "${YELLOW}Generating Protocol Buffers...${NC}"
./scripts/generate-proto.sh

# # # Build services
echo -e "${YELLOW}Building UserService...${NC}"
go build -o bin/user-service ./services/user

echo -e "${YELLOW}Building TaskService...${NC}"
go build -o bin/task-service ./services/task

echo -e "${YELLOW}Building NotificationService...${NC}"
go build -o bin/notification-service ./services/notification

echo -e "${YELLOW}Building API Gateway...${NC}"
go build -o bin/gateway ./gateway

echo -e "${GREEN}✓ Build complete!${NC}"
echo -e "Binaries created in ${YELLOW}./bin/${NC}"
