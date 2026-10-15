'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { CornerDownRight, Hash, Link as LinkIcon, MoreHorizontal, Pencil, Trash2, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useMe } from '@/lib/itsm/hooks';
import type { Conversation, Cycle, Project, WorkItem } from '@/lib/itsm/types';
import { fmtDateTime, timeAgo } from '@/lib/itsm/format';
import { fmtDay, isOverdue, priorityLabel, stateLabel } from '@/lib/itsm/projects';
import { Avatar, Btn, EmptyState, LoadingBlock, Menu, MenuItem, Spinner, Tabs, TextArea, useConfirm } from '@/components/desk/kit';
import { Markdown } from '@/components/desk/markdown';
import { AttachmentInput, AttachmentList } from '@/components/desk/forms';
import { ActivityPanel, AssociationsPanel, type ActivityResolver } from '@/components/desk/record-panels';
import { StateIcon } from './icons';
import { AssigneeSelect, CycleSelect, DateSelect, LabelsSelect, PrioritySelect, StateSelect } from './properties';
import { QuickAdd } from './board';
import { useCreateWorkItem, useDeleteWorkItem, useUpdateWorkItem, useWorkItems, type WorkItemPatch } from './hooks';

function useEscape(onClose: () => void) {
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // Let open dropdowns and inputs handle Escape first.
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      // A confirm dialog stacked on top closes first.
      if (document.querySelectorAll('[role="dialog"]').length > 1) return;
      onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

export function WorkItemPeek({ id, project, cycles, labels, onClose, onOpen }: {
  id: string;
  project: Project;
  cycles: Cycle[];
  labels: string[];
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  useEscape(onClose);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Work item details"
        onMouseDown={(e) => e.stopPropagation()}
        className="dialog-panel dialog-side flex h-full w-full max-w-[960px] flex-col bg-white shadow-2xl"
      >
        <PeekBody key={id} id={id} project={project} cycles={cycles} labels={labels} onClose={onClose} onOpen={onOpen} />
      </div>
    </div>,
    document.body
  );
}

function PeekBody({ id, project, cycles, labels, onClose, onOpen }: {
  id: string;
  project: Project;
  cycles: Cycle[];
  labels: string[];
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const confirm = useConfirm();
  const { data: item, isLoading, error } = useQuery({ queryKey: ['work-item', id], queryFn: () => v2.get<WorkItem>(`/work-items/${id}`) });
  const update = useUpdateWorkItem(project.id);
  const del = useDeleteWorkItem(project.id);
  const qc = useQueryClient();
  const [tab, setTab] = React.useState('comments');

  if (isLoading) return <LoadingBlock />;
  if (error || !item) {
    return (
      <div className="p-6">
        <EmptyState title="Work item not found" description={error ? parseApiError(error).message : undefined} action={<Btn onClick={onClose}>Close</Btn>} />
      </div>
    );
  }
  const editable = !!item.can_edit;
  const patch = (p: WorkItemPatch) =>
    update.mutate(
      { id: item.id, patch: p },
      { onSuccess: (w) => qc.setQueryData(['work-item', item.id], (old: WorkItem | undefined) => ({ ...(old ?? w), ...w, can_edit: old?.can_edit ?? editable })) }
    );

  const resolve: ActivityResolver = (field, value) => {
    if (value === null || value === undefined || value === '') return 'none';
    const v = String(value);
    if (field === 'assignee_id') return project.members.find((m) => m.id === v)?.name ?? 'former member';
    if (field === 'cycle_id') return cycles.find((c) => c.id === v)?.name ?? 'deleted cycle';
    if (field === 'state') return stateLabel(v);
    if (field === 'priority') return priorityLabel(v);
    if (field === 'start_date' || field === 'due_date') return fmtDay(v, true);
    if (field === 'parent_id') return 'another work item';
    return undefined;
  };

  const copyLink = () => {
    const url = `${window.location.origin}/projects/${project.id}?item=${item.id}`;
    navigator.clipboard?.writeText(url).then(() => toast.success('Link copied'), () => toast.error('Could not copy the link'));
  };

  return (
    <>
      <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        <span className="inline-flex h-6 items-center rounded px-1.5 text-xs font-semibold text-white" style={{ background: project.color || '#2563eb' }}>
          {project.key}
        </span>
        <span className="text-sm text-slate-500">{project.name}</span>
        <span className="text-sm text-slate-300">/</span>
        <span className="text-sm font-medium text-slate-700">{item.display_id}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={copyLink} aria-label="Copy link" title="Copy link" className="rounded p-1.5 text-slate-500 hover:bg-slate-100">
            <LinkIcon className="h-4 w-4" />
          </button>
          {editable && (
            <Menu trigger={() => <span className="block rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></span>}>
              {(close) => (
                <MenuItem
                  danger
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={async () => {
                    close();
                    if (await confirm({ title: `Delete ${item.display_id}?`, message: 'The work item, its comments and links are removed. Sub-items are kept and moved to the top level.', confirmLabel: 'Delete', danger: true })) {
                      del.mutate(item.id, { onSuccess: onClose });
                    }
                  }}
                >
                  Delete work item
                </MenuItem>
              )}
            </Menu>
          )}
          <button onClick={onClose} aria-label="Close" className="rounded p-1.5 text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="min-w-0 flex-1 space-y-6 px-6 py-5 lg:overflow-y-auto">
          {item.parent && (
            <button onClick={() => onOpen(item.parent!.id)} className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200">
              <CornerDownRight className="h-3.5 w-3.5" />
              Sub-item of <span className="font-medium">{item.parent.display_id}</span> {item.parent.title}
            </button>
          )}
          <TitleEditor value={item.title} editable={editable} onSave={(title) => patch({ title })} />
          <DescriptionEditor value={item.description} editable={editable} onSave={(description) => patch({ description })} />
          <SubItems item={item} project={project} onOpen={onOpen} />
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Linked records</h3>
            <AssociationsPanel module="work-items" id={item.id} canManage={editable} allowed={['ticket', 'work_item', 'problem', 'change', 'release', 'asset']} />
          </section>
          <section>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'comments', label: 'Comments', count: item.comments },
                { value: 'activity', label: 'Activity' },
              ]}
            />
            <div className="pt-4">
              {tab === 'comments' ? <Comments id={item.id} onPosted={() => qc.invalidateQueries({ queryKey: ['work-items', project.id] })} /> : <ActivityPanel module="work-items" id={item.id} resolve={resolve} />}
            </div>
          </section>
        </div>

        <aside className="shrink-0 border-t border-slate-100 bg-slate-50/50 px-4 py-5 lg:w-80 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Properties</h3>
          <dl className="space-y-0.5">
            <Prop label="State"><StateSelect variant="field" value={item.state} disabled={!editable} onChange={(state) => patch({ state })} /></Prop>
            <Prop label="Priority"><PrioritySelect variant="field" value={item.priority} disabled={!editable} onChange={(priority) => patch({ priority })} /></Prop>
            <Prop label="Assignee"><AssigneeSelect variant="field" value={item.assignee} members={project.members} disabled={!editable} onChange={(assignee_id) => patch({ assignee_id })} /></Prop>
            <Prop label="Start date"><DateSelect variant="field" label="Start date" value={item.start_date} disabled={!editable} onChange={(start_date) => patch({ start_date })} /></Prop>
            <Prop label="Due date"><DateSelect variant="field" label="Due date" value={item.due_date} tone={isOverdue(item) ? 'overdue' : undefined} disabled={!editable} onChange={(due_date) => patch({ due_date })} /></Prop>
            <Prop label="Cycle"><CycleSelect variant="field" value={item.cycle} cycles={cycles} disabled={!editable} onChange={(cycle_id) => patch({ cycle_id })} /></Prop>
            <Prop label="Labels"><LabelsSelect variant="field" value={item.labels} suggestions={labels} disabled={!editable} onChange={(l) => patch({ labels: l })} /></Prop>
            <Prop label="Estimate"><EstimateField value={item.estimate} editable={editable} onSave={(estimate) => patch({ estimate })} /></Prop>
            <Prop label="Parent"><ParentField item={item} project={project} editable={editable} onSave={(parent_id) => patch({ parent_id })} /></Prop>
          </dl>
          <dl className="mt-5 space-y-2 border-t border-slate-200 px-2 pt-4 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <dt className="w-20 shrink-0">Reporter</dt>
              <dd className="flex min-w-0 items-center gap-1.5 text-slate-700">
                {item.reporter ? <><Avatar name={item.reporter.name} src={item.reporter.avatar_url} size="xs" /><span className="truncate">{item.reporter.name}</span></> : <><UserRound className="h-3.5 w-3.5" />Unknown</>}
              </dd>
            </div>
            <div className="flex gap-2"><dt className="w-20 shrink-0">Created</dt><dd className="text-slate-700" title={fmtDateTime(item.created_at)}>{timeAgo(item.created_at)}</dd></div>
            <div className="flex gap-2"><dt className="w-20 shrink-0">Updated</dt><dd className="text-slate-700" title={fmtDateTime(item.updated_at)}>{timeAgo(item.updated_at)}</dd></div>
            {item.completed_at && <div className="flex gap-2"><dt className="w-20 shrink-0">Completed</dt><dd className="text-slate-700">{fmtDateTime(item.completed_at)}</dd></div>}
          </dl>
        </aside>
      </div>
    </>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="w-24 shrink-0 px-2 pt-2 text-xs text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function TitleEditor({ value, editable, onSave }: { value: string; editable: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = React.useState(value);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => setDraft(value), [value]);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [draft]);
  const commit = () => {
    const t = draft.trim();
    if (!t) setDraft(value);
    else if (t !== value) onSave(t);
  };
  if (!editable) return <h2 className="text-xl font-semibold text-slate-900">{value}</h2>;
  return (
    <textarea
      ref={ref}
      rows={1}
      value={draft}
      aria-label="Title"
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className="w-full resize-none overflow-hidden rounded-md border border-transparent px-1 py-0.5 text-xl font-semibold text-slate-900 outline-none hover:border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
    />
  );
}

function DescriptionEditor({ value, editable, onSave }: { value: string; editable: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  if (editing) {
    return (
      <div className="space-y-2">
        <TextArea
          autoFocus
          rows={8}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              onSave(draft);
              setEditing(false);
            }
          }}
          placeholder="Describe the work. Markdown is supported."
        />
        <div className="flex items-center gap-2">
          <Btn size="sm" variant="primary" onClick={() => { onSave(draft); setEditing(false); }}>Save</Btn>
          <Btn size="sm" onClick={() => { setDraft(value); setEditing(false); }}>Cancel</Btn>
          <span className="text-xs text-slate-400">⌘/Ctrl + Enter to save</span>
        </div>
      </div>
    );
  }
  if (!value) {
    return editable ? (
      <button onClick={() => setEditing(true)} className="w-full rounded-md border border-dashed border-slate-200 px-3 py-4 text-left text-sm text-slate-400 hover:border-slate-300 hover:text-slate-600">
        Add a description…
      </button>
    ) : (
      <p className="text-sm text-slate-400">No description</p>
    );
  }
  return (
    <div className="group relative">
      <Markdown text={value} className="text-sm" />
      {editable && (
        <button onClick={() => setEditing(true)} aria-label="Edit description" className="absolute right-0 top-0 rounded p-1 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 focus:opacity-100">
          <Pencil className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function EstimateField({ value, editable, onSave }: { value: number | null; editable: boolean; onSave: (v: number) => void }) {
  const [draft, setDraft] = React.useState(value ? String(value) : '');
  React.useEffect(() => setDraft(value ? String(value) : ''), [value]);
  const commit = () => {
    const n = draft.trim() === '' ? 0 : Math.round(Number(draft));
    if (Number.isNaN(n) || n < 0) {
      setDraft(value ? String(value) : '');
      return;
    }
    if (n !== (value ?? 0)) onSave(n);
  };
  return (
    <div className="flex h-8 items-center gap-2 px-2">
      <Hash className="h-3.5 w-3.5 text-slate-400" />
      <input
        type="number"
        min={0}
        max={1000}
        disabled={!editable}
        value={draft}
        aria-label="Estimate in points"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        placeholder="Points"
        className="w-20 rounded border border-transparent bg-transparent px-1 text-sm text-slate-700 outline-none hover:border-slate-200 focus:border-blue-400 disabled:hover:border-transparent"
      />
    </div>
  );
}

function ParentField({ item, project, editable, onSave }: { item: WorkItem; project: Project; editable: boolean; onSave: (id: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const { data: all = [] } = useWorkItems(project.id, {});
  const candidates = all.filter((w) => w.id !== item.id && w.parent_id !== item.id && (!q || `${w.display_id} ${w.title}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 30);
  if (!open) {
    return (
      <button
        disabled={!editable}
        onClick={() => setOpen(true)}
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <CornerDownRight className="h-3.5 w-3.5 text-slate-400" />
        <span className={cn('truncate', !item.parent && 'text-slate-400')}>{item.parent ? `${item.parent.display_id} ${item.parent.title}` : 'No parent'}</span>
      </button>
    );
  }
  return (
    <div className="rounded-md border border-slate-200 bg-white p-1.5 shadow-sm">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} placeholder="Search work items…" className="w-full rounded px-1.5 py-1 text-sm outline-none" />
      <ul className="max-h-56 overflow-y-auto">
        {item.parent && (
          <li>
            <button onClick={() => { setOpen(false); onSave(''); }} className="w-full rounded px-1.5 py-1 text-left text-sm text-rose-600 hover:bg-slate-50">Remove parent</button>
          </li>
        )}
        {candidates.map((w) => (
          <li key={w.id}>
            <button onClick={() => { setOpen(false); onSave(w.id); }} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-slate-50">
              <StateIcon state={w.state} className="h-3.5 w-3.5" />
              <span className="text-xs text-slate-500">{w.display_id}</span>
              <span className="truncate">{w.title}</span>
            </button>
          </li>
        ))}
      </ul>
      <button onClick={() => setOpen(false)} className="mt-1 w-full rounded px-1.5 py-1 text-left text-xs text-slate-500 hover:bg-slate-50">Cancel</button>
    </div>
  );
}

function SubItems({ item, project, onOpen }: { item: WorkItem; project: Project; onOpen: (id: string) => void }) {
  const { data: subs = [], isLoading } = useWorkItems(project.id, { parent_id: item.id });
  const create = useCreateWorkItem(project.id);
  const update = useUpdateWorkItem(project.id);
  const [adding, setAdding] = React.useState(false);
  const qc = useQueryClient();
  const done = subs.filter((s) => s.state === 'done' || s.state === 'cancelled').length;
  const editable = !!item.can_edit;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Sub-work items</h3>
        {subs.length > 0 && (
          <>
            <span className="text-xs text-slate-500">{done}/{subs.length} done</span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(done / subs.length) * 100}%` }} />
            </div>
          </>
        )}
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {subs.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-2 py-1.5">
              <StateSelect variant="icon" value={s.state} disabled={!editable} onChange={(state) => update.mutate({ id: s.id, patch: { state } }, { onSettled: () => qc.invalidateQueries({ queryKey: ['work-item', item.id] }) })} />
              <button onClick={() => onOpen(s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="text-xs text-slate-500">{s.display_id}</span>
                <span className={cn('truncate text-sm', s.state === 'done' || s.state === 'cancelled' ? 'text-slate-400 line-through' : 'text-slate-800')}>{s.title}</span>
              </button>
              {s.assignee && <Avatar name={s.assignee.name} src={s.assignee.avatar_url} size="xs" />}
            </li>
          ))}
          {editable && (
            <li className="px-1 py-1">
              <QuickAdd
                open={adding}
                onOpenChange={setAdding}
                onCreate={(title) =>
                  create.mutateAsync({ title, parent_id: item.id, state: 'todo', cycle_id: item.cycle_id ?? undefined }).then(() => qc.invalidateQueries({ queryKey: ['work-item', item.id] }))
                }
              />
            </li>
          )}
          {!editable && subs.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No sub-work items</li>}
        </ul>
      )}
    </section>
  );
}

function Comments({ id, onPosted }: { id: string; onPosted: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const confirm = useConfirm();
  const key = ['conversations', 'work-items', id];
  const { data = [], isLoading } = useQuery({ queryKey: key, queryFn: () => v2.items<Conversation>(`/work-items/${id}/conversations`) });
  const [body, setBody] = React.useState('');
  const [files, setFiles] = React.useState<{ id: string; name: string; size: number }[]>([]);
  const [editing, setEditing] = React.useState<{ id: string; body: string } | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['work-item', id] });
    qc.invalidateQueries({ queryKey: ['activities', 'work-items', id] });
    onPosted();
  };
  const post = useMutation({
    mutationFn: () => v2.post(`/work-items/${id}/notes`, { body, private: false, attachment_ids: files.map((f) => f.id) }),
    onSuccess: () => {
      setBody('');
      setFiles([]);
      refresh();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const save = useMutation({
    mutationFn: (c: { id: string; body: string }) => v2.put(`/conversations/${c.id}`, { body: c.body }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const remove = useMutation({
    mutationFn: (cid: string) => v2.del(`/conversations/${cid}`),
    onSuccess: refresh,
    onError: (e) => toast.error(parseApiError(e).message),
  });
  return (
    <div className="space-y-4">
      {isLoading ? (
        <Spinner />
      ) : data.length === 0 ? (
        <p className="text-sm text-slate-400">No comments yet.</p>
      ) : (
        <ul className="space-y-4">
          {data.map((c) => {
            const mine = c.user_id === me?.user.id;
            return (
              <li key={c.id} className="flex gap-3">
                <Avatar name={c.author?.name} src={c.author?.avatar_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="text-sm font-medium text-slate-800">{c.author?.name ?? 'Someone'}</span>
                    <span title={fmtDateTime(c.created_at)}>{timeAgo(c.created_at)}</span>
                    {c.updated_at !== c.created_at && <span>(edited)</span>}
                    {(mine || me?.is_account_admin) && editing?.id !== c.id && (
                      <span className="ml-auto flex gap-1">
                        {mine && (
                          <button onClick={() => setEditing({ id: c.id, body: c.body })} aria-label="Edit comment" className="rounded p-1 hover:bg-slate-100"><Pencil className="h-3.5 w-3.5" /></button>
                        )}
                        <button
                          onClick={async () => {
                            if (await confirm({ title: 'Delete comment?', confirmLabel: 'Delete', danger: true })) remove.mutate(c.id);
                          }}
                          aria-label="Delete comment"
                          className="rounded p-1 hover:bg-slate-100 hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                  </div>
                  {editing?.id === c.id ? (
                    <div className="mt-1 space-y-2">
                      <TextArea rows={3} value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} />
                      <div className="flex gap-2">
                        <Btn size="xs" variant="primary" loading={save.isPending} disabled={!editing.body.trim()} onClick={() => save.mutate(editing)}>Save</Btn>
                        <Btn size="xs" onClick={() => setEditing(null)}>Cancel</Btn>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 rounded-lg bg-slate-50 px-3 py-2">
                      <Markdown text={c.body} className="text-sm" />
                      {c.attachments.length > 0 && <div className="mt-2"><AttachmentList items={c.attachments} /></div>}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex gap-3">
        <Avatar name={me?.user.name} src={me?.user.avatar_url} size="sm" />
        <div className="min-w-0 flex-1 space-y-2">
          <TextArea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) post.mutate();
            }}
            placeholder="Add a comment… (Markdown supported)"
            aria-label="Add a comment"
          />
          <div className="flex items-center justify-between gap-2">
            <AttachmentInput value={files} onChange={setFiles} compact />
            <Btn size="sm" variant="primary" loading={post.isPending} disabled={!body.trim()} onClick={() => post.mutate()}>
              Comment
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
