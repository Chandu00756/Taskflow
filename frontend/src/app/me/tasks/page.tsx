'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, Checkbox, EmptyState, LoadingBlock, PageHeader, StatusBadge } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';
import { fmtDateTime, labelize } from '@/lib/itsm/format';
import type { WorkTask } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';

const ROUTES: Record<string, string> = { ticket: '/tickets/', problem: '/problems/', change: '/changes/', release: '/releases/' };

export default function MyTasksPage() {
  const qc = useQueryClient();
  const [showDone, setShowDone] = React.useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['my-tasks', showDone], queryFn: () => v2.items<WorkTask>('/me/tasks', { include_completed: showDone ? 'true' : undefined }) });
  const toggle = useMutation({
    mutationFn: (t: WorkTask) => v2.put(`/tasks/${t.id}`, { status: t.status === 'completed' ? 'open' : 'completed' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-tasks'] }),
    onError: (e) => toast.error(parseApiError(e).message),
  });
  return (
    <>
      <PageHeader title="My tasks" subtitle="Tasks assigned to you across tickets, problems, changes and releases." actions={<Checkbox checked={showDone} onChange={setShowDone} label="Show completed" />} />
      <Card padded={false}>
        {isLoading ? <LoadingBlock /> : (data ?? []).length === 0 ? <EmptyState title="No tasks assigned to you" description="Tasks assigned to you on any record appear here." /> : (
          <ul className="divide-y divide-slate-100">
            {data!.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <button aria-label="Toggle task" onClick={() => toggle.mutate(t)} className="text-slate-400 hover:text-emerald-600">
                  {t.status === 'completed' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={cn('text-sm', t.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-900')}>{t.title}</div>
                  <div className="text-xs text-slate-500">
                    <Link href={`${ROUTES[t.entity_type]}${t.entity_id}`} className="text-blue-600 hover:underline">Open {labelize(t.entity_type).toLowerCase()}</Link>
                    {t.due_date && <span className={cn('ml-2', new Date(t.due_date) < new Date() && t.status !== 'completed' && 'text-rose-600')}>Due {fmtDateTime(t.due_date)}</span>}
                  </div>
                </div>
                {t.status === 'in_progress' && <StatusBadge status="in_progress" />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
