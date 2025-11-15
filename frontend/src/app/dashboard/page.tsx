'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowRight,
  CalendarClock,
  Flame,
  ListTodo,
  LucideIcon,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuthStore } from '@/store/auth';
import { notificationsAPI, tasksAPI } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, getRelativeTime } from '@/lib/utils';
import { Task, Notification, TaskStatus, TaskPriority } from '@/lib/api/types';

const EMPTY_TASKS: Task[] = [];
const EMPTY_NOTIFICATIONS: Notification[] = [];

interface StatItem {
  title: string;
  description: string;
  icon: LucideIcon;
  value: string;
  trend: string;
  accent: string;
}

const statusLabel: Record<TaskStatus, string> = {
  [TaskStatus.TODO]: 'To do',
  [TaskStatus.IN_PROGRESS]: 'In progress',
  [TaskStatus.IN_REVIEW]: 'In review',
  [TaskStatus.COMPLETED]: 'Completed',
  [TaskStatus.CANCELLED]: 'Cancelled',
};

const priorityColor: Record<TaskPriority, string> = {
  [TaskPriority.LOW]: 'bg-emerald-50 text-emerald-600',
  [TaskPriority.MEDIUM]: 'bg-sky-50 text-sky-600',
  [TaskPriority.HIGH]: 'bg-amber-50 text-amber-600',
  [TaskPriority.CRITICAL]: 'bg-rose-50 text-rose-600',
};

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, router]);

  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksAPI.listTasks(),
    enabled: isAuthenticated,
  });

  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      user ? notificationsAPI.getUserNotifications(user.id) : { notifications: [], total: 0 },
    enabled: isAuthenticated && Boolean(user?.id),
    refetchInterval: 30_000,
  });

  const tasks = tasksQuery.data?.tasks ?? EMPTY_TASKS;
  const notifications = notificationsQuery.data?.notifications ?? EMPTY_NOTIFICATIONS;

  const summary = useMemo(
    () => buildDashboardSummary(tasks, notifications),
    [tasks, notifications]
  );

  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !notification.read),
    [notifications]
  );

  if (!isAuthenticated) {
    return null;
  }

  return (
    <AppShell unreadNotifications={unreadNotifications.length}>
      <section className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <VisualSummary stats={summary.stats} loading={tasksQuery.isLoading} />
        <TimelineCard
          notifications={notifications}
          loading={notificationsQuery.isLoading}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <PerformanceInsights
          chartData={summary.chartData}
          loading={tasksQuery.isLoading}
        />
        <FocusPulse upcoming={summary.upcoming} loading={tasksQuery.isLoading} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <PriorityKanban laneData={summary.kanban} loading={tasksQuery.isLoading} />
        <QuickActionsPanel />
      </section>
    </AppShell>
  );
}

function buildDashboardSummary(tasks: Task[], notifications: Notification[]) {
  const todo = tasks.filter((task) => task.status === TaskStatus.TODO);
  const inProgress = tasks.filter((task) => task.status === TaskStatus.IN_PROGRESS);
  const done = tasks.filter((task) => task.status === TaskStatus.COMPLETED);

  const stats: StatItem[] = [
    {
      title: 'Total tasks',
      description: 'Across all projects',
      icon: ListTodo,
      value: String(tasks.length ?? 0),
      trend: tasks.length ? '+12% vs last sprint' : 'Create your first task',
      accent: 'from-sky-500/20 to-emerald-400/20',
    },
    {
      title: 'In progress',
      description: 'Currently being worked on',
      icon: TrendingUp,
      value: String(inProgress.length),
      trend: inProgress.length ? 'Momentum looks strong' : 'Nothing in flight yet',
      accent: 'from-amber-400/25 to-orange-500/10',
    },
    {
      title: 'Completed',
      description: 'Done in the past week',
      icon: Sparkles,
      value: String(done.length),
      trend: done.length ? 'Keep the wins coming!' : 'Ship something today',
      accent: 'from-emerald-400/25 to-sky-400/15',
    },
    {
      title: 'Notifications',
      description: 'Awaiting your eyes',
      icon: Flame,
      value: String(notifications.filter((n) => !n.read).length),
      trend: 'Stay in sync with your crew',
      accent: 'from-rose-400/25 to-purple-400/15',
    },
  ];

  const dayBuckets: Record<string, number> = {};
  const today = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    dayBuckets[date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })] = 0;
  }
  tasks.forEach((task) => {
    const key = new Date(task.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    if (dayBuckets[key] !== undefined) {
      dayBuckets[key] += 1;
    }
  });

  const chartData = Object.entries(dayBuckets).map(([date, value]) => ({ date, value }));

  const upcoming = tasks
    .filter((task) => task.due_date)
    .map((task) => ({
      ...task,
      due: new Date(task.due_date as string),
    }))
    .sort((a, b) => a.due.getTime() - b.due.getTime())
    .slice(0, 4);

  const kanban = {
    todo,
    inProgress,
    done,
  };

  return { stats, chartData, upcoming, kanban };
}

function VisualSummary({ stats, loading }: { stats: StatItem[]; loading: boolean }) {
  if (loading) {
    return (
      <Card className="overflow-hidden border-2 border-slate-300 !bg-white p-6 shadow-2xl">
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-3xl" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-2 border-slate-300 !bg-gradient-to-br !from-white !to-slate-100 p-6 shadow-2xl">
      <div className="relative grid gap-4 md:grid-cols-2">
        {stats.map((stat) => (
          <motion.div
            key={stat.title}
            whileHover={{ translateY: -6 }}
            className={`relative overflow-hidden rounded-3xl border-2 border-slate-300 bg-gradient-to-br ${stat.accent} p-6 shadow-lg`}
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
                    {stat.description}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold text-slate-900">{stat.title}</h3>
                </div>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-sky-500 shadow-md border border-slate-200">
                  <stat.icon className="h-5 w-5" />
                </span>
              </div>
              <div className="flex items-end justify-between">
                <p className="text-4xl font-bold text-slate-900">{stat.value}</p>
                <span className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-600">
                  {stat.trend}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </Card>
  );
}

function PerformanceInsights({
  chartData,
  loading,
}: {
  chartData: Array<{ date: string; value: number }>;
  loading: boolean;
}) {
  return (
    <Card className="overflow-hidden border-2 border-slate-300 !bg-gradient-to-br !from-white !to-sky-100 p-6 shadow-2xl">
      <CardHeader className="flex items-center justify-between p-0 pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Work velocity
          </p>
          <CardTitle className="text-2xl font-semibold text-slate-900">
            Weekly task creation pulse
          </CardTitle>
        </div>
        <Badge variant="secondary" className="rounded-full bg-slate-100 text-slate-600">
          7 day view
        </Badge>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <Skeleton className="h-60 rounded-3xl" />
        ) : (
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="velocity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: 'rgba(56,189,248,0.1)' }}
                  contentStyle={{
                    borderRadius: 16,
                    border: '1px solid rgba(226,232,240,0.8)',
                    backgroundColor: '#ffffff',
                    boxShadow: '0 15px 35px -20px rgba(30,64,175,0.45)',
                  }}
                />
                <Area type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={3} fill="url(#velocity)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FocusPulse({ upcoming, loading }: { upcoming: (Task & { due: Date })[]; loading: boolean }) {
  return (
    <Card className="overflow-hidden border-2 border-slate-300 !bg-gradient-to-br !from-white !to-emerald-100 p-6 shadow-2xl">
      <CardHeader className="p-0 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Next up
            </p>
            <CardTitle className="text-2xl font-semibold text-slate-900">
              Due soon highlights
            </CardTitle>
          </div>
          <Badge variant="secondary" className="rounded-full bg-slate-100 text-slate-600">
            {upcoming.length} upcoming
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-3xl" />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center text-sm text-slate-500">
            No due dates on your radar. Schedule something to stay ahead.
          </div>
        ) : (
          upcoming.map((task) => {
            const priorityTone = priorityColor[task.priority] ?? 'bg-slate-100 text-slate-500';

            return (
              <motion.div
                key={task.id}
                whileHover={{ translateY: -3 }}
                className="flex items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                  <p className="text-xs text-slate-500 line-clamp-2">{task.description}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge className={priorityTone}>{task.priority.toLowerCase()}</Badge>
                  <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    <CalendarClock className="h-4 w-4 text-sky-500" />
                    {formatDate(task.due)}
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function PriorityKanban({
  laneData,
  loading,
}: {
  laneData: { todo: Task[]; inProgress: Task[]; done: Task[] };
  loading: boolean;
}) {
  const columns = [
    { key: 'todo', title: 'To do queue' },
    { key: 'inProgress', title: 'In progress' },
    { key: 'done', title: 'Shipped' },
  ] as const;

  return (
    <Card className="overflow-hidden border-2 border-slate-300 !bg-gradient-to-br !from-white !to-blue-100 p-6 shadow-2xl">
      <CardHeader className="p-0 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Flow lanes
            </p>
            <CardTitle className="text-2xl font-semibold text-slate-900">
              Snapshot of task movement
            </CardTitle>
          </div>
          <Link href="/tasks" className="text-sm font-semibold text-sky-500 hover:text-sky-600">
            Manage board
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-44 rounded-3xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {columns.map((column) => (
              <div
                key={column.key}
                className="flex h-full flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-600">{column.title}</p>
                  <Badge variant="secondary" className="rounded-full bg-slate-100 text-slate-600">
                    {laneData[column.key].length}
                  </Badge>
                </div>
                <div className="space-y-3">
                  {laneData[column.key].length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-4 text-xs text-slate-400">
                      Nothing here. Drag something in from the tasks view.
                    </div>
                  ) : (
                    laneData[column.key].slice(0, 3).map((task) => (
                      <motion.div
                        key={task.id}
                        whileHover={{ translateY: -2 }}
                        className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow transition-shadow"
                      >
                        <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>{statusLabel[task.status]}</span>
                          <span>{task.due_date ? formatDate(task.due_date) : 'No due date'}</span>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
                {laneData[column.key].length > 3 && (
                  <button className="text-xs font-semibold text-sky-500 hover:text-sky-600">
                    View {laneData[column.key].length - 3} more
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TimelineCard({ notifications, loading }: { notifications: Notification[]; loading: boolean }) {
  return (
    <Card className="overflow-hidden border-2 border-slate-300 !bg-gradient-to-br !from-white !to-purple-100 p-6 shadow-2xl">
      <CardHeader className="flex items-center justify-between p-0 pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Notification stream
          </p>
          <CardTitle className="text-2xl font-semibold text-slate-900">
            Recent activity pulse
          </CardTitle>
        </div>
        <Link href="/notifications" className="cursor-pointer text-sm font-semibold text-sky-500 transition hover:text-sky-600 hover:underline">
          Open center
        </Link>
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[4.75rem] rounded-3xl" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center text-sm text-slate-500">
            Your workspace is calm. Invite teammates or enable integrations to get real-time updates.
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.slice(0, 5).map((notification) => (
              <motion.div
                key={notification.id}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-start justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">{notification.title}</p>
                  <p className="text-xs text-slate-500">{notification.message}</p>
                </div>
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {getRelativeTime(notification.created_at)}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickActionsPanel() {
  return (
    <Card className="overflow-hidden border-2 border-slate-300 !bg-gradient-to-br !from-sky-50 !to-emerald-50 p-6 shadow-2xl">
      <div className="space-y-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            Automation runway
          </p>
          <CardTitle className="text-2xl font-semibold text-slate-900">
            Quick actions
          </CardTitle>
          <p className="mt-2 text-sm text-slate-500">
            Draft tasks, monitor focus time, and align your team in seconds.
          </p>
        </header>

        <div className="grid gap-3">
          <ActionTile
            title="Create quick task"
            description="Spin up a task card and assign collaborators instantly."
            href="/tasks?action=create"
          />
          <ActionTile
            title="Review notifications"
            description="See what your teammates shipped in the last hour."
            href="/notifications"
          />
          <ActionTile
            title="Adjust profile preferences"
            description="Configure themes, AI summaries, and focus nudges."
            href="/profile"
          />
        </div>
      </div>
    </Card>
  );
}

function ActionTile({ title, description, href }: { title: string; description: string; href: string }) {
  return (
    <Link
      href={href}
      className="group flex cursor-pointer items-center justify-between rounded-3xl border border-slate-200 bg-white px-4 py-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
    >
      <div>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-emerald-400 text-white shadow-lg transition group-hover:translate-x-1">
        <ArrowRight className="h-4 w-4" />
      </span>
    </Link>
  );
}
