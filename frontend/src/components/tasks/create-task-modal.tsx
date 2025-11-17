'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Tag, Hash } from 'lucide-react';
import UserSelector from '@/components/common/user-selector';
import { TaskStatus, TaskPriority } from '@/lib/api/types';
import { useAuthStore } from '@/store/auth';

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (task: {
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    due_date?: string;
    assigned_to?: string;
    tags?: string[];
  }) => void;
}

export default function CreateTaskModal({ isOpen, onClose, onSubmit }: CreateTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>(TaskStatus.TODO);
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.MEDIUM);
  const [dueDate, setDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState<string[]>([]);
  const [selectedAssignee, setSelectedAssignee] = useState<string>('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [teamId, setTeamId] = useState('');
  const [groupId, setGroupId] = useState('');
  const { user } = useAuthStore();

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const taskData: any = {
      title: title.trim(),
      description: description.trim(),
      status: status,
      priority: priority,
    };

    // Only add due_date if it's provided - convert to ISO timestamp
    if (dueDate && dueDate.trim()) {
      const date = new Date(dueDate);
      taskData.due_date = date.toISOString();
    }

    // Only add assigned_to if we have an assignee (single user)
    if (assignedTo.length > 0) {
      taskData.assigned_to = assignedTo[0];
    }

    if (teamId.trim()) {
      taskData.team_id = teamId.trim();
    }

    if (groupId.trim()) {
      taskData.group_id = groupId.trim();
    }

    // Only add tags if we have them
    if (tags.length > 0) {
      taskData.tags = tags;
    }

    console.log('Submitting task data:', taskData);
    onSubmit(taskData);

    // Reset form
    setTitle('');
    setDescription('');
    setStatus(TaskStatus.TODO);
    setPriority(TaskPriority.MEDIUM);
    setDueDate('');
    setAssignedTo([]);
    setTags([]);
    setTagInput('');
    setTeamId('');
    setGroupId('');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Create New Task
                  </h2>
                  <button
                    onClick={onClose}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    aria-label="Close modal"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                  {/* Title */}
                  <div>
                    <label htmlFor="task-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Title <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="task-title"
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Enter task title..."
                      required
                      className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label htmlFor="task-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Description
                    </label>
                    <textarea
                      id="task-description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Add task details..."
                      rows={4}
                      className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none"
                    />
                  </div>

                  {/* Assignees - Intelligent Search */}
                  <div>
                    <label htmlFor="task-assignees" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Assign To
                    </label>
                    <UserSelector
                      value={assignedTo}
                      onChange={setAssignedTo}
                      placeholder="Search and select users..."
                      multiple={true}
                      includeTeams={Boolean(user?.org_id)}
                      maxSelections={10}
                    />
                    <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                      Search by name, username, or email. Use @ for mentions.
                    </p>
                  </div>

                  {/* Tags */}
                  <div>
                    <label htmlFor="task-tags" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Tags
                    </label>
                    
                    {/* Tag Pills */}
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {tags.map(tag => (
                          <motion.div
                            key={tag}
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-900 dark:text-purple-100 rounded-full text-sm"
                          >
                            <Hash className="w-3 h-3" />
                            <span>{tag}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveTag(tag)}
                              className="ml-1 hover:bg-purple-200 dark:hover:bg-purple-800 rounded-full p-0.5 transition-colors"
                              aria-label={`Remove tag ${tag}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </motion.div>
                        ))}
                      </div>
                    )}

                    <div className="relative">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        id="task-tags"
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={handleAddTag}
                        placeholder="Type and press Enter to add tags..."
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                      Add tags like #urgent, #bug, #feature to categorize tasks
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Status */}
                    <div>
                      <label htmlFor="task-status" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Status
                      </label>
                      <select
                        id="task-status"
                        value={status}
                        onChange={(e) => setStatus(e.target.value as TaskStatus)}
                        className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      >
                        <option value={TaskStatus.TODO}>To Do</option>
                        <option value={TaskStatus.IN_PROGRESS}>In Progress</option>
                        <option value={TaskStatus.IN_REVIEW}>In Review</option>
                        <option value={TaskStatus.COMPLETED}>Completed</option>
                      </select>
                    </div>

                    {/* Priority */}
                    <div>
                      <label htmlFor="task-priority" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Priority
                      </label>
                      <select
                        id="task-priority"
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as TaskPriority)}
                        className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      >
                        <option value={TaskPriority.LOW}>Low</option>
                        <option value={TaskPriority.MEDIUM}>Medium</option>
                        <option value={TaskPriority.HIGH}>High</option>
                        <option value={TaskPriority.CRITICAL}>Critical</option>
                      </select>
                    </div>

                    {/* Due Date */}
                    <div>
                      <label htmlFor="task-due-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Due Date
                      </label>
                      <input
                        id="task-due-date"
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="w-full px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      />
                    </div>
                  </div>

                    {/* Team / Group (optional) */}
                    {user?.org_id && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Team / Group (optional)</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Team ID"
                            value={teamId}
                            onChange={(e) => setTeamId(e.target.value)}
                            className="w-1/2 px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg"
                          />
                          <input
                            type="text"
                            placeholder="Group ID"
                            value={groupId}
                            onChange={(e) => setGroupId(e.target.value)}
                            className="w-1/2 px-4 py-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg"
                          />
                        </div>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">If you are creating within an organization, select or enter a Team ID or Group ID. Org admins can leave these empty to create org-wide tasks.</p>
                      </div>
                    )}

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-5 py-2.5 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!title.trim() || (Boolean(user?.org_id) && user?.role !== 'admin' && !teamId.trim() && !groupId.trim() && assignedTo.length === 0)}
                      className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium shadow-lg shadow-blue-500/30"
                    >
                      Create Task
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
