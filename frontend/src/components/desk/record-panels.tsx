'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Circle, Clock, Link2, Lock, MessageSquare, Pause, Pencil, Play, Plus, Reply, Forward, StickyNote, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useMe } from '@/lib/itsm/hooks';
import type { Activity, Association, CannedResponse, Conversation, TimeEntry, WorkTask } from '@/lib/itsm/types';
import { fmtDate, fmtDateTime, fmtMinutes, labelize, timeAgo, toLocalInput, fromLocalInput } from '@/lib/itsm/format';
import { Avatar, Btn, Checkbox, EmptyState, Field, LoadingBlock, Menu, MenuItem, Modal, MultiSelect, SelectBox, StatusBadge, TextArea, TextInput, useConfirm } from './kit';
import { Markdown } from './markdown';
import { AttachmentInput, AttachmentList } from './forms';
import { useAgentOptions, useGroupOptions } from './pickers';

export type Module = 'tickets' | 'problems' | 'changes' | 'releases' | 'work-items';

// ---------------------------------------------------------------------------
// Conversation thread
// ---------------------------------------------------------------------------

export function ConversationThread({ module, id, portal = false }: { module: Module; id: string; portal?: boolean }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({
    queryKey: ['conversations', module, id],
    queryFn: () => v2.items<Conversation>(`/${module}/${id}/conversations`),
    refetchInterval: 30_000,
  });
  const [editing, setEditing] = React.useState<Conversation | null>(null);
  const [editBody, setEditBody] = React.useState('');
  const save = useMutation({
    mutationFn: () => v2.put(`/conversations/${editing!.id}`, { body: editBody }),
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['conversations', module, id] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const remove = useMutation({
    mutationFn: (cid: string) => v2.del(`/conversations/${cid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations', module, id] }),
    onError: (e) => toast.error(parseApiError(e).message),
  });
  if (isLoading) return <LoadingBlock />;
  const items = data ?? [];
  if (items.length === 0) return <p className="py-4 text-center text-sm text-slate-400">No conversations yet.</p>;
  return (
    <ol className="space-y-4">
      {items.map((c) => {
        const mine = c.user_id === me?.user.id;
        const isNote = c.kind === 'note' || c.kind === 'forward';
        return (
          <li key={c.id} className="flex gap-3">
            <Avatar name={c.author?.name} src={c.author?.avatar_url} size="md" />
            <div
              className={cn(
                'min-w-0 flex-1 rounded-lg border px-4 py-3',
                c.private ? 'border-amber-200 bg-amber-50/70' : c.incoming || !c.author?.is_agent ? 'border-slate-200 bg-white' : 'border-blue-100 bg-blue-50/40'
              )}
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span className="text-sm font-semibold text-slate-900">{c.author?.name ?? 'Unknown'}</span>
                {c.kind === 'reply' && <span className="inline-flex items-center gap-1"><Reply className="h-3 w-3" />{c.incoming ? 'replied' : 'responded'}</span>}
                {c.kind === 'note' && <span className="inline-flex items-center gap-1">{c.private ? <Lock className="h-3 w-3" /> : <StickyNote className="h-3 w-3" />}{c.private ? 'added a private note' : 'added a public note'}</span>}
                {c.kind === 'forward' && <span className="inline-flex items-center gap-1"><Forward className="h-3 w-3" />forwarded to {c.to_emails.join(', ')}</span>}
                <span title={fmtDateTime(c.created_at)}>· {timeAgo(c.created_at)}</span>
                {!portal && mine && isNote && (
                  <span className="ml-auto flex gap-1">
                    {c.kind === 'note' && (
                      <button aria-label="Edit note" onClick={() => { setEditing(c); setEditBody(c.body); }} className="rounded p-1 hover:bg-white">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      aria-label="Delete"
                      onClick={async () => (await confirm({ title: 'Delete this note?', danger: true, confirmLabel: 'Delete' })) && remove.mutate(c.id)}
                      className="rounded p-1 hover:bg-white"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
              {c.cc_emails.length > 0 && <div className="mb-1 text-xs text-slate-500">CC: {c.cc_emails.join(', ')}</div>}
              <Markdown text={c.body} />
              <AttachmentList items={c.attachments} />
            </div>
          </li>
        );
      })}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit note"
        footer={
          <>
            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Btn>
          </>
        }
      >
        <TextArea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={8} />
      </Modal>
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export function Composer({ module, id, modes = ['reply', 'note', 'forward'], ticketId, onSent, defaultMode, requesterEmail }: {
  module: Module;
  id: string;
  modes?: ('reply' | 'note' | 'forward')[];
  ticketId?: string;
  onSent?: () => void;
  defaultMode?: 'reply' | 'note' | 'forward';
  requesterEmail?: string;
}) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [mode, setMode] = React.useState<'reply' | 'note' | 'forward'>(defaultMode ?? modes[0]);
  const [body, setBody] = React.useState('');
  const [cc, setCc] = React.useState('');
  const [to, setTo] = React.useState('');
  const [isPrivate, setPrivate] = React.useState(true);
  const [notify, setNotify] = React.useState<string[]>([]);
  const [files, setFiles] = React.useState<{ id: string; name: string; size: number }[]>([]);
  const agentOptions = useAgentOptions();
  const canned = useQuery({
    queryKey: ['canned'],
    queryFn: () => v2.get<{ items: CannedResponse[] }>('/canned-responses'),
    enabled: !!me?.is_agent,
    staleTime: 5 * 60_000,
  });
  const send = useMutation({
    mutationFn: (status?: string) => {
      const path = mode === 'note' ? 'notes' : mode;
      return v2.post(`/${module}/${id}/${path}`, {
        body,
        private: mode === 'note' ? isPrivate : undefined,
        cc_emails: cc.split(/[,;\s]+/).filter(Boolean),
        to_emails: to.split(/[,;\s]+/).filter(Boolean),
        attachment_ids: files.map((f) => f.id),
        notify_ids: notify,
        status,
      });
    },
    onSuccess: () => {
      toast.success(mode === 'reply' ? 'Reply sent' : mode === 'note' ? 'Note added' : 'Forwarded');
      setBody('');
      setCc('');
      setTo('');
      setFiles([]);
      setNotify([]);
      qc.invalidateQueries({ queryKey: ['conversations', module, id] });
      qc.invalidateQueries({ queryKey: ['activities', module, id] });
      qc.invalidateQueries({ queryKey: [module.slice(0, -1), id] });
      onSent?.();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const insertCanned = async (c: CannedResponse) => {
    try {
      const res = await v2.get<{ content: string }>(`/canned-responses/${c.id}/render`, { ticket_id: ticketId });
      setBody((b) => (b ? b + '\n\n' : '') + res.content);
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  };
  const insertSignature = () => me?.user.signature && setBody((b) => `${b}\n\n${me.user.signature}`);
  const labels = { reply: 'Reply', note: 'Add note', forward: 'Forward' };
  const icons = { reply: Reply, note: StickyNote, forward: Forward };
  return (
    <div className={cn('rounded-lg border bg-white shadow-sm', mode === 'note' ? 'border-amber-300' : 'border-slate-200')}>
      {modes.length > 1 && (
        <div className="flex border-b border-slate-100">
          {modes.map((m) => {
            const Icon = icons[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn('flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium', mode === m ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800')}
              >
                <Icon className="h-4 w-4" /> {labels[m]}
              </button>
            );
          })}
        </div>
      )}
      <div className="space-y-2 p-3">
        {mode === 'reply' && requesterEmail && <div className="text-xs text-slate-500">To: {requesterEmail}</div>}
        {mode === 'forward' && <TextInput value={to} onChange={(e) => setTo(e.target.value)} placeholder="To: email addresses" />}
        {mode === 'reply' && me?.is_agent && <TextInput value={cc} onChange={(e) => setCc(e.target.value)} placeholder="CC (optional)" />}
        <TextArea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder={mode === 'note' ? 'Write a note for your team…' : 'Type your message…'}
          className={mode === 'note' ? 'bg-amber-50/40' : ''}
        />
        {mode === 'note' && (
          <div className="flex flex-wrap items-center gap-4">
            <Checkbox checked={isPrivate} onChange={setPrivate} label="Private (visible to agents only)" />
            <div className="min-w-[220px] flex-1">
              <MultiSelect value={notify} onChange={setNotify} options={agentOptions} placeholder="Notify agents…" />
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <AttachmentInput value={files} onChange={setFiles} />
          {me?.is_agent && (canned.data?.items ?? []).length > 0 && (
            <Menu align="left" trigger={() => <Btn size="sm" variant="ghost" icon={<MessageSquare className="h-4 w-4" />}>Canned responses</Btn>}>
              {(close) => (
                <div className="max-h-72 overflow-y-auto">
                  {canned.data!.items.map((c) => (
                    <MenuItem key={c.id} onClick={() => { close(); insertCanned(c); }}>{c.title}</MenuItem>
                  ))}
                </div>
              )}
            </Menu>
          )}
          {me?.is_agent && me.user.signature && mode !== 'note' && (
            <Btn size="sm" variant="ghost" onClick={insertSignature}>Insert signature</Btn>
          )}
          <div className="ml-auto flex items-center gap-2">
            {mode === 'reply' && module === 'tickets' && me?.is_agent && (
              <Menu trigger={() => <Btn size="sm" disabled={!body.trim() || send.isPending}>Send and set as…</Btn>}>
                {(close) => (
                  <>
                    {['pending', 'resolved', 'closed'].map((s) => (
                      <MenuItem key={s} onClick={() => { close(); send.mutate(s); }}>{labelize(s)}</MenuItem>
                    ))}
                  </>
                )}
              </Menu>
            )}
            <Btn variant="primary" size="sm" disabled={!body.trim()} loading={send.isPending} onClick={() => send.mutate(undefined)}>
              {mode === 'reply' ? 'Send' : mode === 'note' ? 'Add note' : 'Forward'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function TasksPanel({ module, id, canManage }: { module: Module; id: string; canManage: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = ['tasks', module, id];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => v2.items<WorkTask>(`/${module}/${id}/tasks`) });
  const [editing, setEditing] = React.useState<Partial<WorkTask> | null>(null);
  const agentOptions = useAgentOptions();
  const groupOptions = useGroupOptions();
  const save = useMutation({
    mutationFn: (t: Partial<WorkTask>) => {
      const body = { title: t.title, description: t.description, status: t.status, due_date: t.due_date ?? '', agent_id: t.agent_id ?? '', group_id: t.group_id ?? '' };
      return t.id ? v2.put(`/tasks/${t.id}`, body) : v2.post(`/${module}/${id}/tasks`, body);
    },
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ['activities', module, id] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const del = useMutation({
    mutationFn: (tid: string) => v2.del(`/tasks/${tid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(parseApiError(e).message),
  });
  if (isLoading) return <LoadingBlock />;
  const tasks = data ?? [];
  const done = tasks.filter((t) => t.status === 'completed').length;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-slate-500">{tasks.length ? `${done} of ${tasks.length} completed` : 'Break the work into tasks and assign them.'}</span>
        {canManage && <Btn size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ title: '', status: 'open' })}>Add task</Btn>}
      </div>
      {tasks.length === 0 ? (
        <EmptyState title="No tasks yet" />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-start gap-3 px-3 py-2.5">
              <button
                aria-label={t.status === 'completed' ? 'Reopen task' : 'Complete task'}
                onClick={() => save.mutate({ ...t, status: t.status === 'completed' ? 'open' : 'completed' })}
                className="mt-0.5 text-slate-400 hover:text-emerald-600"
              >
                {t.status === 'completed' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className={cn('text-sm', t.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-900')}>{t.title}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                  {t.agent && <span>{t.agent.name}</span>}
                  {t.group && <span>{t.group.name}</span>}
                  {t.due_date && <span className={cn(new Date(t.due_date) < new Date() && t.status !== 'completed' && 'text-rose-600')}>Due {fmtDateTime(t.due_date)}</span>}
                  {t.status === 'in_progress' && <StatusBadge status="in_progress" />}
                </div>
              </div>
              <div className="flex gap-1">
                <button aria-label="Edit task" onClick={() => setEditing(t)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
                {canManage && (
                  <button aria-label="Delete task" onClick={async () => (await confirm({ title: 'Delete task?', danger: true, confirmLabel: 'Delete' })) && del.mutate(t.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit task' : 'New task'}
        footer={
          <>
            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn variant="primary" loading={save.isPending} onClick={() => editing && save.mutate(editing)}>Save</Btn>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <Field label="Title" required>
              <TextInput value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </Field>
            <Field label="Description">
              <TextArea value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <SelectBox value={editing.status ?? 'open'} onChange={(v) => setEditing({ ...editing, status: v as WorkTask['status'] })} options={[{ value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'completed', label: 'Completed' }]} />
              </Field>
              <Field label="Due">
                <TextInput type="datetime-local" value={toLocalInput(editing.due_date)} onChange={(e) => setEditing({ ...editing, due_date: fromLocalInput(e.target.value) || null })} />
              </Field>
              <Field label="Agent">
                <SelectBox value={editing.agent_id ?? ''} onChange={(v) => setEditing({ ...editing, agent_id: v || null })} placeholder="—" options={agentOptions} />
              </Field>
              <Field label="Group">
                <SelectBox value={editing.group_id ?? ''} onChange={(v) => setEditing({ ...editing, group_id: v || null })} placeholder="—" options={groupOptions} />
              </Field>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time entries
// ---------------------------------------------------------------------------

export function TimePanel({ module, id }: { module: Module; id: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = ['time', module, id];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => v2.get<{ items: (TimeEntry & { agent: { name: string } | null })[]; total_minutes: number }>(`/${module}/${id}/time-entries`),
    refetchInterval: 60_000,
  });
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ hours: '0', minutes: '30', note: '', billable: true });
  const { data: me } = useMe();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['activities', module, id] });
  };
  const add = useMutation({
    mutationFn: (timer: boolean) =>
      v2.post(`/${module}/${id}/time-entries`, timer ? { start_timer: true, note: form.note, billable: form.billable } : { minutes: Number(form.hours) * 60 + Number(form.minutes), note: form.note, billable: form.billable }),
    onSuccess: () => {
      setOpen(false);
      setForm({ hours: '0', minutes: '30', note: '', billable: true });
      refresh();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const toggle = useMutation({ mutationFn: (tid: string) => v2.post(`/time-entries/${tid}/toggle`), onSuccess: refresh, onError: (e) => toast.error(parseApiError(e).message) });
  const del = useMutation({ mutationFn: (tid: string) => v2.del(`/time-entries/${tid}`), onSuccess: refresh, onError: (e) => toast.error(parseApiError(e).message) });
  if (isLoading) return <LoadingBlock />;
  const items = data?.items ?? [];
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-slate-600">
          Total logged: <span className="font-semibold text-slate-900">{fmtMinutes(data?.total_minutes ?? 0)}</span>
        </span>
        <div className="flex gap-2">
          <Btn size="sm" icon={<Play className="h-4 w-4" />} onClick={() => add.mutate(true)}>Start timer</Btn>
          <Btn size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Log time</Btn>
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No time logged" icon={<Clock className="h-6 w-6" />} />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {items.map((t) => {
            const running = t.timer_running && t.started_at;
            const elapsed = running ? Math.floor((Date.now() - new Date(t.started_at!).getTime()) / 60000) : 0;
            return (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar name={t.agent?.name} src={t.agent?.avatar_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-900">
                    <span className="font-semibold tabular-nums">{fmtMinutes(t.minutes + elapsed)}</span>
                    {running && <span className="ml-2 rounded bg-emerald-50 px-1.5 text-xs font-medium text-emerald-700">running</span>}
                    {!t.billable && <span className="ml-2 text-xs text-slate-500">non-billable</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {t.agent?.name} · {fmtDate(t.executed_at)}
                    {t.note && ` · ${t.note}`}
                  </div>
                </div>
                {t.agent_id === me?.user.id && (
                  <>
                    <button aria-label={running ? 'Stop timer' : 'Resume timer'} onClick={() => toggle.mutate(t.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                      {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                    <button aria-label="Delete entry" onClick={async () => (await confirm({ title: 'Delete time entry?', danger: true, confirmLabel: 'Delete' })) && del.mutate(t.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Log time"
        size="sm"
        footer={
          <>
            <Btn onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" loading={add.isPending} onClick={() => add.mutate(false)}>Save</Btn>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hours">
              <TextInput type="number" min={0} max={24} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
            </Field>
            <Field label="Minutes">
              <TextInput type="number" min={0} max={59} value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
            </Field>
          </div>
          <Field label="Note">
            <TextArea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} />
          </Field>
          <Checkbox checked={form.billable} onChange={(v) => setForm({ ...form, billable: v })} label="Billable" />
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Associations
// ---------------------------------------------------------------------------

const TYPE_ROUTES: Record<string, string> = { ticket: '/tickets/', problem: '/problems/', change: '/changes/', release: '/releases/', asset: '/assets/' };

function associationHref(a: Association) {
  if (a.type === 'work_item') return `/projects/${a.project_id}?item=${a.id}`;
  return `${TYPE_ROUTES[a.type]}${a.id}`;
}

export function AssociationsPanel({ module, id, canManage, allowed = ['ticket', 'problem', 'change', 'release', 'asset'] }: { module: Module | 'assets'; id: string; canManage: boolean; allowed?: string[] }) {
  const qc = useQueryClient();
  const key = ['associations', module, id];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => v2.items<Association>(`/${module}/${id}/associations`) });
  const [open, setOpen] = React.useState(false);
  const [targetType, setTargetType] = React.useState(allowed[0]);
  const [q, setQ] = React.useState('');
  const results = useQuery({
    queryKey: ['assoc-search', targetType, q],
    queryFn: () => v2.get<{ results: { type: string; id: string; display_id: string; title: string }[] }>('/search', { q }),
    enabled: open && q.length >= 2,
  });
  const link = useMutation({
    mutationFn: (target: { id: string; type: string }) => v2.post(`/${module}/${id}/associations`, { target_type: target.type, target_id: target.id, link_type: 'related' }),
    onSuccess: () => {
      setOpen(false);
      setQ('');
      qc.invalidateQueries({ queryKey: key });
      toast.success('Linked');
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const unlink = useMutation({
    mutationFn: (linkId: string) => v2.del(`/associations/${linkId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(parseApiError(e).message),
  });
  if (isLoading) return <LoadingBlock />;
  const items = data ?? [];
  const groups = allowed.map((t) => ({ type: t, items: items.filter((i) => i.type === t) })).filter((g) => g.items.length);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-slate-500">Linked records help trace incidents to problems, changes and affected assets.</span>
        {canManage && <Btn size="sm" icon={<Link2 className="h-4 w-4" />} onClick={() => setOpen(true)}>Link record</Btn>}
      </div>
      {groups.length === 0 ? (
        <EmptyState title="No associations" />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.type}>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{labelize(g.type)}s</div>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {g.items.map((a) => (
                  <li key={a.link_id} className="flex items-center gap-3 px-3 py-2">
                    <Link href={associationHref(a)} className="min-w-0 flex-1 truncate text-sm text-slate-800 hover:text-blue-700">
                      <span className="mr-2 font-mono text-xs text-slate-500">{a.display_id}</span>
                      {a.title}
                    </Link>
                    <span className="text-xs text-slate-400">{labelize(a.link_type)}</span>
                    <StatusBadge status={a.status} />
                    {canManage && (
                      <button aria-label="Unlink" onClick={() => unlink.mutate(a.link_id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Link a record">
        <div className="space-y-3">
          <Field label="Record type">
            <SelectBox value={targetType} onChange={setTargetType} options={allowed.map((t) => ({ value: t, label: labelize(t) }))} />
          </Field>
          <TextInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by number or title…" />
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
            {(results.data?.results ?? [])
              .filter((r) => r.type === targetType && r.id !== id)
              .map((r) => (
                <li key={r.id}>
                  <button onClick={() => link.mutate({ id: r.id, type: r.type })} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <span className="font-mono text-xs text-slate-500">{r.display_id}</span>
                    <span className="truncate">{r.title}</span>
                    <ArrowRight className="ml-auto h-4 w-4 text-slate-300" />
                  </button>
                </li>
              ))}
            {q.length >= 2 && !results.isFetching && (results.data?.results ?? []).filter((r) => r.type === targetType).length === 0 && (
              <li className="px-3 py-3 text-sm text-slate-500">No matching {labelize(targetType).toLowerCase()}s</li>
            )}
          </ul>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity timeline
// ---------------------------------------------------------------------------

/** Turns raw change values (ids, codes) into readable text for one field. */
export type ActivityResolver = (field: string, value: unknown) => string | undefined;

export function ActivityPanel({ module, id, resolve }: { module: Module; id: string; resolve?: ActivityResolver }) {
  const { data, isLoading } = useQuery({ queryKey: ['activities', module, id], queryFn: () => v2.items<Activity>(`/${module}/${id}/activities`) });
  if (isLoading) return <LoadingBlock />;
  return <ActivityList items={data ?? []} resolve={resolve} />;
}

export function ActivityList({ items, resolve }: { items: Activity[]; resolve?: ActivityResolver }) {
  if (items.length === 0) return <EmptyState title="No activity yet" />;
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-5">
      {items.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-300" />
          <div className="text-sm text-slate-800">
            <span className="font-medium">{a.actor?.name ?? 'System'}</span> {a.summary}
          </div>
          {a.changes && a.changes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
              {a.changes.map((c, i) => (
                <li key={i}>
                  <span className="font-medium text-slate-600">{labelize(c.field.replace(/_id$/, ''))}</span>: {resolve?.(c.field, c.from) ?? fmtVal(c.from)} → {resolve?.(c.field, c.to) ?? fmtVal(c.to)}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-0.5 text-[11px] text-slate-400" title={fmtDateTime(a.created_at)}>
            {timeAgo(a.created_at)}
          </div>
        </li>
      ))}
    </ol>
  );
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'none';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return fmtDate(s);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(s)) return '…' + s.slice(-6);
  return labelize(s);
}
