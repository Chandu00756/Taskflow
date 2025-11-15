#!/bin/bash

# Makefile-style script for common operations

case "$1" in
  proto)
    echo "Generating Protocol Buffers..."
    ./scripts/generate-proto.sh
    ;;
  build)
    echo "Building services..."
    ./scripts/build.sh
    ;;
  test)
    echo "Running tests..."
    ./scripts/test.sh
    ;;
  load-test)
    echo "Running load tests..."
    ./scripts/load-test.sh
    ;;
  docker-build)
    echo "Building Docker images..."
    docker build -t task-management/user-service:latest -f deployments/docker/Dockerfile.user .
    docker build -t task-management/task-service:latest -f deployments/docker/Dockerfile.task .
    docker build -t task-management/notification-service:latest -f deployments/docker/Dockerfile.notification .
    docker build -t task-management/gateway:latest -f deployments/docker/Dockerfile.gateway .
    ;;
  docker-up)
    echo "Starting services with Docker Compose..."
    docker-compose up -d
    ;;
  docker-down)
    echo "Stopping services..."
    docker-compose down
    ;;
  k8s-deploy)
    echo "Deploying to Kubernetes..."
    kubectl apply -f deployments/k8s/
    ;;
  k8s-delete)
    echo "Deleting from Kubernetes..."
    kubectl delete -f deployments/k8s/
    ;;
  clean)
    echo "Cleaning up..."
    rm -rf bin/
    rm -f coverage.out coverage.html
    rm -rf test-results/
    find . -name "*.pb.go" -delete
    ;;
  *)
    echo "Usage: $0 {proto|build|test|load-test|docker-build|docker-up|docker-down|k8s-deploy|k8s-delete|clean}"
    exit 1
    ;;
esac
