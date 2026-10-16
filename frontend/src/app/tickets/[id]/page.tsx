'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Eye, EyeOff, GitMerge, MoreHorizontal, Play, ShieldAlert, Star, Trash2, Undo2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, Btn, Card, ErrorBlock, Field, LoadingBlock, Menu, MenuItem, Modal, PageHeader, PriorityBadge, SelectBox, SLABadge, StatusBadge, TagInput, Tabs, TextInput, useConfirm, Badge } from '@/components/desk/kit';
import { CategoryPicker, CustomFields, AttachmentList } from '@/components/desk/forms';
import { Markdown } from '@/components/desk/markdown';
import { ActivityPanel, AssociationsPanel, Composer, ConversationThread, TasksPanel, TimePanel } from '@/components/desk/record-panels';
import { WorkItemFromTicket } from '@/components/projects/from-ticket';
import { TicketProjectCard } from '@/components/projects/ticket-project';
import { useAgentOptions, useGroupOptions, useDepartmentOptions } from '@/components/desk/pickers';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useCan, useMe, useTicketFields } from '@/lib/itsm/hooks';
import { LEVELS, PRIORITIES, TICKET_SOURCES, TICKET_STATUSES, fmtDateTime, fmtMoney, labelize, timeAgo, toLocalInput, fromLocalInput } from '@/lib/itsm/format';
import type { Attachment, Scenario, Ticket } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';
import { celebrate } from '@/lib/theme';

interface TicketDetail {
  ticket: Ticket;
  requested_items?: { id: string; name: string; quantity: number; stage: string; cost: number; field_values: Record<string, unknown> }[];
  satisfaction?: { rating: number; feedback: string; created_at: string };
  watching: boolean;
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const can = useCan();
  const confirm = useConfirm();
  const { data: me } = useMe();
  const [tab, setTab] = React.useState('conversation');
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [workItemOpen, setWorkItemOpen] = React.useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['ticket', id], queryFn: () => v2.get<TicketDetail>(`/tickets/${id}`) });
  const attachments = useQuery({ queryKey: ['ticket-attachments', id], queryFn: () => v2.items<Attachment>(`/tickets/${id}/attachments`) });
  const scenarios = useQuery({ queryKey: ['scenarios'], queryFn: () => v2.items<Scenario>('/scenarios'), staleTime: 5 * 60_000 });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ticket', id] });
    qc.invalidateQueries({ queryKey: ['activities', 'tickets', id] });
    qc.invalidateQueries({ queryKey: ['tickets'] });
  };
  const action = useMutation({
    mutationFn: ({ method, path, body }: { method: 'post' | 'del'; path: string; body?: unknown }) => (method === 'post' ? v2.post(path, body) : v2.del(path)),
    onSuccess: (_d, vars) => {
      invalidate();
      if (vars.path.endsWith('/watch')) toast.success(vars.method === 'post' ? 'You are now watching this ticket' : 'Stopped watching');
      else toast.success('Done');
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });

  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock message={parseApiError(error).message} onRetry={() => refetch()} />;
  const t = data.ticket;

  const createProblem = async () => {
    try {
      const p = await v2.post<{ id: string; display_id: string }>('/problems', { ticket_ids: [t.id] });
      toast.success(`${p.display_id} created and linked`);
      router.push(`/problems/${p.id}`);
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  };
  const createChange = async () => {
    try {
      const c = await v2.post<{ id: string; display_id: string }>('/changes', { subject: `Change for ${t.display_id}: ${t.subject}`, description: t.description, ticket_ids: [t.id] });
      toast.success(`${c.display_id} created and linked`);
      router.push(`/changes/${c.id}`);
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Tickets', href: '/tickets' }, { label: t.display_id }]}
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono text-base text-slate-400">{t.display_id}</span>
            {t.subject}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge className={t.type === 'incident' ? 'bg-rose-50 text-rose-700 ring-rose-600/20' : 'bg-violet-50 text-violet-700 ring-violet-600/20'}>{t.type === 'incident' ? 'Incident' : 'Service request'}</Badge>
            <StatusBadge status={t.status} />
            <PriorityBadge priority={t.priority} />
            <SLABadge state={t.sla_state} />
            {t.is_spam && <Badge className="bg-rose-50 text-rose-700 ring-rose-600/20">Spam</Badge>}
            {t.is_deleted && <Badge className="bg-slate-100 text-slate-700 ring-slate-500/20">In trash</Badge>}
            <span className="text-xs text-slate-500">
              Created {timeAgo(t.created_at)} via {labelize(t.source)}
            </span>
          </span>
        }
        actions={
          <>
            <Btn size="sm" variant="ghost" icon={data.watching ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} onClick={() => action.mutate({ method: data.watching ? 'del' : 'post', path: `/tickets/${id}/watch` })}>
              {data.watching ? 'Unwatch' : 'Watch'}
            </Btn>
            {(scenarios.data ?? []).length > 0 && (
              <Menu trigger={() => <Btn size="sm" icon={<Wand2 className="h-4 w-4" />}>Scenarios</Btn>}>
                {(close) =>
                  scenarios.data!.map((s) => (
                    <MenuItem key={s.id} icon={<Play className="h-4 w-4" />} onClick={() => { close(); action.mutate({ method: 'post', path: `/tickets/${id}/scenarios/${s.id}` }); }}>
                      {s.name}
                    </MenuItem>
                  ))
                }
              </Menu>
            )}
            <Btn size="sm" icon={<GitMerge className="h-4 w-4" />} onClick={() => setMergeOpen(true)}>Merge</Btn>
            <Menu trigger={() => <Btn size="sm" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></Btn>}>
              {(close) => (
                <>
                  {can('problems.manage') && <MenuItem onClick={() => { close(); createProblem(); }}>Create problem from ticket</MenuItem>}
                  {can('changes.manage') && <MenuItem onClick={() => { close(); createChange(); }}>Create change from ticket</MenuItem>}
                  {can('tickets.manage') && <MenuItem onClick={() => { close(); setWorkItemOpen(true); }}>Create project work item</MenuItem>}
                  <MenuItem href={`/tickets/new?requester_id=${t.requester_id}`} onClick={close}>New ticket for requester</MenuItem>
                  {can('tickets.delete') && (
                    <>
                      <div className="my-1 border-t border-slate-100" />
                      {t.is_spam ? (
                        <MenuItem icon={<Undo2 className="h-4 w-4" />} onClick={() => { close(); action.mutate({ method: 'post', path: `/tickets/${id}/unspam` }); }}>Not spam</MenuItem>
                      ) : (
                        <MenuItem icon={<ShieldAlert className="h-4 w-4" />} onClick={() => { close(); action.mutate({ method: 'post', path: `/tickets/${id}/spam` }); }}>Mark as spam</MenuItem>
                      )}
                      {t.is_deleted ? (
                        <>
                          <MenuItem icon={<Undo2 className="h-4 w-4" />} onClick={() => { close(); action.mutate({ method: 'post', path: `/tickets/${id}/restore` }); }}>Restore</MenuItem>
                          <MenuItem
                            danger
                            icon={<Trash2 className="h-4 w-4" />}
                            onClick={async () => {
                              close();
                              if (await confirm({ title: 'Delete permanently?', message: 'This removes the ticket, its conversations and attachments. It cannot be undone.', danger: true, confirmLabel: 'Delete forever' })) {
                                await v2.del(`/tickets/${id}/purge`).then(() => { toast.success('Ticket deleted'); router.push('/tickets?view=trash'); }).catch((e) => toast.error(parseApiError(e).message));
                              }
                            }}
                          >
                            Delete permanently
                          </MenuItem>
                        </>
                      ) : (
                        <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onClick={async () => { close(); if (await confirm({ title: 'Move to trash?', danger: true, confirmLabel: 'Move to trash' })) action.mutate({ method: 'del', path: `/tickets/${id}` }); }}>
                          Move to trash
                        </MenuItem>
                      )}
                    </>
                  )}
                </>
              )}
            </Menu>
          </>
        }
      />
      {t.merged_into_id && (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
          This ticket was merged into <Link className="font-medium text-blue-600" href={`/tickets/${t.merged_into_id}`}>another ticket</Link>.
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card padded={false}>
            <div className="flex items-start gap-3 p-4">
              <Avatar name={t.requester?.name} src={t.requester?.avatar_url} />
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  <Link href={`/people/${t.requester_id}`} className="font-semibold text-slate-900 hover:text-blue-700">{t.requester?.name ?? 'Unknown'}</Link>
                  <span className="text-slate-500"> reported {timeAgo(t.created_at)}</span>
                </div>
                <div className="mt-2">
                  <Markdown text={t.description} />
                </div>
                <AttachmentList items={attachments.data ?? []} />
              </div>
            </div>
          </Card>
          {data.requested_items && data.requested_items.length > 0 && <RequestedItems ticketId={id} items={data.requested_items} />}
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'conversation', label: 'Conversation' },
              { value: 'tasks', label: 'Tasks' },
              { value: 'time', label: 'Time' },
              { value: 'associations', label: 'Associations' },
              { value: 'activity', label: 'Activity' },
            ]}
          />
          {tab === 'conversation' && (
            <div className="space-y-5">
              <ConversationThread module="tickets" id={id} />
              {!t.is_deleted && <Composer module="tickets" id={id} ticketId={id} requesterEmail={t.requester?.email} onSent={invalidate} />}
            </div>
          )}
          {tab === 'tasks' && <TasksPanel module="tickets" id={id} canManage={can('tickets.manage')} />}
          {tab === 'time' && <TimePanel module="tickets" id={id} />}
          {tab === 'associations' && <AssociationsPanel module="tickets" id={id} canManage={can('tickets.manage')} allowed={['ticket', 'problem', 'change', 'release', 'asset', 'work_item']} />}
          {tab === 'activity' && <ActivityPanel module="tickets" id={id} />}
        </div>
        <div className="space-y-5">
          <PropertiesPanel ticket={t} onSaved={invalidate} customStatuses={me?.settings.custom_statuses ?? []} />
          {me?.is_agent && <TicketProjectCard ticketId={t.id} canManage={can('tickets.manage')} />}
          <SLACard ticket={t} />
          {data.satisfaction && (
            <Card title="Customer satisfaction">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={cn('h-5 w-5', n <= data.satisfaction!.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200')} />
                ))}
              </div>
              {data.satisfaction.feedback && <p className="mt-2 text-sm italic text-slate-600">“{data.satisfaction.feedback}”</p>}
            </Card>
          )}
          <RequesterCard ticket={t} />
        </div>
      </div>
      <MergeDialog open={mergeOpen} onClose={() => setMergeOpen(false)} ticket={t} onMerged={invalidate} />
      <WorkItemFromTicket open={workItemOpen} onClose={() => setWorkItemOpen(false)} ticket={{ id: t.id, subject: t.subject, display_id: t.display_id, priority: t.priority }} />
    </>
  );
}

function PropertiesPanel({ ticket, onSaved, customStatuses }: { ticket: Ticket; onSaved: () => void; customStatuses: { key: string; label: string }[] }) {
  const fields = useTicketFields();
  const agentOptions = useAgentOptions();
  const groupOptions = useGroupOptions();
  const deptOptions = useDepartmentOptions();
  const initial = React.useMemo(
    () => ({
      status: ticket.status,
      priority: String(ticket.priority),
      urgency: String(ticket.urgency),
      impact: String(ticket.impact),
      type: ticket.type,
      source: ticket.source,
      group_id: ticket.group_id ?? '',
      responder_id: ticket.responder_id ?? '',
      department_id: ticket.department_id ?? '',
      due_by: toLocalInput(ticket.due_by),
      tags: ticket.tags,
    }),
    [ticket]
  );
  const [form, setForm] = React.useState(initial);
  const [category, setCategory] = React.useState({ category: ticket.category, sub_category: ticket.sub_category, item_category: ticket.item_category });
  const [custom, setCustom] = React.useState<Record<string, unknown>>(ticket.custom_fields ?? {});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    setForm(initial);
    setCategory({ category: ticket.category, sub_category: ticket.sub_category, item_category: ticket.item_category });
    setCustom(ticket.custom_fields ?? {});
  }, [initial, ticket]);
  const dirty =
    JSON.stringify(form) !== JSON.stringify(initial) ||
    category.category !== ticket.category || category.sub_category !== ticket.sub_category || category.item_category !== ticket.item_category ||
    JSON.stringify(custom) !== JSON.stringify(ticket.custom_fields ?? {});
  const save = useMutation({
    mutationFn: () =>
      v2.put(`/tickets/${ticket.id}`, {
        status: form.status,
        priority: Number(form.priority),
        urgency: Number(form.urgency),
        impact: Number(form.impact),
        type: form.type,
        source: form.source,
        group_id: form.group_id,
        responder_id: form.responder_id,
        department_id: form.department_id,
        tags: form.tags,
        due_by: form.due_by !== initial.due_by && form.due_by ? fromLocalInput(form.due_by) : undefined,
        custom_fields: custom,
        ...category,
      }),
    onSuccess: () => {
      setErrors({});
      toast.success('Ticket updated');
      if (form.status !== ticket.status && (form.status === 'resolved' || form.status === 'closed')) celebrate();
      onSaved();
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      toast.error(err.message);
    },
  });
  const set = (k: keyof typeof form, v: string | string[]) => setForm((f) => ({ ...f, [k]: v }));
  const statusOptions = [...TICKET_STATUSES, ...customStatuses.map((s) => ({ value: s.key, label: s.label }))];
  return (
    <Card title="Properties" actions={dirty ? <Btn size="xs" variant="ghost" onClick={() => { setForm(initial); setCategory({ category: ticket.category, sub_category: ticket.sub_category, item_category: ticket.item_category }); setCustom(ticket.custom_fields ?? {}); }}>Reset</Btn> : null}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status" error={errors.status}>
            <SelectBox value={form.status} onChange={(v) => set('status', v)} options={statusOptions} />
          </Field>
          <Field label="Priority">
            <SelectBox value={form.priority} onChange={(v) => set('priority', v)} options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} />
          </Field>
          <Field label="Urgency">
            <SelectBox value={form.urgency} onChange={(v) => set('urgency', v)} options={LEVELS} />
          </Field>
          <Field label="Impact">
            <SelectBox value={form.impact} onChange={(v) => set('impact', v)} options={LEVELS} />
          </Field>
          <Field label="Type">
            <SelectBox value={form.type} onChange={(v) => set('type', v)} options={[{ value: 'incident', label: 'Incident' }, { value: 'service_request', label: 'Service request' }]} />
          </Field>
          <Field label="Source">
            <SelectBox value={form.source} onChange={(v) => set('source', v)} options={TICKET_SOURCES} />
          </Field>
        </div>
        <Field label="Group" error={errors.group_id}>
          <SelectBox value={form.group_id} onChange={(v) => set('group_id', v)} placeholder="— None —" options={groupOptions} />
        </Field>
        <Field label="Agent" error={errors.responder_id}>
          <SelectBox value={form.responder_id} onChange={(v) => set('responder_id', v)} placeholder="— Unassigned —" options={agentOptions} />
        </Field>
        <Field label="Department">
          <SelectBox value={form.department_id} onChange={(v) => set('department_id', v)} placeholder="— None —" options={deptOptions} />
        </Field>
        <div className="[&_.grid]:grid-cols-1 [&_.grid]:gap-3">
          <CategoryPicker fields={fields.data} value={category} onChange={setCategory} />
        </div>
        {errors.category && <p className="text-xs text-rose-600">{errors.category}</p>}
        <Field label="Due by">
          <TextInput type="datetime-local" value={form.due_by} onChange={(e) => set('due_by', e.target.value)} />
        </Field>
        <Field label="Tags">
          <TagInput value={form.tags} onChange={(v) => set('tags', v)} />
        </Field>
        <div className="[&_.grid]:grid-cols-1">
          <CustomFields fields={fields.data ?? []} values={custom} onChange={setCustom} errors={errors} />
        </div>
        {Object.entries(errors).filter(([k]) => !['status', 'group_id', 'responder_id', 'category'].includes(k)).map(([k, v]) => (
          <p key={k} className="text-xs text-rose-600">{v}</p>
        ))}
        <Btn variant="primary" className="w-full" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
          Update
        </Btn>
      </div>
    </Card>
  );
}

function SLACard({ ticket }: { ticket: Ticket }) {
  const row = (label: string, due: string | null, doneAt: string | null, escalated: boolean) => {
    const overdue = !doneAt && due && new Date(due) < new Date();
    const missed = doneAt && due && new Date(doneAt) > new Date(due);
    return (
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
          <div className="text-sm text-slate-900">{due ? fmtDateTime(due) : '—'}</div>
        </div>
        <div className="text-right text-xs">
          {doneAt ? (
            <span className={missed ? 'text-rose-600' : 'text-emerald-600'}>{missed ? 'Missed' : 'Met'} · {timeAgo(doneAt)}</span>
          ) : overdue || escalated ? (
            <span className="font-medium text-rose-600">Overdue</span>
          ) : due ? (
            <span className="text-slate-500">{timeAgo(due)}</span>
          ) : null}
        </div>
      </div>
    );
  };
  return (
    <Card title={<span className="flex items-center gap-1.5"><AlarmClock className="h-4 w-4 text-slate-400" /> SLA</span>}>
      <div className="space-y-3">
        {ticket.pending_since && <div className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">Timer paused while pending since {fmtDateTime(ticket.pending_since)}</div>}
        {row('First response due', ticket.fr_due_by, ticket.first_responded_at, ticket.fr_escalated)}
        {row('Resolution due', ticket.due_by, ticket.resolved_at, ticket.is_escalated)}
      </div>
    </Card>
  );
}

function RequesterCard({ ticket }: { ticket: Ticket }) {
  const { data } = useQuery({
    queryKey: ['person', ticket.requester_id],
    queryFn: () => v2.get<{ person: { name: string; email: string; job_title: string; phone: string; department: { name: string } | null; location: { name: string } | null; vip: boolean }; stats: { open: number; resolved: number } }>(`/people/${ticket.requester_id}`),
  });
  const p = data?.person;
  return (
    <Card title="Requester">
      <div className="flex items-center gap-3">
        <Avatar name={ticket.requester?.name} src={ticket.requester?.avatar_url} />
        <div className="min-w-0">
          <Link href={`/people/${ticket.requester_id}`} className="block truncate text-sm font-semibold text-slate-900 hover:text-blue-700">
            {ticket.requester?.name} {p?.vip && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">VIP</span>}
          </Link>
          <div className="truncate text-xs text-slate-500">{ticket.requester?.email}</div>
        </div>
      </div>
      {p && (
        <dl className="mt-3 space-y-1.5 text-sm">
          {p.job_title && <div className="flex justify-between gap-2"><dt className="text-slate-500">Title</dt><dd className="text-right text-slate-800">{p.job_title}</dd></div>}
          {p.department && <div className="flex justify-between gap-2"><dt className="text-slate-500">Department</dt><dd className="text-right text-slate-800">{p.department.name}</dd></div>}
          {p.location && <div className="flex justify-between gap-2"><dt className="text-slate-500">Location</dt><dd className="text-right text-slate-800">{p.location.name}</dd></div>}
          {p.phone && <div className="flex justify-between gap-2"><dt className="text-slate-500">Phone</dt><dd className="text-right text-slate-800">{p.phone}</dd></div>}
          {data?.stats && <div className="flex justify-between gap-2"><dt className="text-slate-500">Tickets</dt><dd className="text-right text-slate-800">{data.stats.open} open · {data.stats.resolved} resolved</dd></div>}
        </dl>
      )}
      {ticket.cc_emails.length > 0 && <div className="mt-3 text-xs text-slate-500">CC: {ticket.cc_emails.join(', ')}</div>}
    </Card>
  );
}

function RequestedItems({ ticketId, items }: { ticketId: string; items: NonNullable<TicketDetail['requested_items']> }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) => v2.put(`/requested-items/${id}`, { stage }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticket', ticketId] }),
    onError: (e) => toast.error(parseApiError(e).message),
  });
  return (
    <Card title="Requested items">
      <ul className="divide-y divide-slate-100">
        {items.map((it) => (
          <li key={it.id} className="flex flex-wrap items-start justify-between gap-3 py-2">
            <div>
              <div className="text-sm font-medium text-slate-900">
                {it.name} × {it.quantity} <span className="ml-1 text-xs font-normal text-slate-500">{fmtMoney(it.cost)}</span>
              </div>
              <dl className="mt-1 grid grid-cols-1 gap-x-4 text-xs text-slate-600 sm:grid-cols-2">
                {Object.entries(it.field_values ?? {}).map(([k, v]) => (
                  <div key={k}>
                    <span className="text-slate-400">{labelize(k)}:</span> {Array.isArray(v) ? v.join(', ') : String(v === true ? 'Yes' : v === false ? 'No' : v ?? '')}
                  </div>
                ))}
              </dl>
            </div>
            <SelectBox
              aria-label="Stage"
              value={it.stage}
              onChange={(v) => update.mutate({ id: it.id, stage: v })}
              className="w-40"
              options={[
                { value: 'requested', label: 'Awaiting approval' },
                { value: 'in_progress', label: 'In progress' },
                { value: 'delivered', label: 'Delivered' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MergeDialog({ open, onClose, ticket, onMerged }: { open: boolean; onClose: () => void; ticket: Ticket; onMerged: () => void }) {
  const [q, setQ] = React.useState('');
  const [picked, setPicked] = React.useState<Ticket[]>([]);
  const [note, setNote] = React.useState('');
  const results = useQuery({
    queryKey: ['merge-search', q, ticket.requester_id],
    queryFn: () => v2.list<Ticket>('/tickets', { q, requester_id: q ? undefined : ticket.requester_id, view: 'all', per_page: 10 }),
    enabled: open,
  });
  const merge = useMutation({
    mutationFn: () => v2.post(`/tickets/${ticket.id}/merge`, { ticket_ids: picked.map((p) => p.id), note }),
    onSuccess: () => {
      toast.success('Tickets merged');
      setPicked([]);
      onClose();
      onMerged();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const candidates = (results.data?.items ?? []).filter((x) => x.id !== ticket.id && !picked.some((p) => p.id === x.id));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Merge into ${ticket.display_id}`}
      size="lg"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={!picked.length} loading={merge.isPending} onClick={() => merge.mutate()}>
            Merge {picked.length || ''} ticket{picked.length === 1 ? '' : 's'}
          </Btn>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">Conversations from the selected tickets move into this one and the selected tickets are closed.</p>
      {picked.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {picked.map((p) => (
            <button key={p.id} onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700">
              {p.display_id} ✕
            </button>
          ))}
        </div>
      )}
      <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tickets (defaults to this requester's tickets)" />
      <ul className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
        {candidates.map((c) => (
          <li key={c.id}>
            <button onClick={() => setPicked([...picked, c])} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
              <span className="font-mono text-xs text-slate-500">{c.display_id}</span>
              <span className="truncate">{c.subject}</span>
              <span className="ml-auto"><StatusBadge status={c.status} /></span>
            </button>
          </li>
        ))}
        {candidates.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">No other tickets found</li>}
      </ul>
      <Field label="Note (optional)" className="mt-3">
        <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why are these tickets being merged?" />
      </Field>
    </Modal>
  );
}
