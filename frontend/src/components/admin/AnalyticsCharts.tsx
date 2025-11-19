// Advanced Analytics Charts for Super Admin Dashboard
// These charts provide real-time insights into platform health and user activity

'use client';

import { useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Users, Building2, CheckCircle2, Clock, BarChart as BarChartIcon } from 'lucide-react';

// Color palette for charts - using TaskFlow brand colors
const COLORS = {
  primary: '#8b5cf6',    // Purple - primary brand color
  secondary: '#ec4899',  // Pink - secondary accent
  success: '#10b981',    // Green - completed/active states
  warning: '#f59e0b',    // Orange - pending/warning states
  danger: '#ef4444',     // Red - errors/critical states
  info: '#3b82f6',       // Blue - informational
  neutral: '#64748b',    // Gray - neutral/inactive
};

const CHART_COLORS = [
  COLORS.primary,
  COLORS.secondary,
  COLORS.info,
  COLORS.success,
  COLORS.warning,
  COLORS.danger,
];

interface UserGrowthData {
  date: string;
  users: number;
  organizations: number;
}

interface TaskStatusData {
  status: string;
  count: number;
  color: string;
}

interface OrganizationActivity {
  org_name: string;
  active_users: number;
  tasks_completed: number;
  tasks_pending: number;
}

interface AnalyticsChartsProps {
  userGrowth?: UserGrowthData[];
  taskDistribution?: TaskStatusData[];
  org_activity?: OrganizationActivity[];
  loading?: boolean;
}

/**
 * Empty state for charts when no data is available
 */
function ChartEmpty({ title, message }: { title: string; message: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex h-[300px] items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="rounded-full bg-slate-100 p-4">
              <BarChartIcon className="h-8 w-8 text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-600">{message}</p>
            <p className="text-xs text-slate-400">Data will appear once available</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Skeleton loader for charts while data is loading
 */
function ChartSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex h-[300px] items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-500" />
            <p className="text-sm text-slate-500">Loading chart data...</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * User Growth Chart - Shows platform growth over time
 * Tracks both user registrations and organization creations
 */
export function UserGrowthChart({ data, loading }: { data?: UserGrowthData[]; loading?: boolean }) {
  // Use real data from parent component, fallback to empty array (not mock data)
  const chartData = data && data.length > 0 ? data : [];
  
  if (loading) {
    return <ChartSkeleton title="User Growth" />;
  }

  if (chartData.length === 0) {
    return <ChartEmpty title="Platform Growth" message="No growth data available yet" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-purple-500" />
          Platform Growth
        </CardTitle>
        <CardDescription>
          User and organization registrations over the last 30 days
        </CardDescription>
        </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3}/>
                <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorOrgs" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS.secondary} stopOpacity={0.3}/>
                <stop offset="95%" stopColor={COLORS.secondary} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis 
              dataKey="date" 
              stroke="#64748b"
              fontSize={12}
              tickMargin={8}
            />
            <YAxis 
              stroke="#64748b"
              fontSize={12}
              tickMargin={8}
            />
            <Tooltip 
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              }}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="users"
              stroke={COLORS.primary}
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorUsers)"
              name="New Users"
            />
            <Area
              type="monotone"
              dataKey="organizations"
              stroke={COLORS.secondary}
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorOrgs)"
              name="New Organizations"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

/**
 * Task Distribution Chart - Pie chart showing task status breakdown
 * Helps identify bottlenecks (too many pending/blocked tasks)
 */
export function TaskDistributionChart({ data, loading }: { data?: TaskStatusData[]; loading?: boolean }) {
  // Use real data from parent, fallback to empty array
  const chartData = data && data.length > 0 ? data : [];
  
  // Calculate total for percentage display
  const total = chartData.reduce((sum, item) => sum + item.count, 0);

  if (loading) {
    return <ChartSkeleton title="Task Distribution" />;
  }

  if (chartData.length === 0) {
    return <ChartEmpty title="Task Status Distribution" message="No task data available yet" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          Task Status Distribution
        </CardTitle>
        <CardDescription>
          Breakdown of all tasks across the platform by status
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <ResponsiveContainer width="60%" height={250}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey="count"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color || CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          
          {/* Legend with percentages */}
          <div className="flex flex-col gap-3">
            {chartData.map((item, index) => {
              const percentage = total > 0 ? ((item.count / total) * 100).toFixed(1) : '0';
              return (
                <div key={index} className="flex items-center gap-2">
                  <div 
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: item.color || CHART_COLORS[index % CHART_COLORS.length] }}
                  />
                  <div className="text-sm">
                    <span className="font-medium">{item.status}</span>
                    <span className="ml-2 text-slate-500">
                      {item.count} ({percentage}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Organization Activity Chart - Bar chart comparing org performance
 * Shows which organizations are most active on the platform
 */
export function OrganizationActivityChart({ data, loading }: { data?: OrganizationActivity[]; loading?: boolean }) {
  // Use real data from parent
  const chartData = data && data.length > 0 ? data : [];
  
  if (loading) {
    return <ChartSkeleton title="Organization Activity" />;
  }

  if (chartData.length === 0) {
    return <ChartEmpty title="Organization Activity" message="No organization activity data yet" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-blue-500" />
          Organization Activity
        </CardTitle>
        <CardDescription>
          Most active organizations by tasks and user engagement
        </CardDescription>
        </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis 
              dataKey="org_name" 
              stroke="#64748b"
              fontSize={12}
              tickMargin={8}
            />
            <YAxis 
              stroke="#64748b"
              fontSize={12}
              tickMargin={8}
            />
            <Tooltip 
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              }}
            />
            <Legend />
            <Bar dataKey="active_users" fill={COLORS.info} name="Active Users" radius={[4, 4, 0, 0]} />
            <Bar dataKey="tasks_completed" fill={COLORS.success} name="Completed Tasks" radius={[4, 4, 0, 0]} />
            <Bar dataKey="tasks_pending" fill={COLORS.warning} name="Pending Tasks" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
