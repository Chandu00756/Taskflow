'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { v2, parseApiError } from '@/lib/itsm/api';
import type { Project, TicketProjectLink } from '@/lib/itsm/types';
import { Btn, Card, Field, SelectBox, useConfirm } from '@/components/desk/kit';
import { StateIcon } from './icons';

/** Statuses a ticket can have in its project; they are the work item's states. */
export const TICKET_PROJECT_STATES = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

/** Active projects the current agent can add work to. */
export function useEditableProjects(enabled = true) {
  return useQuery({
    queryKey: ['projects', 'editable'],
    queryFn: () => v2.items<Project>('/projects'),
    select: (list) => list.filter((p) => p.can_edit && !p.archived),
    enabled,
    staleTime: 60_000,
  });
}

/** Project and project status on the ticket page, kept in sync with the work item. */
export function TicketProjectCard({ ticketId, canManage }: { ticketId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = ['ticket-project', ticketId];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => v2.get<{ link: TicketProjectLink | null }>(`/tickets/${ticketId}/project`), refetchInterval: 30_000 });
  const projects = useEditableProjects(canManage);
  const [projectId, setProjectId] = React.useState('');
  const [state, setState] = React.useState('todo');
  const link = data?.link ?? null;
  const done = (r: { link: TicketProjectLink | null }) => {
    qc.setQueryData(key, r);
    qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
    qc.invalidateQueries({ queryKey: ['activities', 'tickets', ticketId] });
    if (r.link) qc.invalidateQueries({ queryKey: ['work-items', r.link.project.id] });
  };
  const save = useMutation({
    mutationFn: (body: { project_id: string; state: string }) => v2.put<{ link: TicketProjectLink | null }>(`/tickets/${ticketId}/project`, body),
    onSuccess: (r, body) => {
      done(r);
      toast.success(link && link.project.id === body.project_id ? 'Project status updated' : `Added to ${r.link?.project.name ?? 'the project'}`);
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const unlink = useMutation({
    mutationFn: () => v2.del<{ link: null }>(`/tickets/${ticketId}/project`),
    onSuccess: (r) => {
      done(r);
      toast.success('Removed from the project; the work item is kept');
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  if (isLoading) return null;
  return (
    <Card title={<span className="flex items-center gap-1.5"><FolderKanban className="h-4 w-4 text-slate-400" /> Project</span>}>
      {link ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="rounded px-1.5 py-0.5 text-xs font-semibold text-white" style={{ background: link.project.color || '#2563eb' }}>{link.project.key}</span>
            <Link href={`/projects/${link.project.id}`} className="truncate text-sm font-medium text-slate-800 hover:underline">{link.project.name}</Link>
          </div>
          <Link href={`/projects/${link.project.id}?item=${link.work_item.id}`} className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-sm hover:border-blue-300">
            <StateIcon state={link.work_item.state as 'todo'} />
            <span className="text-xs text-slate-500">{link.work_item.display_id}</span>
            <span className="truncate text-slate-700">{link.work_item.title}</span>
          </Link>
          <Field label="Project status" hint="Same status as the work item; changing either updates both.">
            <SelectBox
              value={link.work_item.state}
              disabled={!canManage || !link.can_edit || save.isPending}
              onChange={(v) => save.mutate({ project_id: link.project.id, state: v })}
              options={[...TICKET_PROJECT_STATES, ...(TICKET_PROJECT_STATES.some((s) => s.value === link.work_item.state) ? [] : [{ value: link.work_item.state, label: link.work_item.state.replace('_', ' ') }])]}
            />
          </Field>
          {canManage && (
            <Btn
              size="sm"
              variant="ghost"
              icon={<Unlink className="h-4 w-4" />}
              loading={unlink.isPending}
              onClick={async () => {
                if (await confirm({ title: `Remove from ${link.project.name}?`, message: `The ticket stops following ${link.work_item.display_id}. The work item stays in the project.`, confirmLabel: 'Remove' })) unlink.mutate();
              }}
            >
              Remove from project
            </Btn>
          )}
        </div>
      ) : canManage ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">Track this ticket on a project board. Its status there and here stay in sync.</p>
          <Field label="Project">
            <SelectBox value={projectId} onChange={setProjectId} placeholder={projects.data?.length ? 'Choose a project' : 'No projects you can add to'} options={(projects.data ?? []).map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))} />
          </Field>
          <Field label="Status">
            <SelectBox value={state} onChange={setState} options={TICKET_PROJECT_STATES} />
          </Field>
          <Btn size="sm" variant="primary" disabled={!projectId} loading={save.isPending} onClick={() => save.mutate({ project_id: projectId, state })}>Add to project</Btn>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Not part of a project.</p>
      )}
    </Card>
  );
}

/** Project + status fields for the new ticket form. */
export function NewTicketProjectFields({ projectId, state, onChange }: { projectId: string; state: string; onChange: (v: { project_id: string; project_state: string }) => void }) {
  const projects = useEditableProjects();
  if (!projects.data?.length) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Project" hint="Optional: also track the ticket on a project board">
        <SelectBox value={projectId} onChange={(v) => onChange({ project_id: v, project_state: state || 'todo' })} options={[{ value: '', label: 'None' }, ...projects.data.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))]} />
      </Field>
      {projectId && (
        <Field label="Project status">
          <SelectBox value={state || 'todo'} onChange={(v) => onChange({ project_id: projectId, project_state: v })} options={TICKET_PROJECT_STATES} />
        </Field>
      )}
    </div>
  );
}
