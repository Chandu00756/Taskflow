'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { useAuthStore } from '@/store/auth';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export default function ProfilePage() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated || !user) {
    return null;
  }

  const initials = user.full_name
    ? user.full_name
        .split(' ')
        .map((part) => part.slice(0, 1))
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : user.username.slice(0, 2).toUpperCase();

  return (
    <AppShell>
      <div className="space-y-6">
        <Card className="border border-white/60 bg-white/75 p-8 shadow-xl">
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Profile</h1>
              <p className="mt-2 text-slate-600">Manage your account settings and preferences</p>
            </div>

            <div className="flex items-center gap-6">
              <Avatar className="h-24 w-24 border-4 border-white shadow-xl">
                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-emerald-400 text-2xl font-bold text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div>
                <h2 className="text-2xl font-bold text-slate-900">
                  {user.full_name || user.username}
                </h2>
                <p className="text-slate-600">{user.email}</p>
                <p className="mt-2 text-sm text-slate-500">
                  Member since {new Date(user.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>

            <div className="space-y-4 border-t border-slate-200 pt-6">
              <h3 className="text-lg font-semibold text-slate-900">Account Information</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Username
                  </p>
                  <p className="mt-1 font-semibold text-slate-900">{user.username}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Email
                  </p>
                  <p className="mt-1 font-semibold text-slate-900">{user.email}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Full Name
                  </p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {user.full_name || 'Not set'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    User ID
                  </p>
                  <p className="mt-1 font-mono text-sm font-semibold text-slate-900">{user.id}</p>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card className="border border-white/60 bg-white/75 p-8 shadow-xl">
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 p-12 text-center">
            <p className="text-lg font-semibold text-slate-900">More settings coming soon!</p>
            <p className="mt-2 text-sm text-slate-500">
              We&apos;re building features for theme customization, notifications, and more.
            </p>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
