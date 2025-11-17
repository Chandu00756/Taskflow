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
mkdir -p proto/user proto/task proto/notification

# # # Generate user service
echo -e "${GREEN}Generating UserService...${NC}"
protoc -I proto \
    -I third_party/googleapis \
    --go_out=. --go_opt=module=github.com/chanduchitikam/task-management-system \
    --go-grpc_out=. --go-grpc_opt=module=github.com/chanduchitikam/task-management-system \
    --grpc-gateway_out=. --grpc-gateway_opt=module=github.com/chanduchitikam/task-management-system \
    --openapiv2_out=proto --openapiv2_opt=allow_merge=true,merge_file_name=api \
    proto/user.proto

# # # Generate task service
echo -e "${GREEN}Generating TaskService...${NC}"
protoc -I proto \
    -I third_party/googleapis \
    --go_out=. --go_opt=module=github.com/chanduchitikam/task-management-system \
    --go-grpc_out=. --go-grpc_opt=module=github.com/chanduchitikam/task-management-system \
    --grpc-gateway_out=. --grpc-gateway_opt=module=github.com/chanduchitikam/task-management-system \
    --openapiv2_out=proto --openapiv2_opt=allow_merge=true,merge_file_name=api \
    proto/task.proto

# # # Generate notification service
echo -e "${GREEN}Generating NotificationService...${NC}"
protoc -I proto \
    -I third_party/googleapis \
    --go_out=. --go_opt=module=github.com/chanduchitikam/task-management-system \
    --go-grpc_out=. --go-grpc_opt=module=github.com/chanduchitikam/task-management-system \
    --grpc-gateway_out=. --grpc-gateway_opt=module=github.com/chanduchitikam/task-management-system \
    --openapiv2_out=proto --openapiv2_opt=allow_merge=true,merge_file_name=api \
    proto/notification.proto

echo -e "${GREEN}✓ Protocol Buffer generation complete!${NC}"
