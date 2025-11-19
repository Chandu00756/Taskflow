'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Team, TeamMember } from '@/lib/api/organization';
import { teamsAPI } from '@/lib/api/organization';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Users, Edit, Trash2, ChevronDown, ChevronRight, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { UserSelector } from '@/components/shared/UserSelector';

interface TeamManagerProps {
    orgId: string;
}

export function TeamManager({ orgId }: TeamManagerProps) {
    const queryClient = useQueryClient();
    const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [editingTeam, setEditingTeam] = useState<Team | null>(null);
    const [showMemberDialog, setShowMemberDialog] = useState(false);
    const [selectedTeamForMembers, setSelectedTeamForMembers] = useState<Team | null>(null);

    // Form state
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        team_lead_id: '',
    });

    // Fetch teams
    const { data: teamsData, isLoading } = useQuery({
        queryKey: ['teams', orgId],
        queryFn: async () => {
            const response = await teamsAPI.list(orgId);
            return response as { teams: Team[]; total: number };
        },
    });

    const teams = teamsData?.teams || [];

    // Create team mutation
    const createMutation = useMutation({
        mutationFn: (data: { name: string; description?: string; team_lead_id?: string }) =>
            teamsAPI.create(orgId, data),
        onSuccess: () => {
            toast.success('Team created successfully');
            queryClient.invalidateQueries({ queryKey: ['teams', orgId] });
            resetForm();
            setShowCreateDialog(false);
        },
        onError: () => toast.error('Failed to create team'),
    });

    // Update team mutation
    const updateMutation = useMutation({
        mutationFn: ({ teamId, data }: { teamId: string; data: any }) =>
            teamsAPI.update(teamId, data),
        onSuccess: () => {
            toast.success('Team updated successfully');
            queryClient.invalidateQueries({ queryKey: ['teams', orgId] });
            setEditingTeam(null);
            resetForm();
        },
        onError: () => toast.error('Failed to update team'),
    });

    // Delete team mutation
    const deleteMutation = useMutation({
        mutationFn: (teamId: string) => teamsAPI.delete(teamId),
        onSuccess: () => {
            toast.success('Team deleted successfully');
            queryClient.invalidateQueries({ queryKey: ['teams', orgId] });
        },
        onError: () => toast.error('Failed to delete team'),
    });

    // Add member mutation
    const addMemberMutation = useMutation({
        mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) =>
            teamsAPI.addMember(teamId, { user_id: userId, role: 'member' }),
        onSuccess: () => {
            toast.success('Member added to team');
            queryClient.invalidateQueries({ queryKey: ['teams', orgId] });
        },
        onError: (error: any) => {
            toast.error(error.response?.data?.message || 'Failed to add member');
        },
    });

    // Remove member mutation
    const removeMemberMutation = useMutation({
        mutationFn: ({ teamId, userId }: { teamId: string; userId: string }) =>
            teamsAPI.removeMember(teamId, userId),
        onSuccess: () => {
            toast.success('Member removed from team');
            queryClient.invalidateQueries({ queryKey: ['teams', orgId] });
        },
        onError: () => toast.error('Failed to remove member'),
    });

    const resetForm = () => {
        setFormData({ name: '', description: '', team_lead_id: '' });
        setEditingTeam(null);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (editingTeam) {
            updateMutation.mutate({ teamId: editingTeam.id, data: formData });
        } else {
            createMutation.mutate(formData);
        }
    };

    const handleEdit = (team: Team) => {
        setEditingTeam(team);
        setFormData({
            name: team.name,
            description: team.description || '',
            team_lead_id: team.team_lead_id || '',
        });
        setShowCreateDialog(true);
    };

    const handleDelete = (teamId: string, teamName: string) => {
        if (confirm(`Delete team "${teamName}"? This action cannot be undone.`)) {
            deleteMutation.mutate(teamId);
        }
    };

    const handleManageMembers = (team: Team) => {
        setSelectedTeamForMembers(team);
        setShowMemberDialog(true);
    };

    const handleAddMember = (userId: string) => {
        if (selectedTeamForMembers) {
            addMemberMutation.mutate({
                teamId: selectedTeamForMembers.id,
                userId,
            });
        }
    };

    const handleRemoveMember = (teamId: string, userId: string, memberName: string) => {
        if (confirm(`Remove ${memberName} from the team?`)) {
            removeMemberMutation.mutate({ teamId, userId });
        }
    };

    if (isLoading) {
        return <div className="flex items-center justify-center py-8">Loading teams...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900">Teams</h2>
                    <p className="text-sm text-slate-500">{teams.length} teams in your organization</p>
                </div>
                <Button onClick={() => setShowCreateDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Team
                </Button>
            </div>

            {/* Create/Edit Dialog */}
            <AnimatePresence>
                {showCreateDialog && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                        onClick={() => {
                            setShowCreateDialog(false);
                            resetForm();
                        }}
                    >
                        <Card
                            className="w-full max-w-lg"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <CardHeader>
                                <CardTitle>{editingTeam ? 'Edit Team' : 'Create New Team'}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label className="text-sm font-medium text-slate-700">Team Name *</label>
                                        <Input
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="Engineering, Marketing, Sales..."
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-slate-700">Description</label>
                                        <Input
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            placeholder="Describe the team's purpose"
                                        />
                                    </div>
                                    <div className="flex gap-3 justify-end">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => {
                                                setShowCreateDialog(false);
                                                resetForm();
                                            }}
                                        >
                                            Cancel
                                        </Button>
                                        <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                                            {editingTeam ? 'Update' : 'Create'} Team
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
                {showMemberDialog && selectedTeamForMembers && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
                        onClick={() => setShowMemberDialog(false)}
                    >
                        <Card className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
                            <CardHeader>
                                <CardTitle>Manage Members - {selectedTeamForMembers.name}</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <UserSelector
                                    orgId={orgId}
                                    onSelect={handleAddMember}
                                    excludeUserIds={selectedTeamForMembers.members?.map(m => m.user_id) || []}
                                />
                                <div className="mt-4 flex justify-end">
                                    <Button onClick={() => setShowMemberDialog(false)}>
                                        Done
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Teams List */}
            <div className="grid gap-4">
                {teams.map((team: Team) => (
                    <Card key={team.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-6">
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                        <button
                                            onClick={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)}
                                            className="text-slate-400 hover:text-slate-600"
                                        >
                                            {expandedTeam === team.id ? (
                                                <ChevronDown className="h-5 w-5" />
                                            ) : (
                                                <ChevronRight className="h-5 w-5" />
                                            )}
                                        </button>
                                        <h3 className="text-lg font-semibold text-slate-900">{team.name}</h3>
                                        <Badge variant="outline">{team.status}</Badge>
                                    </div>
                                    {team.description && (
                                        <p className="text-sm text-slate-600 ml-8 mb-2">{team.description}</p>
                                    )}
                                    <div className="flex items-center gap-4 ml-8 text-sm text-slate-500">
                                        {team.team_lead && (
                                            <span>Lead: {team.team_lead.full_name}</span>
                                        )}
                                        <span className="flex items-center gap-1">
                                            <Users className="h-4 w-4" />
                                            {team.member_count} members
                                        </span>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleManageMembers(team)}
                                        title="Manage members"
                                    >
                                        <UserPlus className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleEdit(team)}
                                    >
                                        <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDelete(team.id, team.name)}
                                    >
                                        <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                </div>
                            </div>

                            {/* Expanded - Members */}
                            <AnimatePresence>
                                {expandedTeam === team.id && team.members && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="mt-4 pt-4 border-t"
                                    >
                                        <h4 className="text-sm font-semibold text-slate-700 mb-2">Team Members</h4>
                                        <div className="space-y-2">
                                            {team.members.map((member: TeamMember) => (
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
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => handleRemoveMember(team.id, member.user_id, member.full_name)}
                                                        >
                                                            <X className="h-4 w-4 text-red-500" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {teams.length === 0 && (
                <div className="text-center py-12">
                    <Users className="mx-auto h-12 w-12 text-slate-300" />
                    <h3 className="mt-4 text-lg font-medium text-slate-900">No teams yet</h3>
                    <p className="mt-2 text-sm text-slate-500">Get started by creating your first team</p>
                    <Button onClick={() => setShowCreateDialog(true)} className="mt-4">
                        <Plus className="mr-2 h-4 w-4" />
                        Create Team
                    </Button>
                </div>
            )}
        </div>
    );
}
