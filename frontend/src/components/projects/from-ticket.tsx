'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { v2, parseApiError } from '@/lib/itsm/api';
import type { Project, WorkItem } from '@/lib/itsm/types';
import { WORK_ITEM_PRIORITIES, WORK_ITEM_STATES } from '@/lib/itsm/projects';
import { Btn, EmptyState, Field, LoadingBlock, Modal, SelectBox, TextInput } from '@/components/desk/kit';

const TICKET_TO_WORK_PRIORITY: Record<number, string> = { 4: 'urgent', 3: 'high', 2: 'medium', 1: 'low' };

/** Turns a ticket into project work, linked back to the ticket. */
export function WorkItemFromTicket({ open, onClose, ticket }: {
  open: boolean;
  onClose: () => void;
  ticket: { id: string; subject: string; display_id: string; priority: number };
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ['projects', { archived: false, q: '' }], queryFn: () => v2.items<Project>('/projects'), enabled: open });
  const editable = (projects.data ?? []).filter((p) => p.can_edit);
  const [projectId, setProjectId] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [state, setState] = React.useState('todo');
  const [priority, setPriority] = React.useState('none');
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (!open) return;
    setTitle(ticket.subject);
    setState('todo');
    setPriority(TICKET_TO_WORK_PRIORITY[ticket.priority] ?? 'none');
    setError('');
  }, [open, ticket.subject, ticket.priority]);
  React.useEffect(() => {
    if (open && !projectId && editable.length) setProjectId(editable[0].id);
  }, [open, projectId, editable]);

  const create = useMutation({
    mutationFn: () => v2.post<WorkItem>(`/projects/${projectId}/work-items`, { title, state, priority, ticket_id: ticket.id }),
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ['associations', 'tickets', ticket.id] });
      qc.invalidateQueries({ queryKey: ['activities', 'tickets', ticket.id] });
      qc.invalidateQueries({ queryKey: ['work-items', projectId] });
      toast.success(`${item.display_id} created and linked to ${ticket.display_id}`, {
        action: { label: 'Open', onClick: () => router.push(`/projects/${item.project_id}?item=${item.id}`) },
      });
      onClose();
    },
    onError: (e) => setError(parseApiError(e).message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Create work item from ${ticket.display_id}`}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={create.isPending} disabled={!projectId || !title.trim()} onClick={() => create.mutate()}>Create work item</Btn>
        </>
      }
    >
      {projects.isLoading ? (
        <LoadingBlock />
      ) : editable.length === 0 ? (
        <EmptyState title="No projects you can add work to" description="Ask a project lead to add you as a member, or create a project first." />
      ) : (
        <div className="space-y-3">
          <Field label="Project" required>
            <SelectBox value={projectId} onChange={setProjectId} options={editable.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))} />
          </Field>
          <Field label="Title" required>
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State">
              <SelectBox value={state} onChange={setState} options={WORK_ITEM_STATES} />
            </Field>
            <Field label="Priority">
              <SelectBox value={priority} onChange={setPriority} options={WORK_ITEM_PRIORITIES} />
            </Field>
          </div>
          <p className="text-xs text-slate-500">The ticket description is copied to the work item, and the two are linked so either side shows the other.</p>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
