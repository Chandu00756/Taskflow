'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { useRouter } from 'next/navigation';
import { teamsAPI, projectsAPI, workspacesAPI } from '@/lib/api/organization';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Users, FolderKanban, TrendingUp, Plus, ChevronRight, X, Settings, LayoutDashboard, UserPlus, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { UserSelector } from '@/components/shared/UserSelector';

export default function TeamLeadDashboard() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const { user, isAuthenticated, actualRole } = useAuthStore();
    const [activeTab, setActiveTab] = useState<'overview' | 'teams' | 'projects' | 'workspaces'>('overview');
    const [showCreateProject, setShowCreateProject] = useState(false);
    const [isHydrated, setIsHydrated] = useState(false);
    const [projectFormData, setProjectFormData] = useState({
        name: '',
        description: '',
        priority: 'medium',
        start_date: '',
        end_date: '',
    });
    const [showMemberDialog, setShowMemberDialog] = useState(false);
    const [selectedTeam, setSelectedTeam] = useState<any>(null);

    // Wait for Zustand to hydrate
    useEffect(() => {
        setIsHydrated(true);
    }, []);

    const orgId = user?.org_id || '';
    const userId = user?.id || '';

    // Fetch ALL teams (where user is lead OR member)
    const { data: teamsData } = useQuery({
        queryKey: ['my-teams', userId],
        queryFn: async () => {
            const response = await teamsAPI.list(orgId);
            const allTeams = (response as any).teams || [];
            // Show teams where user is the lead OR a member
            return allTeams.filter((team: any) =>
                team.team_lead_id === userId ||
                team.members?.some((m: any) => m.user_id === userId)
            );
        },
        enabled: !!userId && !!orgId,
    });

    const myTeams = teamsData || [];

    // Separate teams by lead vs member
    const teamsILead = myTeams.filter((t: any) => t.team_lead_id === userId);
    const teamsImMemberOf = myTeams.filter((t: any) =>
        t.members?.some((m: any) => m.user_id === userId) && t.team_lead_id !== userId
    );

    // Fetch ALL projects (where user is a member)
    const { data: projectsData } = useQuery({
        queryKey: ['team-projects', userId],
        queryFn: async () => {
            const response = await projectsAPI.list(orgId);
            const allProjects = (response as any).projects || [];
            // Show projects where user is a member
            return allProjects.filter((project: any) =>
                project.members?.some((m: any) => m.user_id === userId)
            );
        },
        enabled: !!orgId && !!userId,
    });

    const projects = projectsData || [];

    // Fetch ALL workspaces (accessible through teams and projects)
    const { data: workspacesData } = useQuery({
        queryKey: ['team-workspaces', userId],
        queryFn: async () => {
            const response = await workspacesAPI.list(orgId);
            return (response as any).workspaces || [];
        },
        enabled: !!orgId && !!userId,
    });

    const allWorkspaces = workspacesData || [];

    // Filter workspaces accessible through user's teams or projects
    const myWorkspaces = allWorkspaces.filter((workspace: any) => {
        if (workspace.team_id) {
            return myTeams.some((team: any) => team.id === workspace.team_id);
        }
        if (workspace.project_id) {
            return projects.some((project: any) => project.id === workspace.project_id);
        }
        return workspace.owner_id === userId;
    });

    // Create project mutation
    const createProjectMutation = useMutation({
        mutationFn: (data: any) => projectsAPI.create(orgId, data),
        onSuccess: () => {
            toast.success('Project created successfully!');
            queryClient.invalidateQueries({ queryKey: ['team-projects', userId] });
            setShowCreateProject(false);
            resetProjectForm();
        },
        onError: () => toast.error('Failed to create project'),
    });

    const resetProjectForm = () => {
        setProjectFormData({ name: '', description: '', priority: 'medium', start_date: '', end_date: '' });
    };

    const handleCreateProject = (e: React.FormEvent) => {
        e.preventDefault();
        createProjectMutation.mutate(projectFormData);
    };

    // Add team member mutation
    const addMemberMutation = useMutation({
        mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) =>
            teamsAPI.addMember(teamId, { user_id: userId, role: 'member' }),
        onSuccess: () => {
            toast.success('Member added to team');
            queryClient.invalidateQueries({ queryKey: ['my-teams', userId] });
        },
        onError: () => toast.error('Failed to add member'),
    });

    // Remove team member mutation
    const removeMemberMutation = useMutation({
        mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) =>
            teamsAPI.removeMember(teamId, userId),
        onSuccess: () => {
            toast.success('Member removed from team');
            queryClient.invalidateQueries({ queryKey: ['my-teams', userId] });
        },
        onError: () => toast.error('Failed to remove member'),
    });

    const handleManageMembers = (team: any) => {
        setSelectedTeam(team);
        setShowMemberDialog(true);
    };

    const handleAddMember = (memberId: string) => {
        if (selectedTeam) {
            addMemberMutation.mutate({ teamId: selectedTeam.id, userId: memberId });
        }
    };

    const handleRemoveMember = (teamId: string, memberId: string, memberName: string) => {
        if (confirm(`Remove ${memberName} from the team?`)) {
            removeMemberMutation.mutate({ teamId, userId: memberId });
        }
    };

    // Stats
    const totalMembers = myTeams.reduce((sum: number, team: any) => sum + (team.member_count || 0), 0);
    const activeProjects = projects.filter((p: any) => p.status === 'active').length;

    // Wait for hydration first
    if (!isHydrated) {
        return null;
    }

    // Redirect if not authenticated or not a team lead (AFTER all hooks)
    if (!isAuthenticated || (actualRole !== 'team_lead' && actualRole !== 'org_admin')) {
        router.replace('/login');
        return null;
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
            {/* Header */}
            <div className="bg-white border-b">
                <div className="mx-auto max-w-7xl px-6 py-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900">Team Lead Dashboard</h1>
                            <p className="text-slate-600 mt-1">Manage your teams and drive projects forward</p>
                        </div>
                        <Button
                            onClick={() => router.push('/tasks')}
                            variant="outline"
                            className="flex items-center gap-2"
                        >
                            <LayoutDashboard className="h-4 w-4" />
                            Taskflow
                        </Button>
                    </div>
                </div>
            </div>

            {/* Create Project Dialog */}
            <AnimatePresence>
                {showCreateProject && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                        onClick={() => setShowCreateProject(false)}
                    >
                        <Card className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
                            <CardContent className="p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-xl font-bold text-slate-900">Create New Project</h3>
                                    <button onClick={() => setShowCreateProject(false)} className="text-slate-400 hover:text-slate-600" aria-label="Close dialog">
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>
                                <form onSubmit={handleCreateProject} className="space-y-4">
                                    <div>
                                        <label className="text-sm font-medium text-slate-700">Project Name *</label>
                                        <Input
                                            value={projectFormData.name}
                                            onChange={(e) => setProjectFormData({ ...projectFormData, name: e.target.value })}
                                            placeholder="Enter project name"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-slate-700">Description</label>
                                        <Input
                                            value={projectFormData.description}
                                            onChange={(e) => setProjectFormData({ ...projectFormData, description: e.target.value })}
                                            placeholder="Project goals and objectives"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-sm font-medium text-slate-700">Priority</label>
                                            <select
                                                value={projectFormData.priority}
                                                onChange={(e) => setProjectFormData({ ...projectFormData, priority: e.target.value })}
                                                className="w-full rounded-lg border border-slate-200 px-3 py-2"
                                                aria-label="Project priority"
                                            >
                                                <option value="low">Low</option>
                                                <option value="medium">Medium</option>
                                                <option value="high">High</option>
                                                <option value="critical">Critical</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-sm font-medium text-slate-700">Start Date</label>
                                            <Input
                                                type="date"
                                                value={projectFormData.start_date}
                                                onChange={(e) => setProjectFormData({ ...projectFormData, start_date: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-slate-700">End Date</label>
                                        <Input
                                            type="date"
                                            value={projectFormData.end_date}
                                            onChange={(e) => setProjectFormData({ ...projectFormData, end_date: e.target.value })}
                                        />
                                    </div>
                                    <div className="flex gap-3 justify-end pt-4">
                                        <Button type="button" variant="outline" onClick={() => setShowCreateProject(false)}>
                                            Cancel
                                        </Button>
                                        <Button type="submit" disabled={createProjectMutation.isPending}>
                                            {createProjectMutation.isPending ? 'Creating...' : 'Create Project'}
                                        </Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Member Management Dialog */}
            <AnimatePresence>
                {showMemberDialog && selectedTeam && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                        onClick={() => setShowMemberDialog(false)}
                    >
                        <Card className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
                            <CardHeader>
                                <CardTitle>Manage Members - {selectedTeam.name}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <UserSelector
                                    orgId={orgId}
                                    onSelect={handleAddMember}
                                    excludeUserIds={selectedTeam.members?.map((m: any) => m.user_id) || []}
                                />
                                <div className="mt-4 flex justify-end">
                                    <Button onClick={() => setShowMemberDialog(false)}>Done</Button>
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Tabs */}
            <div className="bg-white border-b">
                <div className="mx-auto max-w-7xl px-6">
                    <div className="flex gap-6">
                        {[
                            { id: 'overview', label: 'Overview' },
                            { id: 'teams', label: 'My Teams' },
                            { id: 'projects', label: 'Projects' },
                            { id: 'workspaces', label: 'Workspaces' },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={`border-b-2 px-1 py-4 text-sm font-medium transition ${activeTab === tab.id
                                    ? 'border-blue-500 text-blue-600'
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
                        {/* Stats Cards */}
                        <div className="grid md:grid-cols-4 gap-6">
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                            >
                                <Card>
                                    <CardContent className="p-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-slate-600">Total Teams</p>
                                                <p className="text-3xl font-bold text-slate-900 mt-2">{myTeams.length}</p>
                                                <p className="text-xs text-slate-500 mt-1">
                                                    {teamsILead.length} leading · {teamsImMemberOf.length} member
                                                </p>
                                            </div>
                                            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                                                <Users className="h-6 w-6 text-blue-600" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 }}
                            >
                                <Card>
                                    <CardContent className="p-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-slate-600">Team Members</p>
                                                <p className="text-3xl font-bold text-slate-900 mt-2">{totalMembers}</p>
                                            </div>
                                            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
                                                <TrendingUp className="h-6 w-6 text-green-600" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3 }}
                            >
                                <Card>
                                    <CardContent className="p-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-slate-600">Active Projects</p>
                                                <p className="text-3xl font-bold text-slate-900 mt-2">{activeProjects}</p>
                                            </div>
                                            <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center">
                                                <FolderKanban className="h-6 w-6 text-purple-600" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.4 }}
                            >
                                <Card>
                                    <CardContent className="p-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-slate-600">Workspaces</p>
                                                <p className="text-3xl font-bold text-slate-900 mt-2">{myWorkspaces.length}</p>
                                            </div>
                                            <div className="h-12 w-12 rounded-full bg-indigo-100 flex items-center justify-center">
                                                <Layers className="h-6 w-6 text-indigo-600" />
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        </div>

                        {/* My Teams Quick View */}
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle>My Teams</CardTitle>
                                    <Button variant="outline" size="sm" onClick={() => setActiveTab('teams')}>
                                        View All
                                        <ChevronRight className="ml-2 h-4 w-4" />
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {myTeams.slice(0, 5).map((team: any) => {
                                        const isLead = team.team_lead_id === userId;
                                        return (
                                            <div
                                                key={team.id}
                                                className="flex items-center justify-between p-4 rounded-lg border hover:border-blue-300 hover:bg-blue-50 transition cursor-pointer"
                                                onClick={() => setActiveTab('teams')}
                                            >
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-semibold text-slate-900">{team.name}</p>
                                                        {isLead && (
                                                            <Badge variant="default" className="text-xs">Team Lead</Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-slate-500">{team.member_count} members</p>
                                                </div>
                                                <Badge variant="outline">{team.status}</Badge>
                                            </div>
                                        );
                                    })}
                                    {myTeams.length === 0 && (
                                        <p className="text-center py-8 text-slate-500">
                                            You are not part of any teams yet.
                                        </p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {activeTab === 'teams' && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-slate-900">My Teams</h2>
                        </div>
                        <div className="grid md:grid-cols-2 gap-6">
                            {myTeams.map((team: any) => {
                                const isLead = team.team_lead_id === userId;
                                return (
                                    <Card key={team.id} className="hover:shadow-lg transition">
                                        <CardContent className="p-6">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <h3 className="text-lg font-semibold text-slate-900">{team.name}</h3>
                                                        {isLead && (
                                                            <Badge variant="default" className="text-xs">Team Lead</Badge>
                                                        )}
                                                    </div>
                                                    {team.description && (
                                                        <p className="text-sm text-slate-600 mb-4">{team.description}</p>
                                                    )}
                                                </div>
                                                {isLead && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleManageMembers(team)}
                                                        title="Manage members"
                                                    >
                                                        <UserPlus className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-4 text-sm text-slate-500">
                                                <span className="flex items-center gap-1">
                                                    <Users className="h-4 w-4" />
                                                    {team.member_count} members
                                                </span>
                                                <Badge variant="outline">{team.status}</Badge>
                                            </div>

                                            {/* Member list */}
                                            {team.members && team.members.length > 0 && (
                                                <div className="mt-4 pt-4 border-t">
                                                    <h4 className="text-sm font-semibold text-slate-700 mb-2">Team Members</h4>
                                                    <div className="space-y-2">
                                                        {team.members.map((member: any) => (
                                                            <div
                                                                key={member.id}
                                                                className="flex items-center justify-between p-2 rounded-lg bg-slate-50"
                                                            >
                                                                <div>
                                                                    <p className="text-sm font-medium">{member.full_name}</p>
                                                                    <p className="text-xs text-slate-500">{member.email}</p>
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <Badge variant="secondary">{member.role}</Badge>
                                                                    {isLead && (
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            onClick={() => handleRemoveMember(team.id, member.user_id, member.full_name)}
                                                                        >
                                                                            <X className="h-4 w-4 text-red-500" />
                                                                        </Button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    </div>
                )}

                {activeTab === 'projects' && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-slate-900">Projects</h2>
                            <Button onClick={() => setShowCreateProject(true)}>
                                <Plus className="mr-2 h-4 w-4" />
                                Create Project
                            </Button>
                        </div>
                        <div className="grid md:grid-cols-2 gap-6">
                            {projects.map((project: any) => (
                                <Card key={project.id} className="hover:shadow-lg transition">
                                    <CardContent className="p-6">
                                        <h3 className="text-lg font-semibold text-slate-900 mb-2">{project.name}</h3>
                                        {project.description && (
                                            <p className="text-sm text-slate-600 mb-4">{project.description}</p>
                                        )}
                                        <div className="flex flex-wrap gap-2 mb-3">
                                            <Badge>{project.status}</Badge>
                                            <Badge variant="outline">{project.priority}</Badge>
                                        </div>
                                        {project.progress > 0 && (
                                            <div className="mb-3">
                                                <div className="flex justify-between text-sm mb-1">
                                                    <span className="text-slate-600">Progress</span>
                                                    <span className="font-medium">{project.progress}%</span>
                                                </div>
                                                <div className="w-full bg-slate-200 rounded-full h-2">
                                                    <div
                                                        className="bg-green-500 h-2 rounded-full transition-all"
                                                        {...{ style: { width: `${project.progress}%` } }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            ))}
                            {projects.length === 0 && (
                                <div className="col-span-2 text-center py-12">
                                    <FolderKanban className="mx-auto h-12 w-12 text-slate-300" />
                                    <h3 className="mt-4 text-lg font-medium text-slate-900">No projects yet</h3>
                                    <p className="mt-2 text-sm text-slate-500">Create your first project to get started</p>
                                    <Button className="mt-4" onClick={() => setShowCreateProject(true)}>
                                        <Plus className="mr-2 h-4 w-4" />
                                        Create Project
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'workspaces' && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-bold text-slate-900">Workspaces</h2>
                        </div>
                        <div className="grid md:grid-cols-3 gap-6">
                            {myWorkspaces.map((workspace: any) => {
                                const relatedTeam = workspace.team_id ? myTeams.find((t: any) => t.id === workspace.team_id) : null;
                                const relatedProject = workspace.project_id ? projects.find((p: any) => p.id === workspace.project_id) : null;
                                
                                return (
                                    <Card key={workspace.id} className="hover:shadow-lg transition">
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
                                                <div className="flex items-center gap-2">
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
                                    <p className="mt-2 text-sm text-slate-500">Workspaces will appear here when created for your teams or projects</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
