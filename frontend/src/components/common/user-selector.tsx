'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, User, Users, Check } from 'lucide-react';
import { searchAPI } from '@/lib/api/search';
import type { UserProfile, Team } from '@/lib/api/workspace-types';

interface UserSelectorProps {
  value?: string[]; // Selected user IDs
  onChange: (userIds: string[]) => void;
  placeholder?: string;
  multiple?: boolean;
  workspace_id?: string;
  team_id?: string;
  excludeIds?: string[];
  includeTeams?: boolean;
  maxSelections?: number;
  className?: string;
}

export default function UserSelector({
  value = [],
  onChange,
  placeholder = 'Search users...',
  multiple = true,
  workspace_id,
  team_id,
  excludeIds = [],
  includeTeams = false,
  maxSelections,
  className = '',
}: UserSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<UserProfile[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Helper function to get user's display name
  const getUserName = (user: UserProfile) => {
    return user.display_name || user.full_name || user.username;
  };

  // Fetch initial selections
  useEffect(() => {
    if (value.length > 0) {
      // Fetch user details for selected IDs
      fetchSelectedUsers();
    }
  }, [value]);

  const fetchSelectedUsers = async () => {
    // TODO: Implement batch user fetch
    // For now, we'll use the search to get user details
  };

  // Search users and teams
  useEffect(() => {
    if (searchQuery.length === 0) {
      setUsers([]);
      setTeams([]);
      return;
    }

    const debounceTimer = setTimeout(async () => {
      setIsLoading(true);
      try {
        // Search users
        const foundUsers = await searchAPI.searchUsers(searchQuery, {
          workspace_id,
          team_id,
          exclude_ids: [...excludeIds, ...value],
          limit: 10,
        });
        setUsers(foundUsers);

        // Search teams if enabled
        if (includeTeams) {
          const foundTeams = await searchAPI.searchTeams(searchQuery, {
            workspace_id,
            limit: 5,
          });
          setTeams(foundTeams);
        }
      } catch (error) {
        console.error('Search failed:', error);
        setUsers([]);
        setTeams([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [searchQuery, workspace_id, team_id, excludeIds, value, includeTeams]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleSelectUser = (user: UserProfile) => {
    if (multiple) {
      if (maxSelections && value.length >= maxSelections) {
        return; // Max selections reached
      }
      const newValue = [...value, user.id];
      onChange(newValue);
      setSelectedUsers([...selectedUsers, user]);
    } else {
      onChange([user.id]);
      setSelectedUsers([user]);
      setIsOpen(false);
    }
    setSearchQuery('');
    inputRef.current?.focus();
  };

  const handleSelectTeam = (team: Team) => {
    // TODO: Handle team selection - add all team members
    console.log('Team selected:', team);
  };

  const handleRemoveUser = (userId: string) => {
    onChange(value.filter(id => id !== userId));
    setSelectedUsers(selectedUsers.filter(u => u.id !== userId));
  };

  const isSelected = (userId: string) => value.includes(userId);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Selected Users Pills */}
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedUsers.map(user => (
            <motion.div
              key={user.id}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100 rounded-full text-sm"
            >
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={getUserName(user)}
                  className="w-5 h-5 rounded-full object-cover"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-xs font-medium">
                  {getUserName(user).charAt(0).toUpperCase()}
                </div>
              )}
              <span className="font-medium">{getUserName(user)}</span>
              <button
                onClick={() => handleRemoveUser(user.id)}
                className="ml-1 hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full p-0.5 transition-colors"
                aria-label={`Remove ${getUserName(user)}`}
              >
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Dropdown Results */}
      <AnimatePresence>
        {isOpen && (users.length > 0 || teams.length > 0) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-50 w-full mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-80 overflow-y-auto"
          >
            {/* Teams Section */}
            {includeTeams && teams.length > 0 && (
              <div className="border-b border-gray-200 dark:border-gray-700">
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Teams
                </div>
                {teams.map(team => (
                  <button
                    key={team.id}
                    onClick={() => handleSelectTeam(team)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center">
                      <Users className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 text-left">
                      <div className="font-medium text-gray-900 dark:text-white">
                        {team.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {team.member_count || 0} members
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Users Section */}
            {users.length > 0 && (
              <div>
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Users
                </div>
                {users.map(user => {
                  const selected = isSelected(user.id);
                  return (
                    <button
                      key={user.id}
                      onClick={() => !selected && handleSelectUser(user)}
                      disabled={selected}
                      className={`w-full px-4 py-3 flex items-center gap-3 transition-colors ${
                        selected
                          ? 'bg-blue-50 dark:bg-blue-900/20 cursor-default'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      }`}
                    >
                      {user.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt={getUserName(user)}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-medium">
                          {getUserName(user).charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 text-left">
                        <div className="font-medium text-gray-900 dark:text-gray-100">
                          {getUserName(user)}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          @{user.username}
                          {user.email && ` • ${user.email}`}
                        </div>
                        {user.title && (
                          <div className="text-xs text-gray-400 dark:text-gray-500">
                            {user.title}
                            {user.department && ` • ${user.department}`}
                          </div>
                        )}
                      </div>
                      {selected && (
                        <Check className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* No Results */}
            {searchQuery && !isLoading && users.length === 0 && teams.length === 0 && (
              <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                <User className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No users found</p>
                <p className="text-xs mt-1">Try a different search term</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Max Selections Warning */}
      {maxSelections && value.length >= maxSelections && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Maximum {maxSelections} {maxSelections === 1 ? 'user' : 'users'} can be selected
        </p>
      )}
    </div>
  );
}
