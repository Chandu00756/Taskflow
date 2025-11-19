'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Group } from '@/lib/api/organization';
import { groupsAPI } from '@/lib/api/organization';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Users2, Edit, Trash2, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { UserSelector } from '@/components/shared/UserSelector';

interface GroupManagerProps {
    orgId: string;
}

export function GroupManager({ orgId }: GroupManagerProps) {
    const queryClient = useQueryClient();
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [editingGroup, setEditingGroup] = useState<Group | null>(null);
    const [showMemberDialog, setShowMemberDialog] = useState(false);
    const [selectedGroupForMembers, setSelectedGroupForMembers] = useState<Group | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        group_type: 'functional',
    });

    const { data: groupsData, isLoading } = useQuery({
        queryKey: ['groups', orgId],
        queryFn: async () => {
            const response = await groupsAPI.list(orgId);
            return response as { groups: Group[]; total: number };
        },
    });

    const groups = groupsData?.groups || [];

    const createMutation = useMutation({
        mutationFn: (data: any) => groupsAPI.create(orgId, data),
        onSuccess: () => {
            toast.success('Group created successfully');
            queryClient.invalidateQueries({ queryKey: ['groups', orgId] });
            resetForm();
            setShowCreateDialog(false);
        },
        onError: () => toast.error('Failed to create group'),
    });

    const updateMutation = useMutation({
        mutationFn: ({ groupId, data }: { groupId: string; data: any }) => groupsAPI.update(groupId, data),
        onSuccess: () => {
            toast.success('Group updated successfully');
            queryClient.invalidateQueries({ queryKey: ['groups', orgId] });
            setEditingGroup(null);
            resetForm();
        },
        onError: () => toast.error('Failed to update group'),
    });

    const deleteMutation = useMutation({
        mutationFn: (groupId: string) => groupsAPI.delete(groupId),
        onSuccess: () => {
            toast.success('Group deleted successfully');
            queryClient.invalidateQueries({ queryKey: ['groups', orgId] });
        },
        onError: () => toast.error('Failed to delete group'),
    });

    // Add member mutation
    const addMemberMutation = useMutation({
        mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
            groupsAPI.addMember(groupId, { user_id: userId }),
        onSuccess: () => {
            toast.success('Member added to group');
            queryClient.invalidateQueries({ queryKey: ['groups', orgId] });
        },
        onError: () => toast.error('Failed to add member'),
    });

    // Remove member mutation
    const removeMemberMutation = useMutation({
        mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
            groupsAPI.removeMember(groupId, userId),
        onSuccess: () => {
            toast.success('Member removed from group');
            queryClient.invalidateQueries({ queryKey: ['groups', orgId] });
        },
        onError: () => toast.error('Failed to remove member'),
    });

    const resetForm = () => {
        setFormData({ name: '', description: '', group_type: 'functional' });
        setEditingGroup(null);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (editingGroup) {
            updateMutation.mutate({ groupId: editingGroup.id, data: formData });
        } else {
            createMutation.mutate(formData);
        }
    };

    const handleEdit = (group: Group) => {
        setEditingGroup(group);
        setFormData({
            name: group.name,
            description: group.description || '',
            group_type: group.group_type,
        });
        setShowCreateDialog(true);
    };

    const handleManageMembers = (group: Group) => {
        setSelectedGroupForMembers(group);
        setShowMemberDialog(true);
    };

    const handleAddMember = (userId: string) => {
        if (selectedGroupForMembers) {
            addMemberMutation.mutate({
                groupId: selectedGroupForMembers.id,
                userId,
            });
        }
    };

    const getGroupTypeColor = (type: string) => {
        const colors = {
            functional: 'bg-blue-100 text-blue-700',
            temporary: 'bg-yellow-100 text-yellow-700',
            committee: 'bg-purple-100 text-purple-700',
            community: 'bg-green-100 text-green-700',
        };
        return colors[type as keyof typeof colors] || colors.functional;
    };

    if (isLoading) return <div className="flex items-center justify-center py-8">Loading groups...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900">Groups</h2>
                    <p className="text-sm text-slate-500">{groups.length} cross-functional groups</p>
                </div>
                <Button onClick={() => setShowCreateDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Group
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
                        <Card className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
                            <CardContent className="p-6">
                                <h3 className="text-xl font-bold mb-4">{editingGroup ? 'Edit Group' : 'Create New Group'}</h3>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="text-sm font-medium text-slate-700">Group Name *</label>
                                        <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-slate-700">Type</label>
                                        <select value={formData.group_type} onChange={(e) => setFormData({ ...formData, group_type: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2" aria-label="Group type">
                                            <option value="functional">Functional</option>
                                            <option value="temporary">Temporary</option>
                                            <option value="committee">Committee</option>
                                            <option value="community">Community</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-slate-700">Description</label>
                                        <Input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
                                    </div>
                                    <div className="flex gap-3 justify-end">
                                        <Button type="button" variant="outline" onClick={() => { setShowCreateDialog(false); resetForm(); }}>Cancel</Button>
                                        <Button type="submit">{editingGroup ? 'Update' : 'Create'} Group</Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Member Management Dialog */}
            <AnimatePresence>
                {showMemberDialog && selectedGroupForMembers && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                        onClick={() => setShowMemberDialog(false)}
                    >
                        <Card className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
                            <CardContent className="p-6">
                                <h3 className="text-xl font-bold mb-4">Manage Members - {selectedGroupForMembers.name}</h3>
                                <UserSelector
                                    orgId={orgId}
                                    onSelect={handleAddMember}
                                    excludeUserIds={selectedGroupForMembers.members?.map(m => m.user_id) || []}
                                />
                                <div className="mt-4 flex justify-end">
                                    <Button onClick={() => setShowMemberDialog(false)}>Done</Button>
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Groups Grid */}
            <div className="grid md:grid-cols-3 gap-4">
                {groups.map((group: Group) => (
                    <Card key={group.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-6">
                            <div className="flex items-start justify-between mb-3">
                                <h3 className="text-lg font-semibold text-slate-900 flex-1">{group.name}</h3>
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="sm" onClick={() => handleManageMembers(group)} title="Manage members"><UserPlus className="h-4 w-4" /></Button>
                                    <Button variant="ghost" size="sm" onClick={() => handleEdit(group)}><Edit className="h-4 w-4" /></Button>
                                    <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete "${group.name}"?`)) deleteMutation.mutate(group.id); }}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                                </div>
                            </div>
                            <Badge className={`${getGroupTypeColor(group.group_type)} mb-2`}>{group.group_type}</Badge>
                            {group.description && <p className="text-sm text-slate-600 mb-3">{group.description}</p>}
                            <div className="flex items-center gap-1 text-sm text-slate-500">
                                <Users2 className="h-4 w-4" />
                                {group.member_count} members
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {groups.length === 0 && (
                <div className="text-center py-12">
                    <Users2 className="mx-auto h-12 w-12 text-slate-300" />
                    <h3 className="mt-4 text-lg font-medium text-slate-900">No groups yet</h3>
                    <p className="mt-2 text-sm text-slate-500">Create cross-functional groups for collaboration</p>
                    <Button onClick={() => setShowCreateDialog(true)} className="mt-4"><Plus className="mr-2 h-4 w-4" />Create Group</Button>
                </div>
            )}
        </div>
    );
}
