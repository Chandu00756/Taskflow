'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Btn, Card, Field, LoadingBlock, PageHeader, SelectBox, TagInput, TextArea, TextInput } from '@/components/desk/kit';
import { PersonPicker, useAgentOptions, useDebounced, useGroupOptions, useDepartmentOptions } from '@/components/desk/pickers';
import { AttachmentInput, CategoryPicker, CustomFields } from '@/components/desk/forms';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useTicketFields } from '@/lib/itsm/hooks';
import { NewTicketProjectFields } from '@/components/projects/ticket-project';
import { LEVELS, PRIORITIES, TICKET_SOURCES, TICKET_STATUSES, fromLocalInput } from '@/lib/itsm/format';
import type { Article, Ticket } from '@/lib/itsm/types';

function NewTicketContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const fields = useTicketFields();
  const agentOptions = useAgentOptions();
  const groupOptions = useGroupOptions();
  const deptOptions = useDepartmentOptions();
  const [requesterMode, setRequesterMode] = React.useState<'existing' | 'new'>('existing');
  const [form, setForm] = React.useState({
    type: sp.get('type') === 'service_request' ? 'service_request' : 'incident',
    requester_id: sp.get('requester_id') ?? '',
    email: '',
    name: '',
    subject: '',
    description: '',
    status: 'open',
    priority: '2',
    urgency: '1',
    impact: '1',
    source: 'phone',
    group_id: '',
    responder_id: '',
    department_id: '',
    due_by: '',
    tags: [] as string[],
    cc: '',
  });
  const [category, setCategory] = React.useState({ category: '', sub_category: '', item_category: '' });
  const [custom, setCustom] = React.useState<Record<string, unknown>>({});
  const [project, setProject] = React.useState({ project_id: '', project_state: 'todo' });
  const [files, setFiles] = React.useState<{ id: string; name: string; size: number }[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = (k: keyof typeof form, v: string | string[]) => setForm((f) => ({ ...f, [k]: v }));

  const subject = useDebounced(form.subject, 400);
  const suggestions = useQuery({
    queryKey: ['kb-suggest', subject],
    queryFn: () => v2.items<Article>('/solutions/suggest', { q: subject }),
    enabled: subject.length >= 4,
  });

  const create = useMutation({
    mutationFn: () =>
      v2.post<Ticket>('/tickets', {
        type: form.type,
        subject: form.subject,
        description: form.description,
        status: form.status,
        priority: Number(form.priority),
        urgency: Number(form.urgency),
        impact: Number(form.impact),
        source: form.source,
        requester_id: requesterMode === 'existing' ? form.requester_id || undefined : undefined,
        email: requesterMode === 'new' ? form.email : undefined,
        name: requesterMode === 'new' ? form.name : undefined,
        group_id: form.group_id || undefined,
        responder_id: form.responder_id || undefined,
        department_id: form.department_id || undefined,
        due_by: form.due_by ? fromLocalInput(form.due_by) : undefined,
        tags: form.tags,
        cc_emails: form.cc.split(/[,;\s]+/).filter(Boolean),
        custom_fields: custom,
        ...(project.project_id ? project : {}),
        attachment_ids: files.map((f) => f.id),
        ...category,
      }),
    onSuccess: (t) => {
      toast.success(`${t.display_id} created`);
      router.push(`/tickets/${t.id}`);
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      toast.error(err.message);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.subject.trim()) errs.subject = 'Subject is required';
    if (requesterMode === 'new' && !form.email.trim()) errs.email = 'Email is required';
    setErrors(errs);
    if (Object.keys(errs).length === 0) create.mutate();
  };

  if (fields.isLoading) return <LoadingBlock />;

  return (
    <>
      <PageHeader title={form.type === 'incident' ? 'New incident' : 'New service request'} breadcrumbs={[{ label: 'Tickets', href: '/tickets' }, { label: 'New' }]} />
      <form onSubmit={submit} className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="Requester">
            <div className="mb-3 flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={requesterMode === 'existing'} onChange={() => setRequesterMode('existing')} /> Existing person
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={requesterMode === 'new'} onChange={() => setRequesterMode('new')} /> New requester
              </label>
            </div>
            {requesterMode === 'existing' ? (
              <Field label="Requester" hint="Leave empty to raise the ticket on your own behalf" error={errors.requester_id}>
                <PersonPicker value={form.requester_id} onChange={(id) => set('requester_id', id ?? '')} />
              </Field>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Email" required error={errors.email}>
                  <TextInput type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="name@company.com" />
                </Field>
                <Field label="Full name">
                  <TextInput value={form.name} onChange={(e) => set('name', e.target.value)} />
                </Field>
              </div>
            )}
          </Card>
          <Card title="Details">
            <div className="space-y-4">
              <Field label="Subject" required error={errors.subject}>
                <TextInput value={form.subject} onChange={(e) => set('subject', e.target.value)} maxLength={255} placeholder="Short summary of the issue or request" invalid={!!errors.subject} />
              </Field>
              {(suggestions.data ?? []).length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800">
                    <BookOpen className="h-3.5 w-3.5" /> Related solutions
                  </div>
                  <ul className="space-y-0.5">
                    {suggestions.data!.map((a) => (
                      <li key={a.id}>
                        <Link href={`/solutions/${a.id}`} target="_blank" className="text-sm text-amber-900 underline-offset-2 hover:underline">
                          {a.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Field label="Description" hint="Markdown supported: **bold**, lists, `code`, links">
                <TextArea value={form.description} onChange={(e) => set('description', e.target.value)} rows={8} />
              </Field>
              <CategoryPicker fields={fields.data} value={category} onChange={setCategory} />
              <CustomFields fields={fields.data ?? []} values={custom} onChange={setCustom} errors={errors} />
              <NewTicketProjectFields projectId={project.project_id} state={project.project_state} onChange={setProject} />
              <Field label="Tags">
                <TagInput value={form.tags} onChange={(v) => set('tags', v)} />
              </Field>
              <Field label="CC" hint="Comma-separated email addresses that receive public replies" error={errors.cc_emails}>
                <TextInput value={form.cc} onChange={(e) => set('cc', e.target.value)} />
              </Field>
              <AttachmentInput value={files} onChange={setFiles} />
            </div>
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Properties">
            <div className="space-y-3">
              <Field label="Type">
                <SelectBox value={form.type} onChange={(v) => set('type', v)} options={[{ value: 'incident', label: 'Incident' }, { value: 'service_request', label: 'Service request' }]} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                  <SelectBox value={form.status} onChange={(v) => set('status', v)} options={TICKET_STATUSES} />
                </Field>
                <Field label="Source">
                  <SelectBox value={form.source} onChange={(v) => set('source', v)} options={TICKET_SOURCES} />
                </Field>
                <Field label="Urgency">
                  <SelectBox value={form.urgency} onChange={(v) => set('urgency', v)} options={LEVELS} />
                </Field>
                <Field label="Impact">
                  <SelectBox value={form.impact} onChange={(v) => set('impact', v)} options={LEVELS} />
                </Field>
              </div>
              <Field label="Priority">
                <SelectBox value={form.priority} onChange={(v) => set('priority', v)} options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} />
              </Field>
              <Field label="Group" error={errors.group_id}>
                <SelectBox value={form.group_id} onChange={(v) => set('group_id', v)} placeholder="— Auto (workflows) —" options={groupOptions} />
              </Field>
              <Field label="Agent" error={errors.responder_id}>
                <SelectBox value={form.responder_id} onChange={(v) => set('responder_id', v)} placeholder="— Unassigned —" options={agentOptions} />
              </Field>
              <Field label="Department">
                <SelectBox value={form.department_id} onChange={(v) => set('department_id', v)} placeholder="— Requester's department —" options={deptOptions} />
              </Field>
              <Field label="Due by" hint="Overrides the SLA due date">
                <TextInput type="datetime-local" value={form.due_by} onChange={(e) => set('due_by', e.target.value)} />
              </Field>
            </div>
          </Card>
          <div className="flex justify-end gap-2">
            <Btn onClick={() => router.back()}>Cancel</Btn>
            <Btn type="submit" variant="primary" loading={create.isPending}>
              Create ticket
            </Btn>
          </div>
        </div>
      </form>
    </>
  );
}

export default function NewTicketPage() {
  return (
    <React.Suspense fallback={<LoadingBlock />}>
      <NewTicketContent />
    </React.Suspense>
  );
}
