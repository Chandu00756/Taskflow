'use client';

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { v2, parseApiError } from '@/lib/itsm/api';
import type { Cycle, Project, WorkItem } from '@/lib/itsm/types';
import { celebrate } from '@/lib/theme';

export interface WorkItemFilters {
  q?: string;
  state?: string[];
  priority?: string[];
  assignee_id?: string;
  cycle_id?: string;
  label?: string;
  parent_id?: string;
}

export function useProject(id: string) {
  return useQuery({ queryKey: ['project', id], queryFn: () => v2.get<Project>(`/projects/${id}`), enabled: !!id });
}

export function useWorkItems(projectId: string, filters: WorkItemFilters) {
  const params = {
    q: filters.q || undefined,
    state: filters.state?.join(',') || undefined,
    priority: filters.priority?.join(',') || undefined,
    assignee_id: filters.assignee_id || undefined,
    cycle_id: filters.cycle_id || undefined,
    label: filters.label || undefined,
    parent_id: filters.parent_id || undefined,
  };
  return useQuery({
    queryKey: ['work-items', projectId, params],
    queryFn: () => v2.get<{ items: WorkItem[]; total: number }>(`/projects/${projectId}/work-items`, params).then((r) => r.items),
    enabled: !!projectId,
    placeholderData: (prev) => prev,
  });
}

export function useCycles(projectId: string) {
  return useQuery({ queryKey: ['cycles', projectId], queryFn: () => v2.items<Cycle>(`/projects/${projectId}/cycles`), enabled: !!projectId });
}

/** Every label used in the project, for label pickers. */
export function useProjectLabels(projectId: string) {
  return useQuery({
    queryKey: ['project-labels', projectId],
    queryFn: () =>
      v2.get<{ items: WorkItem[] }>(`/projects/${projectId}/work-items`).then((r) => Array.from(new Set(r.items.flatMap((w) => w.labels))).sort()),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export type WorkItemPatch = Partial<{
  title: string;
  description: string;
  state: string;
  priority: string;
  assignee_id: string;
  parent_id: string;
  cycle_id: string;
  labels: string[];
  estimate: number;
  start_date: string;
  due_date: string;
  sort_order: number;
}>;

/** Updates a work item with an optimistic change to every cached list. */
export function useUpdateWorkItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: WorkItemPatch }) => v2.put<WorkItem>(`/work-items/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['work-items', projectId] });
      const snapshots = qc.getQueriesData<WorkItem[]>({ queryKey: ['work-items', projectId] });
      const simple: Partial<WorkItem> = {};
      (['title', 'state', 'priority', 'sort_order', 'start_date', 'due_date', 'labels'] as const).forEach((k) => {
        if (patch[k] !== undefined) (simple as Record<string, unknown>)[k] = patch[k] === '' ? null : patch[k];
      });
      qc.setQueriesData<WorkItem[]>({ queryKey: ['work-items', projectId] }, (old) =>
        Array.isArray(old) ? old.map((w) => (w.id === id ? { ...w, ...simple } : w)) : old
      );
      return { snapshots };
    },
    onError: (err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]: [QueryKey, unknown]) => qc.setQueryData(key, data));
      toast.error(parseApiError(err).message);
    },
    onSuccess: (item, vars) => {
      if (vars.patch.state === 'done') celebrate();
      qc.setQueriesData<WorkItem[]>({ queryKey: ['work-items', projectId] }, (old) =>
        Array.isArray(old) ? old.map((w) => (w.id === item.id ? { ...w, ...item } : w)) : old
      );
      qc.setQueryData(['work-item', item.id], (old: WorkItem | undefined) => (old ? { ...old, ...item } : item));
    },
    onSettled: (item) => {
      qc.invalidateQueries({ queryKey: ['work-items', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['cycles', projectId] });
      qc.invalidateQueries({ queryKey: ['project-labels', projectId] });
      if (item) {
        qc.invalidateQueries({ queryKey: ['activities', 'work-items', item.id] });
        if (item.parent_id) qc.invalidateQueries({ queryKey: ['work-item', item.parent_id] });
      }
    },
  });
}

export function useCreateWorkItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkItemPatch & { title: string; ticket_id?: string }) => v2.post<WorkItem>(`/projects/${projectId}/work-items`, body),
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ['work-items', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      if (item.cycle_id) qc.invalidateQueries({ queryKey: ['cycles', projectId] });
      if (item.parent_id) qc.invalidateQueries({ queryKey: ['work-item', item.parent_id] });
    },
    onError: (err) => toast.error(parseApiError(err).message),
  });
}

export function useDeleteWorkItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => v2.del(`/work-items/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-items', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      qc.invalidateQueries({ queryKey: ['cycles', projectId] });
      toast.success('Work item deleted');
    },
    onError: (err) => toast.error(parseApiError(err).message),
  });
}
