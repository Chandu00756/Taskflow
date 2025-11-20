'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, UserPlus, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface User {
    id: string;
    username: string;
    email: string;
    full_name: string;
    role: string;
}

interface UserSelectorProps {
    orgId: string;
    onSelect: (userId: string) => void;
    excludeUserIds?: string[];
    selectedUserIds?: string[];
    multiSelect?: boolean;
}

export function UserSelector({
    orgId,
    onSelect,
    excludeUserIds = [],
    selectedUserIds = [],
    multiSelect = false
}: UserSelectorProps) {
    const [searchQuery, setSearchQuery] = useState('');

    const { data: membersData, isLoading, error } = useQuery({
        queryKey: ['org-members', orgId],
        queryFn: async () => {
            if (!orgId) {
                throw new Error('No organization ID provided');
            }
            const response = await apiClient.get(`/api/v1/organizations/${orgId}/members`);
            return response as { members: User[] };
        },
        enabled: !!orgId,
        retry: false,
    });

    const members = membersData?.members || [];

    if (error) {
        return (
            <div className="py-4 text-center">
                <p className="text-red-500 font-medium">Failed to load users</p>
                <p className="text-sm text-slate-500 mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
            </div>
        );
    }

    // Filter out excluded users and apply search
    const filteredUsers = members.filter(user => {
        const matchesSearch = user.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
            user.username.toLowerCase().includes(searchQuery.toLowerCase());
        const notExcluded = !excludeUserIds.includes(user.id);
        return matchesSearch && notExcluded;
    });

    const isSelected = (userId: string) => selectedUserIds.includes(userId);

    if (isLoading) {
        return <div className="py-4 text-center text-slate-500">Loading users...</div>;
    }

    return (
        <div className="space-y-4">
            {/* Search bar */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, email, or username..."
                    className="pl-10"
                />
            </div>

            {/* User list */}
            <div className="max-h-96 overflow-y-auto space-y-2">
                <AnimatePresence>
                    {filteredUsers.map((user) => (
                        <motion.div
                            key={user.id}
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className={`flex items-center justify-between p-3 rounded-lg border transition-colors cursor-pointer hover:border-blue-300 hover:bg-blue-50 ${isSelected(user.id) ? 'border-blue-500 bg-blue-50' : 'border-slate-200'
                                }`}
                            onClick={() => onSelect(user.id)}
                        >
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-semibold">
                                    {user.full_name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <p className="font-medium text-slate-900">{user.full_name}</p>
                                    <p className="text-sm text-slate-500">{user.email}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline">{user.role}</Badge>
                                {isSelected(user.id) && (
                                    <div className="h-6 w-6 rounded-full bg-blue-500 flex items-center justify-center">
                                        <Check className="h-4 w-4 text-white" />
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {filteredUsers.length === 0 && !isLoading && (
                <div className="text-center py-8 text-slate-500">
                    {searchQuery ? (
                        <p>No users found matching your search</p>
                    ) : excludeUserIds.length > 0 && members.length > 0 ? (
                        <>
                            <p className="font-medium">All organization members are already assigned</p>
                            <p className="text-sm mt-1">Invite new users to add more members</p>
                        </>
                    ) : (
                        <p>No available users</p>
                    )}
                </div>
            )}

            <div className="text-sm text-slate-500">
                {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''} available
            </div>
        </div>
    );
}
