'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, FolderKanban, Lock, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useCan } from '@/lib/itsm/hooks';
import type { Project, WorkItem } from '@/lib/itsm/types';
import { PROJECT_STATUSES, fmtDay, isOverdue, stateLabel } from '@/lib/itsm/projects';
import { Avatar, Badge, Btn, EmptyState, ErrorBlock, LoadingBlock, PageHeader, SearchInput, Tabs } from '@/components/desk/kit';
import { useDebounced } from '@/components/desk/pickers';
import { PriorityIcon, StateIcon } from '@/components/projects/icons';
import { CreateProjectModal } from '@/components/projects/forms';

const STATUS_TONE: Record<string, string> = {
  planned: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  active: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  on_hold: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
};

function ProjectsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const can = useCan();
  const tab = params.get('tab') ?? 'active';
  const [q, setQ] = React.useState('');
  const term = useDebounced(q.trim(), 250);
  const [creating, setCreating] = React.useState(false);
  const setTab = (t: string) => router.replace(t === 'active' ? '/projects' : `/projects?tab=${t}`);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        subtitle="Plan and track team work on boards, lists and calendars."
        icon={<FolderKanban className="h-5 w-5" />}
        actions={can('projects.manage') && <Btn variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New project</Btn>}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'active', label: 'Projects' },
            { value: 'mine', label: 'Assigned to me' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
        {tab !== 'mine' && <SearchInput value={q} onChange={setQ} placeholder="Search projects…" className="w-full sm:w-72" />}
      </div>
      {tab === 'mine' ? <MyWorkItems /> : <ProjectGrid archived={tab === 'archived'} q={term} onCreate={can('projects.manage') ? () => setCreating(true) : undefined} />}
      <CreateProjectModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function ProjectGrid({ archived, q, onCreate }: { archived: boolean; q: string; onCreate?: () => void }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['projects', { archived, q }],
    queryFn: () => v2.items<Project>('/projects', { archived: archived ? 'true' : undefined, q: q || undefined }),
  });
  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={parseApiError(error).message} onRetry={() => refetch()} />;
  const projects = data ?? [];
  if (projects.length === 0) {
    return (
      <EmptyState
        icon={<FolderKanban className="h-6 w-6" />}
        title={q ? `No projects match “${q}”` : archived ? 'No archived projects' : 'No projects yet'}
        description={!q && !archived ? 'Create a project to plan work items on a board with your team.' : undefined}
        action={!q && !archived && onCreate ? <Btn variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onCreate}>New project</Btn> : undefined}
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
    </div>
  );
}

function ProjectCard({ project: p }: { project: Project }) {
  const statusLabel = PROJECT_STATUSES.find((s) => s.value === p.status)?.label ?? p.status;
  return (
    <Link href={`/projects/${p.id}`} className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: p.color || '#2563eb' }}>
          {p.key.slice(0, 3)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-slate-900 group-hover:text-blue-700">{p.name}</h3>
            {p.visibility === 'private' && <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="Private project" />}
          </div>
          <div className="text-xs text-slate-500">{p.key}</div>
        </div>
        <Badge className={STATUS_TONE[p.status]}>{statusLabel}</Badge>
      </div>
      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-slate-600">{p.description || <span className="text-slate-400">No description</span>}</p>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>{p.open_items} open · {p.total_items} total</span>
          <span>{p.progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${p.progress}%` }} />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex -space-x-1.5">
          {p.members.slice(0, 5).map((m) => (
            <span key={m.id} title={m.name} className="rounded-full ring-2 ring-white">
              <Avatar name={m.name} src={m.avatar_url} size="xs" />
            </span>
          ))}
          {p.members.length > 5 && <span className="flex h-6 items-center rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-600 ring-2 ring-white">+{p.members.length - 5}</span>}
        </div>
        {(p.start_date || p.end_date) && (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <CalendarDays className="h-3.5 w-3.5" />
            {p.end_date ? `Target ${fmtDay(p.end_date, true)}` : `Started ${fmtDay(p.start_date, true)}`}
          </span>
        )}
      </div>
    </Link>
  );
}

function MyWorkItems() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['my-work-items'], queryFn: () => v2.items<WorkItem>('/me/work-items') });
  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={parseApiError(error).message} onRetry={() => refetch()} />;
  const items = data ?? [];
  if (items.length === 0) return <EmptyState title="Nothing assigned to you" description="Open work items assigned to you in any project show up here." />;
  const groups = new Map<string, WorkItem[]>();
  items.forEach((w) => groups.set(w.project_id, [...(groups.get(w.project_id) ?? []), w]));
  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([pid, list]) => {
        const project = list[0].project;
        return (
          <section key={pid} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-white" style={{ background: project?.color || '#2563eb' }}>{project?.key}</span>
              <Link href={`/projects/${pid}`} className="text-sm font-semibold text-slate-800 hover:text-blue-700">{project?.name}</Link>
              <span className="text-xs text-slate-500">{list.length}</span>
            </header>
            <ul>
              {list.map((w) => (
                <li key={w.id} className="border-b border-slate-100 last:border-0">
                  <Link href={`/projects/${pid}?item=${w.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50">
                    <StateIcon state={w.state} />
                    <span className="w-[72px] shrink-0 text-xs font-medium text-slate-500">{w.display_id}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{w.title}</span>
                    <span className="hidden text-xs text-slate-500 sm:inline">{stateLabel(w.state)}</span>
                    <PriorityIcon priority={w.priority} />
                    {w.due_date && <span className={cn('w-24 text-right text-xs', isOverdue(w) ? 'font-medium text-rose-600' : 'text-slate-500')}>Due {fmtDay(w.due_date)}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default function Page() {
  return (
    <React.Suspense fallback={<LoadingBlock />}>
      <ProjectsPage />
    </React.Suspense>
  );
}
