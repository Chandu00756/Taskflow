'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useRouter } from 'next/navigation';
import { teamsAPI, projectsAPI, groupsAPI, workspacesAPI } from '@/lib/api/organization';
import { apiClient } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, FolderKanban, Users2, Layout, CheckCircle2, Settings, Layers } from 'lucide-react';
import { motion } from 'framer-motion';

export default function MemberDashboard() {
    const router = useRouter();
    const { user, isAuthenticated, actualRole, isSuperAdmin } = useAuthStore();
    const [activeTab, setActiveTab] = useState<'overview' | 'teams' | 'projects' | 'groups' | 'workspaces' | 'tasks'>('overview');
    const [isHydrated, setIsHydrated] = useState(false);

    // Wait for Zustand to hydrate from localStorage
    useEffect(() => {
        setIsHydrated(true);
    }, []);

    const orgId = user?.org_id || '';
    const userId = user?.id || '';
    const isOrgAdmin = actualRole === 'org_admin' || isSuperAdmin;

    // Fetch all teams
    const { data: allTeamsData } = useQuery({
        queryKey: ['all-teams', orgId],
        queryFn: async () => {
            const response = await teamsAPI.list(orgId);
            return (response as any).teams || [];
        },
        enabled: !!orgId,
    });

    // Filter teams where user is a member
    const myTeams = (allTeamsData || []).filter((team: any) =>
        team.members?.some((m: any) => m.user_id === userId)
    );

    // Fetch all projects
    const { data: allProjectsData } = useQuery({
        queryKey: ['all-projects', orgId],
        queryFn: async () => {
            const response = await projectsAPI.list(orgId);
            return (response as any).projects || [];
        },
        enabled: !!orgId,
    });

    // Filter projects where user is a member
    const myProjects = (allProjectsData || []).filter((project: any) =>
        project.members?.some((m: any) => m.user_id === userId)
    );

    // Fetch all groups
    const { data: allGroupsData } = useQuery({
        queryKey: ['all-groups', orgId],
        queryFn: async () => {
            const response = await groupsAPI.list(orgId);
            return (response as any).groups || [];
        },
        enabled: !!orgId,
    });

    const myGroups = (allGroupsData || []).filter((group: any) =>
        group.members?.some((m: any) => m.user_id === userId)
    );

    // Fetch all workspaces
    const { data: allWorkspacesData } = useQuery({
        queryKey: ['all-workspaces', orgId],
        queryFn: async () => {
            const response = await workspacesAPI.list(orgId);
            return (response as any).workspaces || [];
        },
        enabled: !!orgId,
    });

    // Filter workspaces where user has access through teams or projects
    const myWorkspaces = (allWorkspacesData || []).filter((workspace: any) => {
        // User can access workspace if they're in the linked team or project
        if (workspace.team_id) {
            return myTeams.some((team: any) => team.id === workspace.team_id);
        }
        if (workspace.project_id) {
            return myProjects.some((project: any) => project.id === workspace.project_id);
        }
        // If no team/project link, check if user is the owner
        return workspace.owner_id === userId;
    });

    // Fetch my tasks
    const { data: tasksData } = useQuery({
        queryKey: ['my-tasks', userId],
        queryFn: async () => {
            const response = await apiClient.get(`/api/v1/tasks?assigned_to=${userId}`);
            return (response as any).tasks || [];
        },
        enabled: !!userId,
    });

    const myTasks = tasksData || [];
    const completedTasks = myTasks.filter((t: any) => t.status === 'completed').length;
    const pendingTasks = myTasks.filter((t: any) => t.status === 'in_progress').length;

    // Check authentication AFTER all hooks AND hydration
    if (!isHydrated) {
        return null; // Wait for hydration
    }

    if (!isAuthenticated) {
        router.replace('/login');
        return null;
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-green-50">
            {/* Header */}
            <div className="bg-white border-b">
                <div className="mx-auto max-w-7xl px-6 py-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900">My Dashboard</h1>
                            <p className="text-slate-600 mt-1">View your teams, projects, and tasks</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button
                                onClick={() => router.push('/tasks')}
                                variant="outline"
                                className="flex items-center gap-2"
                            >
                                <Layout className="h-4 w-4" />
                                Taskflow
                            </Button>
                            {isOrgAdmin && (
                                <Button
                                    onClick={() => router.push('/admin/org')}
                                    variant="outline"
                                    className="flex items-center gap-2"
                                >
                                    <Settings className="h-4 w-4" />
                                    Org Admin
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="bg-white border-b">
                <div className="mx-auto max-w-7xl px-6">
                    <div className="flex gap-6">
                        {[
                            { id: 'overview', label: 'Overview' },
                            { id: 'teams', label: 'My Teams' },
                            { id: 'projects', label: 'My Projects' },
                            { id: 'groups', label: 'My Groups' },
                            { id: 'workspaces', label: 'My Workspaces' },
                            { id: 'tasks', label: 'My Tasks' },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`border-b-2 px-1 py-4 text-sm font-medium transition ${activeTab === tab.id
                                    ? 'border-green-500 text-green-600'
                                    : 'border-transparent text-slate-500 hover:text-slate-700'
                                    }`}
                            >
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
                        {/* Stats */}
                        <div className="grid md:grid-cols-4 gap-6">
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                                <Card>
                                    <CardContent className="p-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-slate-600">My Teams</p>
                                                <p className="text-3xl font-bold text-slate-900 mt-2">{myTeams.length}</p>
                                            </div>
                                            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                                                <Users className="h-6 w-6 text-blue-600" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                                <Card>
                                    <CardContent className="p-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-slate-600">My Projects</p>
                                                <p className="text-3xl font-bold text-slate-900 mt-2">{myProjects.length}</p>
                                            </div>
                                            <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center">
                                                <FolderKanban className="h-6 w-6 text-purple-600" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                                <Card>
                                    <CardContent className="p-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-slate-600">My Groups</p>
                                                <p className="text-3xl font-bold text-slate-900 mt-2">{myGroups.length}</p>
                                            </div>
                                            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
                                                <Users2 className="h-6 w-6 text-green-600" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                                <Card>
                                    <CardContent className="p-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-slate-600">Pending Tasks</p>
                                                <p className="text-3xl font-bold text-slate-900 mt-2">{pendingTasks}</p>
                                            </div>
                                            <div className="h-12 w-12 rounded-full bg-orange-100 flex items-center justify-center">
                                                <CheckCircle2 className="h-6 w-6 text-orange-600" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        </div>

                        {/* Second row of stats */}
                        <div className="grid md:grid-cols-2 gap-6">
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                                <Card>
                                    <CardContent className="p-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-slate-600">My Workspaces</p>
                                                <p className="text-3xl font-bold text-slate-900 mt-2">{myWorkspaces.length}</p>
                                            </div>
                                            <div className="h-12 w-12 rounded-full bg-indigo-100 flex items-center justify-center">
                                                <Layers className="h-6 w-6 text-indigo-600" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
                                <Card>
                                    <CardContent className="p-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-slate-600">Completed Tasks</p>
                                                <p className="text-3xl font-bold text-slate-900 mt-2">{completedTasks}</p>
                                            </div>
                                            <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center">
                                                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        </div>

                        {/* Quick Info */}
                        <div className="grid md:grid-cols-2 gap-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle>My Teams</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-3">
                                        {myTeams.slice(0, 5).map((team: any) => (
                                            <div key={team.id} className="flex items-center justify-between p-3 rounded-lg border">
                                                <p className="font-medium text-slate-900">{team.name}</p>
                                                <Badge variant="outline">{team.status}</Badge>
                                            </div>
                                        ))}
                                        {myTeams.length === 0 && (
                                            <p className="text-center py-8 text-slate-500">You haven't been assigned to any teams yet.</p>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle>My Projects</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-3">
                                        {myProjects.slice(0, 5).map((project: any) => (
                                            <div key={project.id} className="flex items-center justify-between p-3 rounded-lg border">
                                                <p className="font-medium text-slate-900">{project.name}</p>
                                                <Badge>{project.status}</Badge>
                                            </div>
                                        ))}
                                        {myProjects.length === 0 && (
                                            <p className="text-center py-8 text-slate-500">You haven't been assigned to any projects yet.</p>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                )}

                {activeTab === 'teams' && (
                    <div className="grid md:grid-cols-3 gap-6">
                        {myTeams.map((team: any) => (
                            <Card key={team.id}>
                                <CardContent className="p-6">
                                    <h3 className="text-lg font-semibold text-slate-900 mb-2">{team.name}</h3>
                                    {team.description && <p className="text-sm text-slate-600 mb-4">{team.description}</p>}
                                    <div className="flex items-center gap-2 text-sm text-slate-500">
                                        <Users className="h-4 w-4" />
                                        {team.member_count} members
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                {activeTab === 'projects' && (
                    <div className="grid md:grid-cols-2 gap-6">
                        {myProjects.map((project: any) => (
                            <Card key={project.id}>
                                <CardContent className="p-6">
                                    <h3 className="text-lg font-semibold text-slate-900 mb-2">{project.name}</h3>
                                    {project.description && <p className="text-sm text-slate-600 mb-4">{project.description}</p>}
                                    <div className="flex gap-2 mb-3">
                                        <Badge>{project.status}</Badge>
                                        <Badge variant="outline">{project.priority}</Badge>
                                    </div>
                                    {project.progress > 0 && (
                                        <div>
                                            <div className="flex justify-between text-sm mb-1">
                                                <span>Progress</span>
                                                <span>{project.progress}%</span>
                                            </div>
                                            <div className="w-full bg-slate-200 rounded-full h-2">
                                                <div className="bg-green-500 h-2 rounded-full" {...{ style: { width: `${project.progress}%` } }} />
                                            </div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                        {myProjects.length === 0 && (
                            <div className="col-span-2 text-center py-12">
                                <FolderKanban className="mx-auto h-12 w-12 text-slate-300" />
                                <h3 className="mt-4 text-lg font-medium text-slate-900">No projects yet</h3>
                                <p className="mt-2 text-sm text-slate-500">You haven't been assigned to any projects</p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'groups' && (
                    <div className="grid md:grid-cols-3 gap-6">
                        {myGroups.map((group: any) => (
                            <Card key={group.id}>
                                <CardContent className="p-6">
                                    <h3 className="text-lg font-semibold text-slate-900 mb-2">{group.name}</h3>
                                    {group.description && <p className="text-sm text-slate-600 mb-4">{group.description}</p>}
                                    <div className="flex items-center gap-4 text-sm text-slate-500">
                                        <span className="flex items-center gap-1">
                                            <Users2 className="h-4 w-4" />
                                            {group.member_count} members
                                        </span>
                                        <Badge variant="outline">{group.group_type}</Badge>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                        {myGroups.length === 0 && (
                            <div className="col-span-3 text-center py-12">
                                <Users2 className="mx-auto h-12 w-12 text-slate-300" />
                                <h3 className="mt-4 text-lg font-medium text-slate-900">No groups yet</h3>
                                <p className="mt-2 text-sm text-slate-500">You haven't been added to any groups</p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'workspaces' && (
                    <div className="grid md:grid-cols-3 gap-6">
                        {myWorkspaces.map((workspace: any) => {
                            // Find related team or project
                            const relatedTeam = workspace.team_id ? myTeams.find((t: any) => t.id === workspace.team_id) : null;
                            const relatedProject = workspace.project_id ? myProjects.find((p: any) => p.id === workspace.project_id) : null;
                            
                            return (
                                <Card key={workspace.id}>
                                    <CardContent className="p-6">
                                        <div className="flex items-start justify-between mb-2">
                                            <h3 className="text-lg font-semibold text-slate-900">{workspace.name}</h3>
                                            {workspace.is_private && (
                                                <Badge variant="secondary" className="text-xs">Private</Badge>
                                            )}
                                        </div>
                                        {workspace.description && (
                                            <p className="text-sm text-slate-600 mb-4">{workspace.description}</p>
                                        )}
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2 text-sm">
                                                <Badge variant="outline">{workspace.workspace_type}</Badge>
                                            </div>
                                            {relatedTeam && (
                                                <p className="text-xs text-slate-500 flex items-center gap-1">
                                                    <Users className="h-3 w-3" />
                                                    Team: {relatedTeam.name}
                                                </p>
                                            )}
                                            {relatedProject && (
                                                <p className="text-xs text-slate-500 flex items-center gap-1">
                                                    <FolderKanban className="h-3 w-3" />
                                                    Project: {relatedProject.name}
                                                </p>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                        {myWorkspaces.length === 0 && (
                            <div className="col-span-3 text-center py-12">
                                <Layers className="mx-auto h-12 w-12 text-slate-300" />
                                <h3 className="mt-4 text-lg font-medium text-slate-900">No workspaces yet</h3>
                                <p className="mt-2 text-sm text-slate-500">You don't have access to any workspaces</p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'tasks' && (
                    <div className="space-y-4">
                        {myTasks.map((task: any) => (
                            <Card key={task.id}>
                                <CardContent className="p-6">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h3 className="font-semibold text-slate-900">{task.title}</h3>
                                            {task.description && <p className="text-sm text-slate-600 mt-1">{task.description}</p>}
                                        </div>
                                        <Badge>{task.status}</Badge>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                        {myTasks.length === 0 && (
                            <div className="text-center py-12">
                                <CheckCircle2 className="mx-auto h-12 w-12 text-slate-300" />
                                <h3 className="mt-4 text-lg font-medium text-slate-900">No tasks yet</h3>
                                <p className="mt-2 text-sm text-slate-500">You don't have any assigned tasks</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
