#!/bin/bash

# # # Load testing script using Vegeta

set -e

# # # Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}Starting load test for Task Management System${NC}"

# # # Check if vegeta is installed
if ! command -v vegeta &> /dev/null; then
    echo -e "${YELLOW}Vegeta not found. Installing...${NC}"
    go install github.com/tsenart/vegeta@latest
fi

# # # Configuration
BASE_URL=${BASE_URL:-"http://localhost:8080"}
DURATION=${DURATION:-"30s"}
RATE=${RATE:-"100"}
OUTPUT_DIR="./test-results"

mkdir -p $OUTPUT_DIR

echo -e "${GREEN}Testing registration endpoint...${NC}"
echo "POST $BASE_URL/api/v1/auth/register" | vegeta attack \
    -duration=$DURATION \
    -rate=$RATE \
    -body=<(cat <<EOF
{
  "email": "loadtest@example.com",
  "username": "loadtest",
  "password": "password123",
  "full_name": "Load Test User"
}
EOF
) \
    -header="Content-Type: application/json" \
    | tee $OUTPUT_DIR/register-results.bin \
    | vegeta report -type=text

echo -e "${GREEN}Testing login endpoint...${NC}"
echo "POST $BASE_URL/api/v1/auth/login" | vegeta attack \
    -duration=$DURATION \
    -rate=$RATE \
    -body=<(cat <<EOF
{
  "email": "test@example.com",
  "password": "password123"
}
EOF
) \
    -header="Content-Type: application/json" \
    | tee $OUTPUT_DIR/login-results.bin \
    | vegeta report -type=text

echo -e "${GREEN}Generating HTML reports...${NC}"
vegeta report -type=html $OUTPUT_DIR/register-results.bin > $OUTPUT_DIR/register-report.html
vegeta report -type=html $OUTPUT_DIR/login-results.bin > $OUTPUT_DIR/login-report.html

echo -e "${GREEN}Load testing complete!${NC}"
echo -e "Results saved in ${YELLOW}$OUTPUT_DIR${NC}"
echo -e "Open HTML reports:"
echo -e "  - file://$PWD/$OUTPUT_DIR/register-report.html"
echo -e "  - file://$PWD/$OUTPUT_DIR/login-report.html"
