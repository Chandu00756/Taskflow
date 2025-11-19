'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Filter, X, Calendar, Flag, User, Hash, Sparkles, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuthStore } from '@/store/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { tasksAPI } from '@/lib/api';
import { SearchParser, searchUtils } from '@/lib/api/search';
import { formatDate, cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Task, CreateTaskRequest, UpdateTaskRequest } from '@/lib/api/types';
import { TaskPriority, TaskStatus } from '@/lib/api/types';
import { SortableTaskCard } from '@/components/tasks/sortable-task-card';
import { DroppableColumn } from '@/components/tasks/droppable-column';
import CreateTaskModal from '@/components/tasks/create-task-modal';
import UserSelector from '@/components/common/user-selector';

const COLUMNS: { id: TaskStatus; title: string; color: string }[] = [
  { id: TaskStatus.TODO, title: 'To Do', color: 'from-slate-500/10 to-slate-400/5' },
  { id: TaskStatus.IN_PROGRESS, title: 'In Progress', color: 'from-amber-500/10 to-orange-400/5' },
  { id: TaskStatus.IN_REVIEW, title: 'In Review', color: 'from-purple-500/10 to-purple-400/5' },
  { id: TaskStatus.COMPLETED, title: 'Completed', color: 'from-emerald-500/10 to-green-400/5' },
];

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  [TaskPriority.LOW]: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  [TaskPriority.MEDIUM]: 'bg-sky-100 text-sky-700 border-sky-200',
  [TaskPriority.HIGH]: 'bg-amber-100 text-amber-700 border-amber-200',
  [TaskPriority.CRITICAL]: 'bg-rose-100 text-rose-700 border-rose-200',
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TaskPriority.LOW]: 'Low',
  [TaskPriority.MEDIUM]: 'Medium',
  [TaskPriority.HIGH]: 'High',
  [TaskPriority.CRITICAL]: 'Critical',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.TODO]: 'To Do',
  [TaskStatus.IN_PROGRESS]: 'In Progress',
  [TaskStatus.IN_REVIEW]: 'In Review',
  [TaskStatus.COMPLETED]: 'Completed',
  [TaskStatus.CANCELLED]: 'Cancelled',
};

export default function TasksPage() {
  const router = useRouter();
  // Avoid Next's useSearchParams during prerender; use client-side URLSearchParams
  const [searchParamsClient, setSearchParamsClient] = useState<URLSearchParams | null>(null);
  const { isAuthenticated, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [isHydrated, setIsHydrated] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [filterPriority, setFilterPriority] = useState<TaskPriority | 'ALL'>('ALL');
  const [filterAssignees, setFilterAssignees] = useState<string[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Parse search query for intelligent filtering
  const parsedSearch = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return SearchParser.parse(searchQuery);
  }, [searchQuery]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (isHydrated && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, router, isHydrated]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      setSearchParamsClient(sp);
      if (sp.get('action') === 'create') {
        setIsCreateModalOpen(true);
      }
    }
  }, []);

  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksAPI.listTasks(),
    enabled: isAuthenticated,
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTaskRequest }) => {
      console.log('Updating task:', { id, data });
      return tasksAPI.updateTask(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Task updated successfully');
    },
    onError: (error: any) => {
      console.error('Update task error:', error);
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to update task';
      toast.error(errorMessage);
    },
  });

  const updateTaskStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => {
      console.log('Updating task status:', { id, status });
      return tasksAPI.updateTaskStatus(id, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Task status updated');
    },
    onError: (error: any) => {
      console.error('Update task status error:', error);
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to update task status';
      toast.error(errorMessage);
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: async (data: CreateTaskRequest) => {
      console.log('Creating task with data:', data);
      return tasksAPI.createTask(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Task created successfully! 🎉');
      setIsCreateModalOpen(false);
    },
    onError: (error: any) => {
      console.error('Task creation error:', error);
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to create task';
      toast.error(errorMessage);
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (id: string) => tasksAPI.deleteTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Task deleted successfully');
    },
    onError: (error: any) => {
      console.error('Delete task error:', error);
      const errorMessage = error?.response?.data?.message || error?.message || 'Failed to delete task';
      toast.error(errorMessage);
    },
  });

  const tasks = tasksQuery.data?.tasks ?? [];

  // Intelligent task filtering with parsed search syntax
  const filteredTasks = useMemo(() => {
    let filtered = tasks;

    // Apply intelligent search parsing
    if (parsedSearch) {
      const { cleanQuery, mentions, tags, filters: searchFilters } = parsedSearch;

      // Filter by clean text query
      if (cleanQuery) {
        filtered = filtered.filter(
          (task) =>
            task.title.toLowerCase().includes(cleanQuery.toLowerCase()) ||
            task.description?.toLowerCase().includes(cleanQuery.toLowerCase())
        );
      }

      // Filter by @mentions (assignees)
      if (mentions.length > 0) {
        filtered = filtered.filter((task) =>
          mentions.some((mention) =>
            task.assigned_to?.toLowerCase().includes(mention.toLowerCase())
          )
        );
      }

      // Filter by #tags
      if (tags.length > 0 || searchFilters.labels?.length) {
        const allTags = [...tags, ...(searchFilters.labels || [])];
        filtered = filtered.filter((task) =>
          allTags.some((tag) =>
            task.tags?.some((t) => t.toLowerCase().includes(tag.toLowerCase()))
          )
        );
      }

      // Filter by status from search syntax
      if (searchFilters.status?.length) {
        filtered = filtered.filter((task) =>
          searchFilters.status!.includes(task.status)
        );
      }

      // Filter by priority from search syntax
      if (searchFilters.priority?.length) {
        filtered = filtered.filter((task) =>
          searchFilters.priority!.includes(task.priority)
        );
      }

      // Filter by assignees from search syntax
      if (searchFilters.assigned_to?.length) {
        filtered = filtered.filter((task) =>
          searchFilters.assigned_to!.some((assignee: string) =>
            task.assigned_to?.toLowerCase().includes(assignee.toLowerCase())
          )
        );
      }

      // Filter by date ranges
      if (searchFilters.created_after || searchFilters.created_before) {
        filtered = filtered.filter((task) => {
          const taskDate = new Date(task.created_at);
          if (searchFilters.created_after && taskDate < new Date(searchFilters.created_after)) {
            return false;
          }
          if (searchFilters.created_before && taskDate > new Date(searchFilters.created_before)) {
            return false;
          }
          return true;
        });
      }

      if (searchFilters.due_after || searchFilters.due_before) {
        filtered = filtered.filter((task) => {
          if (!task.due_date) return false;
          const dueDate = new Date(task.due_date);
          if (searchFilters.due_after && dueDate < new Date(searchFilters.due_after)) {
            return false;
          }
          if (searchFilters.due_before && dueDate > new Date(searchFilters.due_before)) {
            return false;
          }
          return true;
        });
      }
    } else if (searchQuery) {
      // Simple search fallback
      filtered = filtered.filter(
        (task) =>
          task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          task.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply manual priority filter
    if (filterPriority !== 'ALL') {
      filtered = filtered.filter((task) => task.priority === filterPriority);
    }

    // Apply assignee filter
    if (filterAssignees.length > 0) {
      filtered = filtered.filter((task) =>
        filterAssignees.some((assignee) => task.assigned_to === assignee)
      );
    }

    // Apply tag filter
    if (filterTags.length > 0) {
      filtered = filtered.filter((task) =>
        filterTags.some((tag) => task.tags?.includes(tag))
      );
    }

    return filtered;
  }, [tasks, searchQuery, parsedSearch, filterPriority, filterAssignees, filterTags]);

  const tasksByStatus = useMemo(() => {
    return COLUMNS.reduce((acc, column) => {
      acc[column.id] = filteredTasks.filter((task) => task.status === column.id);
      return acc;
    }, {} as Record<TaskStatus, Task[]>);
  }, [filteredTasks]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const taskId = active.id as string;
    const newStatus = over.id as TaskStatus;
    
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    updateTaskStatusMutation.mutate({ id: taskId, status: newStatus });
  };

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  if (!isHydrated || !isAuthenticated) {
    return null;
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <Card className="border border-white/60 bg-white/75 p-6 shadow-xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Tasks</h1>
              <p className="mt-1 text-sm text-slate-600">
                Manage your tasks across {tasks.length} total items
              </p>
            </div>
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 to-emerald-400 px-6 py-3 font-semibold text-white shadow-lg transition hover:shadow-xl"
            >
              <Plus className="h-5 w-5" />
              Create Task
            </Button>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            {/* Intelligent Search Input */}
            <div className="relative flex-1">
              <Sparkles className="absolute left-4 top-4 h-5 w-5 text-purple-500" />
              <input
                type="text"
                placeholder="Try: @john #urgent status:in_progress created:>7d priority:high"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search tasks with intelligent filters"
                className="h-12 w-full rounded-2xl border border-slate-200 bg-white/70 pl-12 pr-12 text-sm text-slate-900 shadow-sm outline-none transition focus:border-purple-400 focus:ring-2 focus:ring-purple-200"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 hover:bg-slate-100 rounded-full transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4 text-slate-400" />
                </button>
              )}
            </div>

            {/* Search Syntax Help */}
            {parsedSearch?.hasSpecialSyntax && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-wrap items-center gap-2 px-4 py-2 bg-purple-50 dark:bg-purple-900/20 rounded-xl text-xs"
              >
                <Sparkles className="h-3.5 w-3.5 text-purple-600" />
                <span className="text-purple-700 dark:text-purple-300 font-medium">
                  Smart filters applied:
                </span>
                {parsedSearch.mentions.length > 0 && (
                  <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                    @{parsedSearch.mentions.join(', @')}
                  </Badge>
                )}
                {parsedSearch.tags.length > 0 && (
                  <Badge variant="secondary" className="bg-purple-100 text-purple-700">
                    #{parsedSearch.tags.join(', #')}
                  </Badge>
                )}
                {parsedSearch.filters.status && (
                  <Badge variant="secondary" className="bg-amber-100 text-amber-700">
                    status: {parsedSearch.filters.status.join(', ')}
                  </Badge>
                )}
                {parsedSearch.filters.priority && (
                  <Badge variant="secondary" className="bg-rose-100 text-rose-700">
                    priority: {parsedSearch.filters.priority.join(', ')}
                  </Badge>
                )}
              </motion.div>
            )}

            {/* Filter Buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={filterPriority === 'ALL' ? 'default' : 'outline'}
                onClick={() => setFilterPriority('ALL')}
                className="rounded-xl"
                size="sm"
              >
                All Priorities
              </Button>
              <Button
                variant={filterPriority === TaskPriority.CRITICAL ? 'default' : 'outline'}
                onClick={() => setFilterPriority(TaskPriority.CRITICAL)}
                className="rounded-xl"
                size="sm"
              >
                <Flag className="h-3.5 w-3.5 mr-1.5" />
                Critical
              </Button>
              <Button
                variant={filterPriority === TaskPriority.HIGH ? 'default' : 'outline'}
                onClick={() => setFilterPriority(TaskPriority.HIGH)}
                className="rounded-xl"
                size="sm"
              >
                High
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className="rounded-xl"
                size="sm"
              >
                <Filter className="h-3.5 w-3.5 mr-1.5" />
                {showAdvancedFilters ? 'Hide Filters' : 'More Filters'}
              </Button>
            </div>

            {/* Advanced Filters Panel */}
            <AnimatePresence>
              {showAdvancedFilters && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                    {/* Assignee Filter */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        <User className="h-4 w-4 inline-block mr-1.5" />
                        Filter by Assignee
                      </label>
                      <UserSelector
                        value={filterAssignees}
                        onChange={setFilterAssignees}
                        placeholder="Select assignees..."
                        multiple={true}
                      />
                    </div>

                    {/* Tag Filter */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        <Hash className="h-4 w-4 inline-block mr-1.5" />
                        Filter by Tags
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {['urgent', 'bug', 'feature', 'enhancement'].map((tag) => (
                          <Badge
                            key={tag}
                            variant={filterTags.includes(tag) ? 'default' : 'outline'}
                            className="cursor-pointer"
                            onClick={() => {
                              setFilterTags(prev =>
                                prev.includes(tag)
                                  ? prev.filter(t => t !== tag)
                                  : [...prev, tag]
                              );
                            }}
                          >
                            #{tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="grid gap-5 lg:grid-cols-4">
            {COLUMNS.map((column) => (
              <DroppableColumn
                key={column.id}
                id={column.id}
                title={column.title}
                color={column.color}
                tasks={tasksByStatus[column.id]}
                loading={tasksQuery.isLoading}
              >
                {tasksByStatus[column.id].map((task) => (
                  <SortableTaskCard
                    key={task.id}
                    task={task}
                    onDelete={() => deleteTaskMutation.mutate(task.id)}
                    onOpen={() => setSelectedTask(task)}
                  />
                ))}
              </DroppableColumn>
            ))}
          </div>

          <DragOverlay>
            {activeTask && (
              <div className="rotate-3 opacity-80">
                <SortableTaskCard task={activeTask} onDelete={() => {}} />
              </div>
            )}
          </DragOverlay>
        </DndContext>

        <CreateTaskModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSubmit={(data: any) => createTaskMutation.mutate(data)}
        />

        {/* Task Detail Drawer */}
        <AnimatePresence>
          {selectedTask && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 z-40"
                onClick={() => setSelectedTask(null)}
              />
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-white shadow-2xl z-50 overflow-y-auto"
              >
                <div className="p-8">
                  <div className="flex items-start justify-between mb-6">
                    <h2 className="text-2xl font-bold text-slate-900">Task Details</h2>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedTask(null)}
                      className="rounded-xl"
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>

                  <div className="space-y-6">
                    {/* Title */}
                    <div>
                      <label htmlFor="task-title" className="block text-sm font-semibold text-slate-700 mb-2">
                        Title
                      </label>
                      <input
                        id="task-title"
                        type="text"
                        value={selectedTask.title}
                        onChange={(e) => {
                          const updated = { ...selectedTask, title: e.target.value };
                          setSelectedTask(updated);
                        }}
                        onBlur={() => {
                          if (selectedTask.title.trim()) {
                            updateTaskMutation.mutate({
                              id: selectedTask.id,
                              data: { title: selectedTask.title },
                            });
                          }
                        }}
                        aria-label="Task title"
                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <label htmlFor="task-description" className="block text-sm font-semibold text-slate-700 mb-2">
                        Description
                      </label>
                      <textarea
                        id="task-description"
                        value={selectedTask.description || ''}
                        onChange={(e) => {
                          const updated = { ...selectedTask, description: e.target.value };
                          setSelectedTask(updated);
                        }}
                        onBlur={() => {
                          updateTaskMutation.mutate({
                            id: selectedTask.id,
                            data: { description: selectedTask.description },
                          });
                        }}
                        rows={4}
                        aria-label="Task description"
                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none resize-none"
                        placeholder="Add a description..."
                      />
                    </div>

                    {/* Status */}
                    <div>
                      <label htmlFor="task-status" className="block text-sm font-semibold text-slate-700 mb-2">
                        Status
                      </label>
                      <select
                        id="task-status"
                        value={selectedTask.status}
                        onChange={(e) => {
                          const newStatus = e.target.value as TaskStatus;
                          setSelectedTask({ ...selectedTask, status: newStatus });
                          updateTaskStatusMutation.mutate({ id: selectedTask.id, status: newStatus });
                        }}
                        aria-label="Task status"
                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
                      >
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Priority */}
                    <div>
                      <label htmlFor="task-priority" className="block text-sm font-semibold text-slate-700 mb-2">
                        Priority
                      </label>
                      <select
                        id="task-priority"
                        value={selectedTask.priority}
                        onChange={(e) => {
                          const newPriority = e.target.value as TaskPriority;
                          setSelectedTask({ ...selectedTask, priority: newPriority });
                          updateTaskMutation.mutate({
                            id: selectedTask.id,
                            data: { priority: newPriority },
                          });
                        }}
                        aria-label="Task priority"
                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
                      >
                        {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Due Date */}
                    <div>
                      <label htmlFor="task-due-date" className="block text-sm font-semibold text-slate-700 mb-2">
                        <Calendar className="h-4 w-4 inline-block mr-1.5" />
                        Due Date
                      </label>
                      <input
                        id="task-due-date"
                        type="date"
                        value={selectedTask.due_date ? new Date(selectedTask.due_date).toISOString().split('T')[0] : ''}
                        onChange={(e) => {
                          const dateValue = e.target.value;
                          if (dateValue) {
                            const isoDate = new Date(dateValue).toISOString();
                            const updated = { ...selectedTask, due_date: isoDate };
                            setSelectedTask(updated);
                            updateTaskMutation.mutate({
                              id: selectedTask.id,
                              data: { due_date: isoDate },
                            });
                          }
                        }}
                        aria-label="Task due date"
                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
                      />
                    </div>

                    {/* Metadata */}
                    <div className="pt-4 border-t border-slate-200 space-y-2 text-sm text-slate-600">
                      <p>
                        <span className="font-semibold">Created:</span>{' '}
                        {formatDate(selectedTask.created_at)}
                      </p>
                      <p>
                        <span className="font-semibold">Updated:</span>{' '}
                        {formatDate(selectedTask.updated_at)}
                      </p>
                      {selectedTask.assigned_to && (
                        <p>
                          <span className="font-semibold">Assigned to:</span>{' '}
                          {selectedTask.assigned_to}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-4">
                      <Button
                        variant="outline"
                        onClick={() => setSelectedTask(null)}
                        className="flex-1 rounded-xl"
                      >
                        Close
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          deleteTaskMutation.mutate(selectedTask.id);
                          setSelectedTask(null);
                        }}
                        className="rounded-xl"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Task
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </AppShell>
  );
}
