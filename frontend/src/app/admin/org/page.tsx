'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Building2, Users, UserPlus, Mail, Settings, Shield,
  Trash2, Send, Copy, Check, X, Users2, FolderKanban, Layout
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { apiClient, invitesAPI } from '@/lib/api';
import { InviteItem } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { TeamManager } from './components/TeamManager';
import { ProjectManager } from './components/ProjectManager';
import { GroupManager } from './components/GroupManager';
import { WorkspaceManager } from './components/WorkspaceManager';

interface TeamMember {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: string;
  created_at: string;
  has_logged_in: boolean;
  last_login?: string;
  must_change_password: boolean;
  failed_login_attempts: number;
  has_security_questions: boolean;
  // Legacy fields for backward compatibility
  teams?: string[];
  joined_at?: string;
  status?: 'active' | 'inactive';
}

interface OrgSettings {
  org_id: string;
  org_name: string;
  org_description?: string;
  max_members?: number;
  created_at: string;
}

export default function OrgAdminPage() {
  const router = useRouter();
  const { user, isAuthenticated, actualRole, isSuperAdmin } = useAuthStore();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'members' | 'teams' | 'projects' | 'groups' | 'workspaces' | 'invites' | 'settings'>('members');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [hasCheckedAuth, setHasCheckedAuth] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [resetPasswordResult, setResetPasswordResult] = useState<{ memberId: string; username: string; password: string } | null>(null);
  const [copiedPassword, setCopiedPassword] = useState(false);

  // Wait for Zustand to hydrate from localStorage
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    // Don't check auth until store is hydrated
    if (!isHydrated) {
      console.log('⏳ Waiting for auth store to hydrate...');
      return;
    }

    // Only run auth check once to prevent redirect loops
    if (hasCheckedAuth) return;

    console.log('OrgAdminPage auth check:', {
      isAuthenticated,
      actualRole,
      isSuperAdmin,
      userRole: user?.role,
      userEmail: user?.email,
      isHydrated
    });

    if (!isAuthenticated) {
      console.log('Not authenticated, redirecting to login');
      router.replace('/login');
      setHasCheckedAuth(true);
      return;
    }

    // ONLY org_admin and super_admin can access this page
    const isOrgAdmin = actualRole === 'org_admin' || isSuperAdmin;
    console.log('Org admin check:', { isOrgAdmin, actualRole, isSuperAdmin });

    if (!isOrgAdmin) {
      console.log('Not org admin, redirecting to dashboard');
      toast.error('Unauthorized: Organization Admin access only');
      router.replace('/dashboard');
      setHasCheckedAuth(true);
    } else {
      console.log('Access granted to org admin page');
      setHasCheckedAuth(true);
    }
  }, [isAuthenticated, actualRole, isSuperAdmin, router, user, hasCheckedAuth, isHydrated]);

  const orgId = user?.org_id || '';

  // Fetch team members
  const membersQuery = useQuery({
    queryKey: ['org-members', orgId],
    queryFn: () => apiClient.get<{ members: TeamMember[] }>(`/api/v1/organizations/${orgId}/members`),
    enabled: !!orgId && isAuthenticated,
  });

  // Fetch invites
  const invitesQuery = useQuery({
    queryKey: ['org-invites', orgId],
    queryFn: () => invitesAPI.listInvites(orgId),
    enabled: !!orgId && isAuthenticated,
  });

  // Fetch org settings - DISABLED: endpoint doesn't exist yet
  // const settingsQuery = useQuery({
  //   queryKey: ['org-settings', orgId],
  //   queryFn: () => apiClient.get<OrgSettings>(`/api/v1/organizations/${orgId}`),
  //   enabled: !!orgId && isAuthenticated,
  // });

  const members = membersQuery.data?.members || [];
  const invites = invitesQuery.data?.invites || [];
  // const orgSettings = settingsQuery.data;
  const orgName = "Portal VII"; // TODO: Fetch from API when GetOrganization endpoint is implemented

  // Create invite mutation
  const createInviteMutation = useMutation({
    mutationFn: (data: { org_id: string; first_name: string; last_name: string; email: string; role: string }) =>
      invitesAPI.createInvite(orgId, data),
    onSuccess: (response: any) => {
      toast.success('Member created successfully!');
      // Show generated credentials
      if (response.generated_username && response.one_time_password) {
        toast.success(
          `Username: ${response.generated_username}\nPassword: ${response.one_time_password}`,
          { duration: 10000 }
        );
      }
      setInviteEmail('');
      setInviteFirstName('');
      setInviteLastName('');
      queryClient.invalidateQueries({ queryKey: ['org-invites', orgId] });
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create member');
    },
  });

  // Remove member mutation
  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) =>
      apiClient.delete(`/api/v1/organizations/${orgId}/members/${userId}`),
    onSuccess: () => {
      toast.success('Member removed');
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] });
    },
    onError: () => toast.error('Failed to remove member'),
  });

  // Delete invite mutation
  const deleteInviteMutation = useMutation({
    mutationFn: (inviteId: string) =>
      apiClient.delete(`/api/v1/invites/${inviteId}`),
    onSuccess: () => {
      toast.success('Invite cancelled');
      queryClient.invalidateQueries({ queryKey: ['org-invites', orgId] });
    },
    onError: () => toast.error('Failed to cancel invite'),
  });

  // Admin reset password mutation
  const adminResetPasswordMutation = useMutation({
    mutationFn: (userId: string) =>
      apiClient.post(`/api/v1/organizations/${orgId}/members/${userId}/reset-password`, {}),
    onSuccess: (response: any, userId: string) => {
      setResetPasswordResult({
        memberId: userId,
        username: response.username || response.generated_username,
        password: response.new_temp_password || response.one_time_password || response.new_password,
      });
      toast.success('Password reset successfully! Copy the temporary password below.');
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to reset password');
    },
  });

  // Reset security questions mutation
  const resetSecurityQuestionsMutation = useMutation({
    mutationFn: (userId: string) =>
      apiClient.post(`/api/v1/users/${userId}/reset-security-questions`, {}),
    onSuccess: () => {
      toast.success('Security questions reset successfully');
      queryClient.invalidateQueries({ queryKey: ['org-members', orgId] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to reset security questions');
    },
  });

  const handleSendInvite = () => {
    if (!inviteEmail || !inviteFirstName || !inviteLastName) {
      toast.error('Please fill in all fields');
      return;
    }
    createInviteMutation.mutate({
      org_id: orgId,
      first_name: inviteFirstName,
      last_name: inviteLastName,
      email: inviteEmail,
      role: inviteRole
    });
  };

  const handleCopyInviteLink = (inviteId: string) => {
    const inviteUrl = `${window.location.origin}/register?token=${inviteId}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopiedToken(inviteId);
    toast.success('Invite link copied!');
    setTimeout(() => setCopiedToken(null), 2000);
  };

  // Only org_admin and super_admin can access
  const isOrgAdmin = actualRole === 'org_admin' || isSuperAdmin;
  if (!isAuthenticated || !isOrgAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="border-b bg-white/80 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-lg">
                <Building2 className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Organization Admin</h1>
                <p className="text-sm text-slate-500">{orgName}</p>
              </div>
            </div>
            <Button onClick={() => router.push('/tasks')} variant="outline">
              Taskflow
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex gap-6 overflow-x-auto">
            {[
              { id: 'members', label: 'Team Members', icon: Users },
              { id: 'teams', label: 'Teams', icon: Users2 },
              { id: 'projects', label: 'Projects', icon: FolderKanban },
              { id: 'groups', label: 'Groups', icon: Users2 },
              { id: 'workspaces', label: 'Workspaces', icon: Layout },
              { id: 'invites', label: 'Invitations', icon: Mail },
              { id: 'settings', label: 'Settings', icon: Settings },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  'flex items-center gap-2 border-b-2 px-1 py-4 text-sm font-medium transition whitespace-nowrap',
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
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
        {activeTab === 'members' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Team Members</h2>
                <p className="text-sm text-slate-500">{members.length} members in your organization</p>
              </div>
              <Button onClick={() => setActiveTab('invites')}>
                <UserPlus className="mr-2 h-4 w-4" />
                Invite Members
              </Button>
            </div>

            <div className="grid gap-4">
              {members.map((member) => {
                const isExpanded = expandedMemberId === member.id;
                return (
                  <Card key={member.id} className={cn("transition-all", isExpanded && "ring-2 ring-blue-500")}>
                    <CardContent className="p-0">
                      {/* Member Header - Clickable */}
                      <div
                        className="flex items-center justify-between p-6 cursor-pointer hover:bg-slate-50 transition"
                        onClick={() => setExpandedMemberId(isExpanded ? null : member.id)}
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 text-lg font-semibold text-white">
                            {member.full_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h3 className="font-semibold text-slate-900">{member.full_name}</h3>
                            <p className="text-sm text-slate-500">@{member.username} • {member.email}</p>
                            <div className="mt-1 flex gap-2">
                              <Badge variant="outline">{member.role}</Badge>
                              {member.must_change_password && (
                                <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-amber-300 animate-pulse">
                                  ⚠️ Temporary Password Active
                                </Badge>
                              )}
                              {!member.has_security_questions && member.has_logged_in && (
                                <Badge variant="secondary" className="bg-orange-100 text-orange-700">
                                  No Security Questions
                                </Badge>
                              )}
                              {member.failed_login_attempts > 0 && (
                                <Badge variant="destructive">
                                  {member.failed_login_attempts} failed attempts
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {member.must_change_password && (
                            <Badge variant="secondary" className="bg-amber-500 text-white font-semibold">
                              Action Needed
                            </Badge>
                          )}
                          <Badge variant={member.has_logged_in ? 'default' : 'secondary'}>
                            {member.has_logged_in ? 'Active' : 'Not Logged In'}
                          </Badge>
                          {member.role !== 'org_admin' && member.role !== 'admin' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Remove ${member.full_name} from the organization?`)) {
                                  removeMemberMutation.mutate(member.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Expanded Management Panel */}
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="border-t border-slate-200 bg-slate-50 p-6"
                        >
                          <h4 className="text-sm font-semibold text-slate-900 mb-4">User Management</h4>

                          {/* Account Status */}
                          <div className="mb-6 grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <p className="text-xs text-slate-500">Account Status</p>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant={member.has_logged_in ? 'default' : 'secondary'}>
                                  {member.has_logged_in ? '✓ Has Logged In' : '✗ Never Logged In'}
                                </Badge>
                                {member.last_login && (
                                  <Badge variant="outline">
                                    Last: {new Date(member.last_login).toLocaleDateString()}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <p className="text-xs text-slate-500">Security Status</p>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant={member.has_security_questions ? 'default' : 'secondary'}>
                                  {member.has_security_questions ? '✓ Security Questions Set' : '✗ No Security Questions'}
                                </Badge>
                                <Badge variant={member.must_change_password ? 'secondary' : 'default'}>
                                  {member.must_change_password ? 'Temp Password' : 'Permanent Password'}
                                </Badge>
                              </div>
                            </div>
                          </div>

                          {/* Temporary Password Warning */}
                          {member.must_change_password && !resetPasswordResult && (
                            <motion.div
                              initial={{ opacity: 0, y: -10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="p-4 bg-amber-50 rounded-lg border-2 border-amber-300 mb-4"
                            >
                              <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center">
                                  <Shield className="h-5 w-5 text-white" />
                                </div>
                                <div className="flex-1">
                                  <h5 className="text-sm font-semibold text-amber-900 mb-1">Temporary Password Active</h5>
                                  <p className="text-xs text-amber-700 mb-2">
                                    This user has a temporary password that must be changed on next login. 
                                    The password was previously generated and cannot be retrieved.
                                  </p>
                                  <div className="flex gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="bg-white border-amber-300 text-amber-700 hover:bg-amber-50"
                                      onClick={() => {
                                        if (confirm(`Generate a new temporary password for ${member.full_name}?\n\nThis will replace the current temporary password.`)) {
                                          adminResetPasswordMutation.mutate(member.id);
                                        }
                                      }}
                                      disabled={adminResetPasswordMutation.isPending}
                                    >
                                      <Shield className="h-4 w-4 mr-2" />
                                      Re-generate Password
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}

                          {/* Management Actions */}
                          <div className="space-y-3">
                            {/* Reset Password */}
                            <div className="space-y-3">
                              <div className="flex items-center justify-between p-4 bg-white rounded-lg border">
                                <div>
                                  <h5 className="text-sm font-semibold text-slate-900">
                                    {member.must_change_password ? 'Re-generate Temporary Password' : 'Reset Password'}
                                  </h5>
                                  <p className="text-xs text-slate-500">
                                    {member.must_change_password 
                                      ? 'Generate a new temporary password (replaces current temp password)'
                                      : 'Generate a new one-time password for this user'
                                    }
                                  </p>
                                </div>
                                <Button
                                  variant={member.must_change_password ? "default" : "outline"}
                                  size="sm"
                                  className={member.must_change_password ? "bg-amber-500 hover:bg-amber-600" : ""}
                                  onClick={() => {
                                    if (confirm(`Reset password for ${member.full_name}?`)) {
                                      adminResetPasswordMutation.mutate(member.id);
                                    }
                                  }}
                                  disabled={adminResetPasswordMutation.isPending}
                                >
                                  <Shield className="h-4 w-4 mr-2" />
                                  {member.must_change_password ? 'Re-generate' : 'Reset Password'}
                                </Button>
                              </div>

                              {/* Show temporary password after reset */}
                              {resetPasswordResult && resetPasswordResult.memberId === member.id && (
                                <motion.div
                                  initial={{ opacity: 0, y: -10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="p-4 bg-amber-50 rounded-lg border border-amber-200"
                                >
                                  <div className="flex items-center justify-between mb-3">
                                    <h5 className="text-sm font-semibold text-amber-900">⚠️ Temporary Password Generated</h5>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setResetPasswordResult(null)}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                  <p className="text-xs text-amber-700 mb-3">
                                    Share this password securely with the user. They must change it on first login.
                                  </p>
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between p-3 bg-white rounded border border-amber-300">
                                      <div className="flex-1">
                                        <p className="text-xs text-slate-500 mb-1">Username</p>
                                        <p className="font-mono text-sm font-semibold text-slate-900">{resetPasswordResult.username}</p>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          navigator.clipboard.writeText(resetPasswordResult.username);
                                          toast.success('Username copied!');
                                        }}
                                      >
                                        <Copy className="h-4 w-4" />
                                      </Button>
                                    </div>
                                    <div className="flex items-center justify-between p-3 bg-white rounded border border-amber-300">
                                      <div className="flex-1">
                                        <p className="text-xs text-slate-500 mb-1">Temporary Password</p>
                                        <p className="font-mono text-base font-bold text-amber-900">{resetPasswordResult.password}</p>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          navigator.clipboard.writeText(resetPasswordResult.password);
                                          setCopiedPassword(true);
                                          toast.success('Password copied to clipboard!');
                                          setTimeout(() => setCopiedPassword(false), 2000);
                                        }}
                                      >
                                        {copiedPassword ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                                      </Button>
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </div>

                            {/* Reset Security Questions */}
                            {member.has_security_questions && (
                              <div className="flex items-center justify-between p-4 bg-white rounded-lg border">
                                <div>
                                  <h5 className="text-sm font-semibold text-slate-900">Reset Security Questions</h5>
                                  <p className="text-xs text-slate-500">Clear current questions, user must set new ones on next login</p>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    if (confirm(`Reset security questions for ${member.full_name}?`)) {
                                      resetSecurityQuestionsMutation.mutate(member.id);
                                    }
                                  }}
                                  disabled={resetSecurityQuestionsMutation.isPending}
                                >
                                  <X className="h-4 w-4 mr-2" />
                                  Reset Questions
                                </Button>
                              </div>
                            )}

                            {/* Failed Login Attempts */}
                            {member.failed_login_attempts > 0 && (
                              <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <h5 className="text-sm font-semibold text-red-900">Failed Login Attempts</h5>
                                    <p className="text-xs text-red-600">
                                      This account has {member.failed_login_attempts} failed login attempt(s)
                                    </p>
                                  </div>
                                  <Badge variant="destructive">{member.failed_login_attempts}</Badge>
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'teams' && <TeamManager orgId={orgId} />}

        {activeTab === 'projects' && <ProjectManager orgId={orgId} />}

        {activeTab === 'groups' && <GroupManager orgId={orgId} />}

        {activeTab === 'workspaces' && <WorkspaceManager orgId={orgId} />}

        {activeTab === 'invites' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Create New Member</CardTitle>
                <CardDescription>Add a new team member to your organization</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      placeholder="First Name"
                      value={inviteFirstName}
                      onChange={(e) => setInviteFirstName(e.target.value)}
                      aria-label="First name"
                    />
                    <Input
                      placeholder="Last Name"
                      value={inviteLastName}
                      onChange={(e) => setInviteLastName(e.target.value)}
                      aria-label="Last name"
                    />
                  </div>
                  <div className="flex gap-4">
                    <Input
                      placeholder="email@example.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="flex-1"
                      aria-label="Email address"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="rounded-lg border border-slate-200 px-4 py-2"
                      aria-label="Select role"
                    >
                      <option value="member">Member</option>
                      <option value="team_lead">Team Lead</option>
                    </select>
                    <Button
                      onClick={handleSendInvite}
                      disabled={createInviteMutation.isPending}
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      Create Member
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div>
              <h2 className="mb-4 text-xl font-semibold text-slate-900">Pending Invitations</h2>
              <div className="grid gap-4">
                {invites.map((invite) => (
                  <Card key={invite.invite_id}>
                    <CardContent className="flex items-center justify-between p-6">
                      <div>
                        <p className="font-medium text-slate-900">{invite.email}</p>
                        <p className="text-sm text-slate-500">
                          Role: {invite.role} • Expires: {new Date(invite.expires_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge>{invite.used_at ? 'accepted' : 'pending'}</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyInviteLink(invite.invite_id)}
                        >
                          {copiedToken === invite.invite_id ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                        {!invite.used_at && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm('Cancel this invitation?')) {
                                deleteInviteMutation.mutate(invite.invite_id);
                              }
                            }}
                          >
                            <X className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Organization Settings</CardTitle>
                <CardDescription>Manage your organization configuration</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-slate-700">Organization Name</label>
                  <Input value={orgName || ''} disabled className="mt-1" />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Description</label>
                  <Input
                    value=""
                    disabled
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Organization ID</label>
                  <Input value={orgId || ''} disabled className="mt-1 font-mono text-xs" />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700">Created</label>
                  <Input
                    value=""
                    disabled
                    className="mt-1"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
