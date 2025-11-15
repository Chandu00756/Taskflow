'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { useAuthStore } from '@/store/auth';
import { Card } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';
import { notificationsAPI } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { getRelativeTime } from '@/lib/utils';
import { motion } from 'framer-motion';

export default function NotificationsPage() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, router]);

  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      user ? notificationsAPI.getUserNotifications(user.id) : { notifications: [], total: 0 },
    enabled: isAuthenticated && Boolean(user?.id),
  });

  const notifications = notificationsQuery.data?.notifications ?? [];

  if (!isAuthenticated) {
    return null;
  }

  return (
    <AppShell unreadNotifications={notifications.filter((n) => !n.read).length}>
      <Card className="border border-white/60 bg-white/75 p-8 shadow-xl">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Notifications</h1>
            <p className="mt-2 text-slate-600">Stay updated with your workspace activity</p>
          </div>

          {notificationsQuery.isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-3xl" />
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 p-12 text-center">
              <p className="text-lg font-semibold text-slate-900">All caught up!</p>
              <p className="mt-2 text-sm text-slate-500">
                You don&apos;t have any notifications right now.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {notifications.map((notification, index) => (
                <motion.div
                  key={notification.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`rounded-3xl border p-6 shadow-sm transition hover:shadow-md ${
                    notification.read
                      ? 'border-slate-200 bg-white/50'
                      : 'border-blue-200 bg-blue-50/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">{notification.title}</h3>
                      <p className="mt-1 text-sm text-slate-600">{notification.message}</p>
                      <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        {getRelativeTime(notification.created_at)}
                      </p>
                    </div>
                    {!notification.read && (
                      <div className="h-2 w-2 rounded-full bg-blue-500" />
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </AppShell>
  );
}
