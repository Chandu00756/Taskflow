'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { 
  Building2, Users, Activity, TrendingUp, Shield, Search,
  UserCheck, Ban, Trash2, Eye, Server, BarChart3, CheckCircle2, Unlock, UserX, X, LogOut
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { apiClient } from '@/lib/api';
import { v2, parseApiError } from '@/lib/itsm/api';
import { signOutState, useHydrated, useIdleLogout, useSignOut } from '@/components/desk/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { UserGrowthChart, TaskDistributionChart, OrganizationActivityChart } from '@/components/admin/AnalyticsCharts';
import { SystemHealthMonitor } from '@/components/admin/SystemHealth';

interface Organization {
  id: string;
  name: string;
  domain?: string | null;
  description?: string | null;
  member_count: number;
  agent_count: number;
  ticket_count: number;
  open_tickets: number;
  last_login?: string | null;
  created_at: string;
  status: 'active' | 'suspended';
}

interface GlobalUser {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: string;
  org_id?: string | null;
  org_name?: string | null;
  last_login?: string | null;
  created_at: string;
  status: 'active' | 'locked' | 'deactivated';
}

type UserAction = 'deactivate' | 'reactivate' | 'unlock';

export default function GlobalAdminPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const signOut = useSignOut();
  useIdleLogout(30);
  const { user, isAuthenticated, isSuperAdmin: isSuper, actualRole } = useAuthStore();
  const queryClient = useQueryClient();
  const [searchOrg, setSearchOrg] = useState('');
  const [searchUser, setSearchUser] = useState('');
  const [userOrgFilter, setUserOrgFilter] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'organizations' | 'users' | 'analytics' | 'system'>('overview');

  useEffect(() => {
    // The persisted session is only available after the first client render.
    if (!hydrated) return;
    if (!isAuthenticated) {
      if (!signOutState.active) router.replace('/login?next=%2Fadmin%2Fglobal');
      return;
    }
    
    // Check super admin status using actualRole from JWT
    // The API returns proto enum (USER_ROLE_MEMBER) but JWT contains real role (super_admin)
    if (!isSuper && actualRole !== 'super_admin') {
      toast.error('Unauthorized: Super Admin access only');
      router.replace('/dashboard');
    }
  }, [hydrated, isAuthenticated, isSuper, actualRole, router]);

  // Fetch organizations
  const orgsQuery = useQuery({
    queryKey: ['admin-organizations'],
    queryFn: () => v2.items<Organization>('/platform/organizations'),
    enabled: hydrated && isAuthenticated && isSuper,
  });

  // Fetch all users
  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => v2.items<GlobalUser>('/platform/users'),
    enabled: hydrated && isAuthenticated && isSuper,
  });

  // Analytics
  const analyticsQuery = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () => apiClient.get<{
      total_organizations: number;
      total_users: number;
      active_users_today: number;
      total_tasks: number;
    }>('/api/v1/admin/analytics'),
    enabled: hydrated && isAuthenticated && isSuper,
  });

  const organizations = orgsQuery.data || [];
  const users = usersQuery.data || [];
  const analytics = analyticsQuery.data || {
    total_organizations: organizations.length,
    total_users: users.length,
    active_users_today: 0,
    total_tasks: 0,
  } as {
    total_organizations: number;
    total_users: number;
    active_users_today: number;
    total_tasks: number;
  };

  const filteredOrgs = organizations.filter(org =>
    org.name.toLowerCase().includes(searchOrg.toLowerCase())
  );

  const filteredUsers = users.filter(u =>
    (!userOrgFilter || u.org_id === userOrgFilter) && (
      u.username.toLowerCase().includes(searchUser.toLowerCase()) ||
      u.email.toLowerCase().includes(searchUser.toLowerCase()) ||
      u.full_name.toLowerCase().includes(searchUser.toLowerCase())
    )
  );
  const filterOrgName = organizations.find((o) => o.id === userOrgFilter)?.name;

  const suspendOrgMutation = useMutation({
    mutationFn: ({ orgId, suspend }: { orgId: string; suspend: boolean }) =>
      v2.post(`/platform/organizations/${orgId}/${suspend ? 'suspend' : 'activate'}`),
    onSuccess: (_data, { suspend }) => {
      toast.success(suspend ? 'Organization suspended' : 'Organization reactivated');
      queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
    },
    onError: (err) => toast.error(parseApiError(err).message),
  });

  const userActionMutation = useMutation({
    mutationFn: ({ userId, action }: { userId: string; action: UserAction }) =>
      v2.post(`/platform/users/${userId}/${action}`),
    onSuccess: (_data, { action }) => {
      toast.success({ deactivate: 'User deactivated', reactivate: 'User reactivated', unlock: 'User unlocked' }[action]);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err) => toast.error(parseApiError(err).message),
  });

  const deleteOrgMutation = useMutation({
    mutationFn: (orgId: string) => apiClient.delete(`/api/v1/admin/organizations/${orgId}`),
    onSuccess: () => {
      toast.success('Organization deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err) => toast.error(parseApiError(err).message),
  });

  if (!hydrated || !isAuthenticated || !isSuper) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="border-b bg-white/80 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-lg">
                <Shield className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Global Admin Portal</h1>
                <p className="text-sm text-slate-500">TaskFlow System Administration</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {user?.email && <span className="hidden text-sm text-slate-500 sm:inline">{user.email}</span>}
              <Button variant="outline" size="sm" onClick={() => signOut()}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex gap-6">
            {[
              { id: 'overview', label: 'Overview', icon: Activity },
              { id: 'analytics', label: 'Analytics', icon: BarChart3 },
              { id: 'organizations', label: 'Organizations', icon: Building2 },
              { id: 'users', label: 'All Users', icon: Users },
              { id: 'system', label: 'System Health', icon: Server },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-1 py-4 text-sm font-medium transition',
                  activeTab === tab.id
                    ? 'border-purple-500 text-purple-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid gap-6 md:grid-cols-4">
              {[
                { label: 'Total Organizations', value: analytics.total_organizations, icon: Building2, color: 'from-blue-500 to-cyan-500' },
                { label: 'Total Users', value: analytics.total_users, icon: Users, color: 'from-purple-500 to-pink-500' },
                { label: 'Active Today', value: analytics.active_users_today, icon: UserCheck, color: 'from-emerald-500 to-teal-500' },
                { label: 'Total Tasks', value: analytics.total_tasks, icon: TrendingUp, color: 'from-orange-500 to-red-500' },
              ].map((stat) => (
                <Card key={stat.label}>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-500">{stat.label}</p>
                        <p className="mt-1 text-3xl font-bold text-slate-900">{stat.value}</p>
                      </div>
                      <div className={cn('rounded-xl bg-gradient-to-br p-3 text-white shadow-lg', stat.color)}>
                        <stat.icon className="h-6 w-6" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle>Platform Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="rounded-full bg-slate-100 p-4">
                    <Activity className="h-8 w-8 text-slate-400" />
                  </div>
                  <p className="mt-4 text-sm font-medium text-slate-600">Activity monitoring</p>
                  <p className="mt-1 text-xs text-slate-400">Real-time activity tracking will appear here</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {/* Advanced Analytics Section */}
            <div className="grid gap-6 lg:grid-cols-2">
              <UserGrowthChart />
              <TaskDistributionChart />
            </div>
            <OrganizationActivityChart />
          </div>
        )}

        {activeTab === 'system' && (
          <div>
            {/* System Health Monitoring Section */}
            <SystemHealthMonitor />
          </div>
        )}

        {activeTab === 'organizations' && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search organizations..."
                  value={searchOrg}
                  onChange={(e) => setSearchOrg(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="grid gap-4">
              {filteredOrgs.map((org) => (
                <Card key={org.id}>
                  <CardContent className="flex items-center justify-between p-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white">
                        <Building2 className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900">{org.name}</h3>
                        <p className="text-sm text-slate-500">{org.description || org.domain || 'No description'}</p>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                          <span>{org.member_count} members</span>
                          <span>{org.agent_count} agents</span>
                          <span>{org.ticket_count} tickets ({org.open_tickets} open)</span>
                          <span>Created {new Date(org.created_at).toLocaleDateString()}</span>
                          {org.last_login && <span>Last sign-in {new Date(org.last_login).toLocaleDateString()}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={org.status === 'active' ? 'default' : 'destructive'}>
                        {org.status}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="View members"
                        aria-label={`View members of ${org.name}`}
                        onClick={() => {
                          setUserOrgFilter(org.id);
                          setActiveTab('users');
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {org.status === 'suspended' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Reactivate organization"
                          aria-label={`Reactivate ${org.name}`}
                          disabled={suspendOrgMutation.isPending}
                          onClick={() => suspendOrgMutation.mutate({ orgId: org.id, suspend: false })}
                        >
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Suspend organization"
                          aria-label={`Suspend ${org.name}`}
                          disabled={suspendOrgMutation.isPending}
                          onClick={() => {
                            if (confirm(`Suspend ${org.name}? Every member is signed out and blocked until it is reactivated.`)) {
                              suspendOrgMutation.mutate({ orgId: org.id, suspend: true });
                            }
                          }}
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Delete organization"
                        aria-label={`Delete ${org.name}`}
                        onClick={() => {
                          if (confirm('Delete this organization? This cannot be undone.')) {
                            deleteOrgMutation.mutate(org.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search users by name, email, or username..."
                value={searchUser}
                onChange={(e) => setSearchUser(e.target.value)}
                className="pl-10"
              />
            </div>
            {userOrgFilter && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                Showing members of <span className="font-medium text-slate-900">{filterOrgName || 'organization'}</span>
                <Button variant="ghost" size="sm" onClick={() => setUserOrgFilter(null)} aria-label="Clear organization filter">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            <div className="rounded-lg border bg-white">
              <table className="w-full">
                <thead className="border-b bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Organization</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-slate-900">{u.full_name}</p>
                          <p className="text-sm text-slate-500">@{u.username}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">{u.email}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{u.org_name || 'No org'}</td>
                      <td className="px-6 py-4">
                        <Badge variant="outline">{u.role}</Badge>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={u.status === 'active' ? 'default' : 'destructive'}>
                          {u.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        {u.role === 'super_admin' ? (
                          <span className="text-xs text-slate-400">Platform admin</span>
                        ) : (
                          <div className="flex items-center gap-1">
                            {u.status === 'locked' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Unlock sign-in"
                                aria-label={`Unlock ${u.email}`}
                                disabled={userActionMutation.isPending}
                                onClick={() => userActionMutation.mutate({ userId: u.id, action: 'unlock' })}
                              >
                                <Unlock className="h-4 w-4" />
                              </Button>
                            )}
                            {u.status === 'deactivated' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Reactivate user"
                                aria-label={`Reactivate ${u.email}`}
                                disabled={userActionMutation.isPending}
                                onClick={() => userActionMutation.mutate({ userId: u.id, action: 'reactivate' })}
                              >
                                <UserCheck className="h-4 w-4 text-emerald-600" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Deactivate user"
                                aria-label={`Deactivate ${u.email}`}
                                disabled={userActionMutation.isPending}
                                onClick={() => {
                                  if (confirm(`Deactivate ${u.email}? They are signed out and cannot sign in.`)) {
                                    userActionMutation.mutate({ userId: u.id, action: 'deactivate' });
                                  }
                                }}
                              >
                                <UserX className="h-4 w-4 text-red-500" />
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
