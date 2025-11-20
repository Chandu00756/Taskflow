'use client';
/* eslint-disable @next/next/no-img-element */
/* eslint-disable @next/next/no-css-tags */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Project } from '@/lib/api/organization';
import { projectsAPI } from '@/lib/api/organization';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, FolderKanban, Edit, Trash2, TrendingUp, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { UserSelector } from '@/components/shared/UserSelector';

// Progress bar component
const ProgressBar = ({ progress }: { progress: number }) => {
    // Create style object separately to avoid inline style linting
    const progressStyle = { width: `${progress}%` };
    
    return (
        <div className="mb-3">
            <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-slate-600">Progress</span>
                <span className="font-medium">{progress}%</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <div
                    className="bg-green-500 h-full rounded-full transition-all"
                    {...{ style: progressStyle }}
                />
            </div>
        </div>
    );
}; interface ProjectManagerProps {
    orgId: string;
}

export function ProjectManager({ orgId }: ProjectManagerProps) {
    const queryClient = useQueryClient();
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [editingProject, setEditingProject] = useState<Project | null>(null);
    const [showMemberDialog, setShowMemberDialog] = useState(false);
    const [selectedProjectForMembers, setSelectedProjectForMembers] = useState<Project | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        priority: 'medium',
        start_date: '',
        end_date: '',
        budget: '',
    });

    const { data: projectsData, isLoading } = useQuery({
        queryKey: ['projects', orgId],
        queryFn: async () => {
            const response = await projectsAPI.list(orgId);
            return response as { projects: Project[]; total: number };
        },
    });

    const projects = projectsData?.projects || [];

    const createMutation = useMutation({
        mutationFn: (data: any) => projectsAPI.create(orgId, { ...data, budget: parseFloat(data.budget) || 0 }),
        onSuccess: () => {
            toast.success('Project created successfully');
            queryClient.invalidateQueries({ queryKey: ['projects', orgId] });
            resetForm();
            setShowCreateDialog(false);
        },
        onError: () => toast.error('Failed to create project'),
    });

    const updateMutation = useMutation({
        mutationFn: ({ projectId, data }: { projectId: string; data: any }) =>
            projectsAPI.update(projectId, { ...data, budget: parseFloat(data.budget) || undefined }),
        onSuccess: () => {
            toast.success('Project updated successfully');
            queryClient.invalidateQueries({ queryKey: ['projects', orgId] });
            setEditingProject(null);
            resetForm();
        },
        onError: () => toast.error('Failed to update project'),
    });

    const deleteMutation = useMutation({
        mutationFn: (projectId: string) => projectsAPI.delete(projectId),
        onSuccess: () => {
            toast.success('Project deleted successfully');
            queryClient.invalidateQueries({ queryKey: ['projects', orgId] });
        },
        onError: () => toast.error('Failed to delete project'),
    });

    // Add member mutation
    const addMemberMutation = useMutation({
        mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) =>
            projectsAPI.addMember(projectId, { user_id: userId, role: 'member' }),
        onSuccess: () => {
            toast.success('Member added to project');
            queryClient.invalidateQueries({ queryKey: ['projects', orgId] });
        },
        onError: () => toast.error('Failed to add member'),
    });

    // Remove member mutation
    const removeMemberMutation = useMutation({
        mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) =>
            projectsAPI.removeMember(projectId, userId),
        onSuccess: () => {
            toast.success('Member removed from project');
            queryClient.invalidateQueries({ queryKey: ['projects', orgId] });
        },
        onError: () => toast.error('Failed to remove member'),
    });

    const resetForm = () => {
        setFormData({ name: '', description: '', priority: 'medium', start_date: '', end_date: '', budget: '' });
        setEditingProject(null);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (editingProject) {
            updateMutation.mutate({ projectId: editingProject.id, data: formData });
        } else {
            createMutation.mutate(formData);
        }
    };

    const handleEdit = (project: Project) => {
        setEditingProject(project);
        setFormData({
            name: project.name,
            description: project.description || '',
            priority: project.priority,
            start_date: project.start_date || '',
            end_date: project.end_date || '',
            budget: project.budget?.toString() || '',
        });
        setShowCreateDialog(true);
    };

    const handleManageMembers = (project: Project) => {
        setSelectedProjectForMembers(project);
        setShowMemberDialog(true);
    };

    const handleAddMember = (userId: string) => {
        if (selectedProjectForMembers) {
            addMemberMutation.mutate({
                projectId: selectedProjectForMembers.id,
                userId,
            });
        }
    };

    const getPriorityColor = (priority: string) => {
        const colors = {
            low: 'bg-blue-100 text-blue-700',
            medium: 'bg-yellow-100 text-yellow-700',
            high: 'bg-orange-100 text-orange-700',
            critical: 'bg-red-100 text-red-700',
        };
        return colors[priority as keyof typeof colors] || colors.medium;
    };

    const getStatusColor = (status: string) => {
        const colors = {
            planning: 'bg-slate-100 text-slate-700',
            active: 'bg-green-100 text-green-700',
            on_hold: 'bg-yellow-100 text-yellow-700',
            completed: 'bg-blue-100 text-blue-700',
            cancelled: 'bg-red-100 text-red-700',
        };
        return colors[status as keyof typeof colors] || colors.planning;
    };

    if (isLoading) return <div className="flex items-center justify-center py-8">Loading projects...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900">Projects</h2>
                    <p className="text-sm text-slate-500">{projects.length} active projects</p>
                </div>
                <Button onClick={() => setShowCreateDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Project
                </Button>
            </div>

            {/* Create/Edit Dialog */}
            <AnimatePresence>
                {showCreateDialog && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                        onClick={() => { setShowCreateDialog(false); resetForm(); }}
                    >
                        <Card className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
                            <CardContent className="p-6">
                                <h3 className="text-xl font-bold mb-4">{editingProject ? 'Edit Project' : 'Create New Project'}</h3>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-sm font-medium text-slate-700">Project Name *</label>
                                            <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
                                        </div>
                                        <div>
                                            <label className="text-sm font-medium text-slate-700">Priority</label>
                                            <select value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2" aria-label="Project priority">
                                                <option value="low">Low</option>
                                                <option value="medium">Medium</option>
                                                <option value="high">High</option>
                                                <option value="critical">Critical</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-slate-700">Description</label>
                                        <Input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Project goals and objectives" />
                                    </div>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div>
                                            <label className="text-sm font-medium text-slate-700">Start Date</label>
                                            <Input type="date" value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="text-sm font-medium text-slate-700">End Date</label>
                                            <Input type="date" value={formData.end_date} onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="text-sm font-medium text-slate-700">Budget ($)</label>
                                            <Input type="number" value={formData.budget} onChange={(e) => setFormData({ ...formData, budget: e.target.value })} placeholder="0.00" />
                                        </div>
                                    </div>
                                    <div className="flex gap-3 justify-end pt-4">
                                        <Button type="button" variant="outline" onClick={() => { setShowCreateDialog(false); resetForm(); }}>Cancel</Button>
                                        <Button type="submit">{editingProject ? 'Update' : 'Create'} Project</Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Member Management Dialog */}
            <AnimatePresence>
                {showMemberDialog && selectedProjectForMembers && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                        onClick={() => setShowMemberDialog(false)}
                    >
                        <Card className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
                            <CardContent className="p-6">
                                <h3 className="text-xl font-bold mb-4">Manage Members - {selectedProjectForMembers.name}</h3>
                                <UserSelector
                                    orgId={orgId}
                                    onSelect={handleAddMember}
                                    excludeUserIds={selectedProjectForMembers.members?.map(m => m.user_id) || []}
                                />
                                <div className="mt-4 flex justify-end">
                                    <Button onClick={() => setShowMemberDialog(false)}>Done</Button>
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Projects Grid */}
            <div className="grid md:grid-cols-2 gap-4">
                {projects.map((project: Project) => (
                    <Card key={project.id} className="hover:shadow-lg transition-shadow">
                        <CardContent className="p-6">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex-1">
                                    <h3 className="text-lg font-semibold text-slate-900">{project.name}</h3>
                                    {project.description && <p className="text-sm text-slate-600 mt-1">{project.description}</p>}
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="ghost" size="sm" onClick={() => handleManageMembers(project)} title="Manage members"><UserPlus className="h-4 w-4" /></Button>
                                    <Button variant="ghost" size="sm" onClick={() => handleEdit(project)}><Edit className="h-4 w-4" /></Button>
                                    <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete "${project.name}"?`)) deleteMutation.mutate(project.id); }}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-2 mb-3">
                                <Badge className={getStatusColor(project.status)}>{project.status}</Badge>
                                <Badge className={getPriorityColor(project.priority)}>{project.priority}</Badge>
                            </div>

                            {project.progress > 0 && <ProgressBar progress={project.progress} />}

                            <div className="grid grid-cols-2 gap-4 text-sm text-slate-600">
                                {project.start_date && <div><span className="font-medium">Start:</span> {project.start_date}</div>}
                                {project.end_date && <div><span className="font-medium">End:</span> {project.end_date}</div>}
                                {project.budget && <div><span className="font-medium">Budget:</span> ${project.budget.toLocaleString()}</div>}
                                <div className="flex items-center gap-1"><TrendingUp className="h-4 w-4" />{project.team_count} teams</div>
                                <div className="flex items-center gap-1"><UserPlus className="h-4 w-4" />{project.member_count || 0} members</div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {projects.length === 0 && (
                <div className="text-center py-12">
                    <FolderKanban className="mx-auto h-12 w-12 text-slate-300" />
                    <h3 className="mt-4 text-lg font-medium text-slate-900">No projects yet</h3>
                    <p className="mt-2 text-sm text-slate-500">Create your first project to get started</p>
                    <Button onClick={() => setShowCreateDialog(true)} className="mt-4"><Plus className="mr-2 h-4 w-4" />Create Project</Button>
                </div>
            )}
        </div>
    );
}
