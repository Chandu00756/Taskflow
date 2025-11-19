'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Workspace } from '@/lib/api/organization';
import { workspacesAPI } from '@/lib/api/organization';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Layout, Lock, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

interface WorkspaceManagerProps {
    orgId: string;
}

export function WorkspaceManager({ orgId }: WorkspaceManagerProps) {
    const queryClient = useQueryClient();
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        workspace_type: 'general',
        is_private: false,
    });

    const { data: workspacesData, isLoading } = useQuery({
        queryKey: ['workspaces', orgId],
        queryFn: async () => {
            const response = await workspacesAPI.list(orgId);
            return response as { workspaces: Workspace[] };
        },
    });

    const workspaces = workspacesData?.workspaces || [];

    const createMutation = useMutation({
        mutationFn: (data: any) => workspacesAPI.create(orgId, data),
        onSuccess: () => {
            toast.success('Workspace created successfully');
            queryClient.invalidateQueries({ queryKey: ['workspaces', orgId] });
            resetForm();
            setShowCreateDialog(false);
        },
        onError: () => toast.error('Failed to create workspace'),
    });

    const resetForm = () => {
        setFormData({ name: '', description: '', workspace_type: 'general', is_private: false });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        createMutation.mutate(formData);
    };

    if (isLoading) return <div className="flex items-center justify-center py-8">Loading workspaces...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900">Workspaces</h2>
                    <p className="text-sm text-slate-500">{workspaces.length} collaborative workspaces</p>
                </div>
                <Button onClick={() => setShowCreateDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Workspace
                </Button>
            </div>

            {/* Create Dialog */}
            <AnimatePresence>
                {showCreateDialog && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                        onClick={() => { setShowCreateDialog(false); resetForm(); }}
                    >
                        <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
                            <CardContent className="p-6">
                                <h3 className="text-xl font-bold mb-4">Create New Workspace</h3>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="text-sm font-medium text-slate-700">Workspace Name *</label>
                                        <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-slate-700">Type</label>
                                        <select value={formData.workspace_type} onChange={(e) => setFormData({ ...formData, workspace_type: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2" aria-label="Workspace type">
                                            <option value="general">General</option>
                                            <option value="project">Project</option>
                                            <option value="team">Team</option>
                                            <option value="department">Department</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-slate-700">Description</label>
                                        <Input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input type="checkbox" checked={formData.is_private} onChange={(e) => setFormData({ ...formData, is_private: e.target.checked })} className="rounded" aria-label="Private workspace" />
                                        <label className="text-sm text-slate-700">Private workspace</label>
                                    </div>
                                    <div className="flex gap-3 justify-end">
                                        <Button type="button" variant="outline" onClick={() => { setShowCreateDialog(false); resetForm(); }}>Cancel</Button>
                                        <Button type="submit">Create Workspace</Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Workspaces Grid */}
            <div className="grid md:grid-cols-3 gap-4">
                {workspaces.map((workspace: Workspace) => (
                    <Card key={workspace.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-6">
                            <div className="flex items-start gap-3 mb-3">
                                <div className="p-2 rounded-lg bg-blue-100">
                                    <Layout className="h-5 w-5 text-blue-600" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-semibold text-slate-900">{workspace.name}</h3>
                                    <p className="text-xs text-slate-500">{workspace.workspace_type}</p>
                                </div>
                                {workspace.is_private ? (
                                    <Lock className="h-4 w-4 text-slate-400" />
                                ) : (
                                    <Globe className="h-4 w-4 text-slate-400" />
                                )}
                            </div>
                            {workspace.description && (
                                <p className="text-sm text-slate-600">{workspace.description}</p>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>

            {workspaces.length === 0 && (
                <div className="text-center py-12">
                    <Layout className="mx-auto h-12 w-12 text-slate-300" />
                    <h3 className="mt-4 text-lg font-medium text-slate-900">No workspaces yet</h3>
                    <p className="mt-2 text-sm text-slate-500">Create collaborative workspaces for your teams</p>
                    <Button onClick={() => setShowCreateDialog(true)} className="mt-4"><Plus className="mr-2 h-4 w-4" />Create Workspace</Button>
                </div>
            )}
        </div>
    );
}
