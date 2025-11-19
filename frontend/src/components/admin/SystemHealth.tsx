// System Health Monitor - Real-time platform monitoring
// Displays service status, performance metrics, and system alerts

'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Activity, Server, Database, Wifi, AlertCircle, CheckCircle2,
  Clock, Cpu, HardDrive, MemoryStick
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ServiceStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  latency_ms: number;
  uptime_percent: number;
  last_check: string;
}

interface SystemMetrics {
  cpu_usage: number;
  memory_usage: number;
  disk_usage: number;
  active_connections: number;
}

/**
 * Main system health dashboard component
 * Shows all services, their health status, and key performance metrics
 */
export function SystemHealthMonitor() {
  // Fetch service statuses from backend
  // TODO: Connect to real health check endpoint
  const { data: services, isLoading } = useQuery({
    queryKey: ['system-health'],
    queryFn: async () => {
      // For now, return empty array until backend health endpoint is implemented
      // Backend should provide: GET /api/v1/admin/system/health
      return [] as ServiceStatus[];
    },
    refetchInterval: 30000, // Refresh every 30 seconds for real-time monitoring
  });

  // Fetch system performance metrics
  // TODO: Connect to real metrics endpoint  
  const { data: metrics } = useQuery<SystemMetrics | null>({
    queryKey: ['system-metrics'],
    queryFn: async () => {
      // For now, return null until backend metrics endpoint is implemented
      // Backend should provide: GET /api/v1/admin/system/metrics
      return null;
    },
    refetchInterval: 5000, // Refresh every 5 seconds for near real-time data
  });

  return (
    <div className="space-y-6">
      {/* System-wide metrics overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          title="CPU Usage"
          value={`${metrics?.cpu_usage || 0}%`}
          icon={Cpu}
          color="blue"
          status={getMetricStatus(metrics?.cpu_usage || 0, 80, 90)}
        />
        <MetricCard
          title="Memory Usage"
          value={`${metrics?.memory_usage || 0}%`}
          icon={MemoryStick}
          color="purple"
          status={getMetricStatus(metrics?.memory_usage || 0, 80, 90)}
        />
        <MetricCard
          title="Disk Usage"
          value={`${metrics?.disk_usage || 0}%`}
          icon={HardDrive}
          color="emerald"
          status={getMetricStatus(metrics?.disk_usage || 0, 70, 85)}
        />
        <MetricCard
          title="Active Connections"
          value={metrics?.active_connections || 0}
          icon={Wifi}
          color="orange"
          status="healthy"
        />
      </div>

      {/* Individual service health status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5 text-blue-500" />
            Service Status
          </CardTitle>
          <CardDescription>
            Real-time health monitoring for all platform services
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-500" />
            </div>
          ) : !services || services.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="rounded-full bg-slate-100 p-4">
                <Server className="h-8 w-8 text-slate-400" />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-600">No service health data available</p>
              <p className="mt-1 text-xs text-slate-400">Connect backend health monitoring endpoint</p>
            </div>
          ) : (
            <div className="space-y-4">
              {services.map((service) => (
                <ServiceStatusRow key={service.name} service={service} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Metric card for displaying system performance metrics
 */
function MetricCard({ 
  title, 
  value, 
  icon: Icon, 
  color,
  status 
}: {
  title: string;
  value: string | number;
  icon: any;
  color: string;
  status: 'healthy' | 'degraded' | 'down';
}) {
  const colorClasses = {
    blue: 'from-blue-500 to-cyan-500',
    purple: 'from-purple-500 to-pink-500',
    emerald: 'from-emerald-500 to-teal-500',
    orange: 'from-orange-500 to-red-500',
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">{title}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
            <StatusBadge status={status} className="mt-2" />
          </div>
          <div className={cn(
            'rounded-xl bg-gradient-to-br p-3 text-white shadow-lg',
            colorClasses[color as keyof typeof colorClasses]
          )}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Individual service status row with health indicator and metrics
 */
function ServiceStatusRow({ service }: { service: ServiceStatus }) {
  const statusConfig = {
    healthy: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50', label: 'Healthy' },
    degraded: { icon: AlertCircle, color: 'text-orange-500', bg: 'bg-orange-50', label: 'Degraded' },
    down: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-50', label: 'Down' },
  };

  const config = statusConfig[service.status];
  const StatusIcon = config.icon;

  return (
    <div className="flex items-center justify-between rounded-lg border p-4 hover:bg-slate-50 transition">
      <div className="flex items-center gap-4">
        <div className={cn('rounded-full p-2', config.bg)}>
          <StatusIcon className={cn('h-5 w-5', config.color)} />
        </div>
        <div>
          <p className="font-medium text-slate-900">{service.name}</p>
          <p className="text-sm text-slate-500">
            Uptime: {service.uptime_percent.toFixed(2)}% • Latency: {service.latency_ms}ms
          </p>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="text-right text-sm">
          <p className="text-slate-500">Last Check</p>
          <p className="font-medium text-slate-700">{formatLastCheck(service.last_check)}</p>
        </div>
        <StatusBadge status={service.status} />
      </div>
    </div>
  );
}

/**
 * Status badge component with consistent styling
 */
function StatusBadge({ status, className }: { status: 'healthy' | 'degraded' | 'down'; className?: string }) {
  const variants = {
    healthy: { label: 'Healthy', className: 'bg-emerald-100 text-emerald-700' },
    degraded: { label: 'Degraded', className: 'bg-orange-100 text-orange-700' },
    down: { label: 'Down', className: 'bg-red-100 text-red-700' },
  };

  const variant = variants[status];

  return (
    <Badge className={cn(variant.className, className)}>
      {variant.label}
    </Badge>
  );
}

/**
 * Determine metric health status based on thresholds
 * @param value - Current metric value
 * @param warningThreshold - Value at which to show warning (degraded)
 * @param criticalThreshold - Value at which to show critical (down)
 */
function getMetricStatus(value: number, warningThreshold: number, criticalThreshold: number): 'healthy' | 'degraded' | 'down' {
  if (value >= criticalThreshold) return 'down';
  if (value >= warningThreshold) return 'degraded';
  return 'healthy';
}

/**
 * Format last check timestamp as relative time
 */
function formatLastCheck(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

// Mock data generators - Replace these with real API calls

function mockServiceStatus(): ServiceStatus[] {
  return [
    {
      name: 'API Gateway',
      status: 'healthy',
      latency_ms: 45,
      uptime_percent: 99.98,
      last_check: new Date(Date.now() - 12000).toISOString(),
    },
    {
      name: 'User Service (gRPC)',
      status: 'healthy',
      latency_ms: 23,
      uptime_percent: 99.95,
      last_check: new Date(Date.now() - 8000).toISOString(),
    },
    {
      name: 'Task Service (gRPC)',
      status: 'healthy',
      latency_ms: 31,
      uptime_percent: 99.92,
      last_check: new Date(Date.now() - 15000).toISOString(),
    },
    {
      name: 'Notification Service (gRPC)',
      status: 'degraded',
      latency_ms: 234,
      uptime_percent: 98.87,
      last_check: new Date(Date.now() - 5000).toISOString(),
    },
    {
      name: 'PostgreSQL Database',
      status: 'healthy',
      latency_ms: 12,
      uptime_percent: 99.99,
      last_check: new Date(Date.now() - 10000).toISOString(),
    },
    {
      name: 'Redis Cache',
      status: 'healthy',
      latency_ms: 5,
      uptime_percent: 99.97,
      last_check: new Date(Date.now() - 7000).toISOString(),
    },
  ];
}

function mockSystemMetrics(): SystemMetrics {
  return {
    cpu_usage: Math.floor(Math.random() * 30) + 40,  // 40-70%
    memory_usage: Math.floor(Math.random() * 25) + 55, // 55-80%
    disk_usage: Math.floor(Math.random() * 20) + 45,   // 45-65%
    active_connections: Math.floor(Math.random() * 500) + 300, // 300-800
  };
}
