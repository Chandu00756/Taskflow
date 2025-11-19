#!/bin/bash

# # # Script to generate Go code from Protocol Buffer definitions

set -e

# # # Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Generating gRPC code from Protocol Buffers...${NC}"

# # # Check if protoc is installed
if ! command -v protoc &> /dev/null; then
    echo -e "${RED}Error: protoc is not installed${NC}"
    echo "Install it with: brew install protobuf"
    exit 1
fi

# # # Check if Go plugins are installed
if ! command -v protoc-gen-go &> /dev/null; then
    echo -e "${YELLOW}Installing protoc-gen-go...${NC}"
    go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
fi

if ! command -v protoc-gen-go-grpc &> /dev/null; then
    echo -e "${YELLOW}Installing protoc-gen-go-grpc...${NC}"
    go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
fi

if ! command -v protoc-gen-grpc-gateway &> /dev/null; then
    echo -e "${YELLOW}Installing protoc-gen-grpc-gateway...${NC}"
    go install github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-grpc-gateway@latest
fi

if ! command -v protoc-gen-openapiv2 &> /dev/null; then
    echo -e "${YELLOW}Installing protoc-gen-openapiv2...${NC}"
    go install github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-openapiv2@latest
fi

# # # Create output directories
mkdir -p proto/user proto/task proto/notification proto/organization

# # # Generate user service
echo -e "${GREEN}Generating UserService...${NC}"
protoc -I proto \
    -I third_party/googleapis \
    --go_out=. --go_opt=module=github.com/chanduchitikam/task-management-system \
    --go-grpc_out=. --go-grpc_opt=module=github.com/chanduchitikam/task-management-system \
    --grpc-gateway_out=. --grpc-gateway_opt=module=github.com/chanduchitikam/task-management-system \
    --openapiv2_out=proto --openapiv2_opt=logtostderr=true \
    proto/user.proto

# # # Generate task service
echo -e "${GREEN}Generating TaskService...${NC}"
protoc -I proto \
    -I third_party/googleapis \
    --go_out=. --go_opt=module=github.com/chanduchitikam/task-management-system \
    --go-grpc_out=. --go-grpc_opt=module=github.com/chanduchitikam/task-management-system \
    --grpc-gateway_out=. --grpc-gateway_opt=module=github.com/chanduchitikam/task-management-system \
    --openapiv2_out=proto --openapiv2_opt=logtostderr=true \
    proto/task.proto

# # # Generate notification service
echo -e "${GREEN}Generating NotificationService...${NC}"
protoc -I proto \
    -I third_party/googleapis \
    --go_out=. --go_opt=module=github.com/chanduchitikam/task-management-system \
    --go-grpc_out=. --go-grpc_opt=module=github.com/chanduchitikam/task-management-system \
    --grpc-gateway_out=. --grpc-gateway_opt=module=github.com/chanduchitikam/task-management-system \
    --openapiv2_out=proto --openapiv2_opt=logtostderr=true \
    proto/notification.proto

# # # Generate organization service
echo -e "${GREEN}Generating OrganizationService...${NC}"
protoc -I proto \
    -I third_party/googleapis \
    --go_out=. --go_opt=module=github.com/chanduchitikam/task-management-system \
    --go-grpc_out=. --go-grpc_opt=module=github.com/chanduchitikam/task-management-system \
    --grpc-gateway_out=. --grpc-gateway_opt=module=github.com/chanduchitikam/task-management-system \
    --openapiv2_out=proto --openapiv2_opt=logtostderr=true \
    proto/organization.proto

# # # Merge all swagger files into one
echo -e "${GREEN}Merging Swagger files...${NC}"
node -e "
const fs = require('fs');
const path = require('path');

const files = [
  'proto/user.swagger.json',
  'proto/task.swagger.json',
  'proto/notification.swagger.json',
  'proto/organization.swagger.json'
];

const merged = {
  swagger: '2.0',
  info: {
    title: 'Task Management System API',
    version: '1.0.0',
    description: 'Complete API documentation for Task Management System including User, Task, Notification, and Organization services'
  },
  tags: [],
  consumes: ['application/json'],
  produces: ['application/json'],
  paths: {},
  definitions: {},
  securityDefinitions: {
    Bearer: {
      type: 'apiKey',
      name: 'Authorization',
      in: 'header',
      description: 'Enter your bearer token in the format: Bearer {token}'
    }
  }
};

files.forEach(file => {
  if (fs.existsSync(file)) {
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (content.tags) merged.tags.push(...content.tags);
    if (content.paths) Object.assign(merged.paths, content.paths);
    if (content.definitions) Object.assign(merged.definitions, content.definitions);
  }
});

fs.writeFileSync('proto/api.swagger.json', JSON.stringify(merged, null, 2));
console.log('✓ Merged swagger file created: proto/api.swagger.json');
"

echo -e "${GREEN}✓ Protocol Buffer generation complete!${NC}"
