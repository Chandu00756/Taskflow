#!/bin/bash

# Run all tests

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Running tests for Task Management System...${NC}"

echo -e "${YELLOW}Running unit tests...${NC}"
go test -v -race -coverprofile=coverage.out ./...

echo -e "${YELLOW}Generating coverage report...${NC}"
go tool cover -html=coverage.out -o coverage.html

echo -e "${GREEN}✓ Tests complete!${NC}"
echo -e "Coverage report: ${YELLOW}file://$PWD/coverage.html${NC}"
