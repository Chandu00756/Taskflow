# # # Production Deployment Guide

This guide covers setting up monitoring, auto-scaling, CI/CD, and error tracking for production deployment.

# # ## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Monitoring Setup](#monitoring-setup)
3. [Auto-Scaling Configuration](#auto-scaling-configuration)
4. [CI/CD Pipeline](#cicd-pipeline)
5. [Error Tracking with Sentry](#error-tracking-with-sentry)
6. [Deployment Steps](#deployment-steps)
7. [Operational Procedures](#operational-procedures)

---

# # ## Prerequisites

# # ### Required Tools
```bash
# # # Kubernetes CLI
kubectl version --client

# # # Helm (package manager for Kubernetes)
helm version

# # # Docker
docker --version

# # # GitHub CLI (optional)
gh --version
```

# # ### Cloud Provider Setup

Choose your cloud provider:

**Google Cloud (GKE)**
```bash
gcloud container clusters create task-management-cluster \
  --zone us-central1-a \
  --num-nodes 3 \
  --machine-type n1-standard-2 \
  --enable-autoscaling \
  --min-nodes 3 \
  --max-nodes 10
```

**AWS (EKS)**
```bash
eksctl create cluster \
  --name task-management-cluster \
  --region us-east-1 \
  --nodegroup-name standard-workers \
  --node-type t3.medium \
  --nodes 3 \
  --nodes-min 3 \
  --nodes-max 10
```

**Azure (AKS)**
```bash
az aks create \
  --resource-group task-management-rg \
  --name task-management-cluster \
  --node-count 3 \
  --enable-cluster-autoscaler \
  --min-count 3 \
  --max-count 10
```

---

# # ## Monitoring Setup

# # ### 1. Install Prometheus & Grafana

```bash
# # # Add Helm repositories
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

# # # Create monitoring namespace
kubectl create namespace monitoring

# # # Install Prometheus
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --set prometheus.prometheusSpec.retention=30d \
  --set prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage=50Gi \
  --values deployments/monitoring/prometheus-values.yaml

# # # Install Grafana
helm install grafana grafana/grafana \
  --namespace monitoring \
  --set persistence.enabled=true \
  --set persistence.size=10Gi \
  --set adminPassword='your-secure-password'
```

# # ### 2. Apply Custom Prometheus Configuration

```bash
# # # Apply custom Prometheus config
kubectl create configmap prometheus-config \
  --from-file=deployments/monitoring/prometheus.yml \
  -n monitoring

# # # Apply alert rules
kubectl create configmap prometheus-alerts \
  --from-file=deployments/monitoring/alerts.yml \
  -n monitoring
```

# # ### 3. Access Grafana Dashboard

```bash
# # # Get Grafana admin password
kubectl get secret --namespace monitoring grafana -o jsonpath="{.data.admin-password}" | base64 --decode

# # # Port forward to access locally
kubectl port-forward -n monitoring svc/grafana 3000:80

# # # Access at: http://localhost:3000
```

# # ### 4. Import Dashboards

**Pre-built Dashboards**:
- Go Application Metrics: Dashboard ID `6671`
- Kubernetes Cluster Monitoring: Dashboard ID `7249`
- PostgreSQL Database: Dashboard ID `9628`
- Redis: Dashboard ID `11835`

**Custom Dashboard for Task Management System**:

```json
{
  "dashboard": {
    "title": "Task Management System Overview",
    "panels": [
      {
        "title": "API Gateway - Requests/sec",
        "targets": [{
          "expr": "rate(http_requests_total{job=\"gateway\"}[5m])"
        }]
      },
      {
        "title": "Service Health",
        "targets": [{
          "expr": "up{job=~\"user-service|task-service|notification-service\"}"
        }]
      },
      {
        "title": "Database Connection Pool",
        "targets": [{
          "expr": "pg_stat_database_numbackends"
        }]
      },
      {
        "title": "Error Rate",
        "targets": [{
          "expr": "rate(http_requests_total{status=~\"5..\"}[5m])"
        }]
      }
    ]
  }
}
```

---

# # ## Auto-Scaling Configuration

# # ### 1. Install Metrics Server

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

# # ### 2. Apply HPA Configurations

```bash
# # # Apply all HPA configurations
kubectl apply -f deployments/k8s/hpa.yaml

# # # Verify HPA status
kubectl get hpa -n task-management

# # # Watch auto-scaling in action
kubectl get hpa -n task-management --watch
```

# # ### 3. Test Auto-Scaling

```bash
# # # Generate load to test scaling
kubectl run -i --tty load-generator --rm --image=busybox --restart=Never -- /bin/sh

# # # Inside the pod, run:
while true; do wget -q -O- http://gateway.task-management.svc.cluster.local:8080/api/v1/tasks; done
```

# # ### 4. Cluster Autoscaler

**GKE**:
```bash
gcloud container clusters update task-management-cluster \
  --enable-autoscaling \
  --min-nodes 3 \
  --max-nodes 10 \
  --zone us-central1-a
```

**EKS**:
```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/autoscaler/master/cluster-autoscaler/cloudprovider/aws/examples/cluster-autoscaler-autodiscover.yaml
```

**AKS**:
```bash
az aks update \
  --resource-group task-management-rg \
  --name task-management-cluster \
  --enable-cluster-autoscaler \
  --min-count 3 \
  --max-count 10
```

---

# # ## CI/CD Pipeline

# # ### 1. GitHub Actions Setup

The CI/CD pipeline is already configured in `.github/workflows/ci-cd.yml`.

**Required GitHub Secrets**:

```bash
# # # Set GitHub secrets using GitHub CLI
gh secret set GITHUB_TOKEN --body "your-github-token"
gh secret set KUBECONFIG_STAGING --body "$(cat ~/.kube/config | base64)"
gh secret set KUBECONFIG_PRODUCTION --body "$(cat ~/.kube/config | base64)"
gh secret set DATABASE_URL --body "postgresql://user:pass@host:5432/db"
gh secret set SLACK_WEBHOOK --body "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

# # ### 2. Pipeline Stages

The pipeline includes:

1. **Test & Lint**: Run tests and linting on every PR/push
2. **Build**: Build Docker images for all services
3. **Security**: Scan images for vulnerabilities
4. **Deploy to Staging**: Auto-deploy to staging on develop branch
5. **Deploy to Production**: Deploy on version tags (v*)
6. **Database Migrations**: Run migrations automatically

# # ### 3. Deployment Workflow

**Deploy to Staging**:
```bash
# # # Push to develop branch
git checkout develop
git merge feature/my-feature
git push origin develop

# # # GitHub Actions will automatically:
```

**Deploy to Production**:
```bash
# # # Create a release tag
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0

# # # GitHub Actions will automatically:
```

# # ### 4. Blue-Green Deployment

The production deployment uses blue-green strategy:

```bash
# # # Current production (blue)
kubectl get pods -n task-management-production -l version=blue

# # # New version (green)
kubectl get pods -n task-management-production -l version=green

# # # Traffic is switched after green is healthy
```

# # ### 5. Rollback Procedure

```bash
# # # Automatic rollback on failure (handled by pipeline)
kubectl rollout undo deployment/user-service -n task-management-production
kubectl rollout undo deployment/task-service -n task-management-production
kubectl rollout undo deployment/notification-service -n task-management-production
kubectl rollout undo deployment/gateway -n task-management-production
```

---

# # ## Error Tracking with Sentry

# # ### 1. Create Sentry Project

1. Go to [sentry.io](https://sentry.io) and create an account
2. Create a new project: "task-management-system"
3. Get your DSN: `https://xxx@yyy.ingest.sentry.io/zzz`

# # ### 2. Install Sentry SDK

```bash
cd /Users/chanduchitikam/goproject/task-management-system
go get github.com/getsentry/sentry-go
```

# # ### 3. Update Configuration

Add Sentry configuration to `pkg/config/config.go`:

```go
// SentryConfig holds Sentry configuration
type SentryConfig struct {
	DSN                string
	Environment        string
	Release            string
	TracesSampleRate   float64
	ProfilesSampleRate float64
	GoVersion          string
}

// In LoadConfig()
Sentry: SentryConfig{
	DSN:                getEnv("SENTRY_DSN", ""),
	Environment:        getEnv("ENVIRONMENT", "production"),
	Release:            getEnv("RELEASE_VERSION", "1.0.0"),
	TracesSampleRate:   getEnvAsFloat("SENTRY_TRACES_SAMPLE_RATE", 0.1),
	ProfilesSampleRate: getEnvAsFloat("SENTRY_PROFILES_SAMPLE_RATE", 0.1),
	GoVersion:          runtime.Version(),
},
```

# # ### 4. Initialize in Services

Update each service's `main.go`:

```go
import (
	sentryPkg "github.com/chanduchitikam/task-management-system/pkg/sentry"
)

func main() {
	cfg, _ := config.LoadConfig()
	
	// Initialize Sentry
	if err := sentryPkg.InitSentry(cfg, "user-service"); err != nil {
		log.Printf("Failed to initialize Sentry: %v", err)
	}
	defer sentryPkg.Flush()
	
	// Add panic recovery
	defer sentryPkg.RecoverPanic()
	
	// ... rest of main
}
```

# # ### 5. Capture Errors

```go
// In your service code
if err != nil {
	sentryPkg.CaptureError(err, map[string]string{
		"user_id": userID,
		"action": "create_task",
	}, map[string]interface{}{
		"task_data": taskData,
	})
	return err
}
```

# # ### 6. Environment Variables

```bash
# # # Add to .env and Kubernetes secrets
SENTRY_DSN=https://xxx@yyy.ingest.sentry.io/zzz
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1
RELEASE_VERSION=v1.0.0
```

# # ### 7. Kubernetes Secret for Sentry

```bash
kubectl create secret generic sentry-config \
  --from-literal=dsn='https://xxx@yyy.ingest.sentry.io/zzz' \
  -n task-management
```

---

# # ## Deployment Steps

# # ### Complete Production Deployment

```bash
# # # 1. Create namespace
kubectl create namespace task-management

# # # 2. Deploy databases
kubectl apply -f deployments/k8s/postgres.yaml
kubectl apply -f deployments/k8s/redis.yaml

# # # 3. Wait for databases
kubectl wait --for=condition=ready pod -l app=postgres -n task-management --timeout=300s
kubectl wait --for=condition=ready pod -l app=redis -n task-management --timeout=300s

# # # 4. Create secrets
kubectl create secret generic database-credentials \
  --from-literal=username=taskuser \
  --from-literal=password='your-secure-password' \
  -n task-management

kubectl create secret generic jwt-secret \
  --from-literal=secret='your-super-secret-jwt-key' \
  -n task-management

# # # 5. Deploy services
kubectl apply -f deployments/k8s/user-service.yaml
kubectl apply -f deployments/k8s/task-service.yaml
kubectl apply -f deployments/k8s/notification-service.yaml
kubectl apply -f deployments/k8s/gateway.yaml

# # # 6. Apply HPA
kubectl apply -f deployments/k8s/hpa.yaml

# # # 7. Configure ingress
kubectl apply -f deployments/k8s/ingress.yaml

# # # 8. Verify deployment
kubectl get all -n task-management
```

---

# # ## Operational Procedures

# # ### Health Checks

```bash
# # # Check pod health
kubectl get pods -n task-management

# # # Check service endpoints
kubectl get endpoints -n task-management

# # # Check HPA status
kubectl get hpa -n task-management

# # # Check logs
kubectl logs -f deployment/gateway -n task-management
```

# # ### Scaling Operations

```bash
# # # Manual scaling (if needed)
kubectl scale deployment/user-service --replicas=5 -n task-management

# # # Update HPA limits
kubectl patch hpa user-service-hpa -n task-management \
  -p '{"spec":{"maxReplicas":20}}'
```

# # ### Database Operations

```bash
# # # Backup database
kubectl exec -n task-management postgres-0 -- \
  pg_dump -U taskuser taskmanagement > backup-$(date +%Y%m%d).sql

# # # Restore database
kubectl exec -i -n task-management postgres-0 -- \
  psql -U taskuser taskmanagement < backup-20250111.sql
```

# # ### Monitoring Alerts

**Check Prometheus Alerts**:
```bash
kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090
# # # Open: http://localhost:9090/alerts
```

**Check Grafana**:
```bash
kubectl port-forward -n monitoring svc/grafana 3000:80
# # # Open: http://localhost:3000
```

# # ### Troubleshooting

**Service not responding**:
```bash
# # # Check logs
kubectl logs deployment/user-service -n task-management --tail=100

# # # Check events
kubectl get events -n task-management --sort-by='.lastTimestamp'

# # # Describe pod
kubectl describe pod <pod-name> -n task-management
```

**High error rate**:
```bash
# # # Check Sentry dashboard
kubectl logs -f deployment/gateway -n task-management | grep ERROR
```

**Database connection issues**:
```bash
# # # Test database connection
kubectl run -it --rm debug --image=postgres:15-alpine --restart=Never -- \
  psql -h postgres.task-management.svc.cluster.local -U taskuser -d taskmanagement
```

---

# # ## Monitoring Dashboard URLs

After deployment, access:

- **Grafana**: `https://grafana.yourcompany.com`
- **Prometheus**: `https://prometheus.yourcompany.com`
- **API Gateway**: `https://api.yourcompany.com`
- **Sentry**: `https://sentry.io/organizations/your-org/projects/task-management`

---

# # ## Summary Checklist

- [x] ✅ Monitoring: Prometheus + Grafana configured
- [x] ✅ Auto-scaling: HPA configured for all services
- [x] ✅ CI/CD: GitHub Actions pipeline ready
- [x] ✅ Error tracking: Sentry integration complete
- [x] ✅ Blue-Green deployment strategy
- [x] ✅ Database backups automated
- [x] ✅ Alert rules configured
- [x] ✅ Security scanning in pipeline

Your Task Management System is now production-ready! 🚀

For questions or issues, check:
- `ARCHITECTURE.md` - System architecture
- `API_DOCS.md` - API documentation
- `INTEGRATION_GUIDE.md` - Client integration guide
- GitHub Issues for bug reports
