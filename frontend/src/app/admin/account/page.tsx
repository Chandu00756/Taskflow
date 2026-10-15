'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { SchemaForm, FieldSpec } from '@/components/desk/crud';
import { Btn, Card, Checkbox, LoadingBlock, PageHeader, Stat, TextInput, useConfirm } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';
import { TIME_ZONES } from '@/lib/itsm/format';
import type { CustomStatus, HelpdeskSettings } from '@/lib/itsm/types';

type SettingsData = {
  settings: HelpdeskSettings;
  organization: { id: string; name: string; domain: string | null; description: string | null; created_at: string };
  custom_statuses: CustomStatus[];
  usage: { agents: number; requesters: number };
  inbound_email_url: string;
};

function StatusesEditor({ value, onChange }: { value: CustomStatus[]; onChange: (v: CustomStatus[]) => void }) {
  const rows = value ?? [];
  const update = (i: number, patch: Partial<CustomStatus>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Built-in statuses: Open, Pending (pauses SLA), Resolved, Closed. Add your own below.</p>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-12 items-center gap-2">
          <TextInput className="col-span-3" value={r.label} placeholder="Label (agents)" onChange={(e) => update(i, { label: e.target.value, key: r.key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') })} />
          <TextInput className="col-span-3" value={r.customer_label} placeholder="Label (portal)" onChange={(e) => update(i, { customer_label: e.target.value })} />
          <TextInput className="col-span-2 font-mono text-xs" value={r.key} placeholder="key" onChange={(e) => update(i, { key: e.target.value })} />
          <div className="col-span-3"><Checkbox checked={r.pause_sla} onChange={(v) => update(i, { pause_sla: v })} label="Pauses SLA" /></div>
          <button type="button" aria-label="Remove status" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="col-span-1 text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <Btn size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...rows, { key: '', label: '', customer_label: '', pause_sla: false }])}>Add status</Btn>
    </div>
  );
}

function LogoInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="Logo preview" className="h-12 w-12 rounded-md border border-slate-200 object-contain" />
      ) : (
        <span className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400">None</span>
      )}
      <Btn size="sm" onClick={() => ref.current?.click()}>Upload</Btn>
      {value && <Btn size="sm" variant="ghost" onClick={() => onChange('')}>Remove</Btn>}
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 300 * 1024) {
            toast.error('Logo must be smaller than 300 KB');
            return;
          }
          const reader = new FileReader();
          reader.onload = () => onChange(String(reader.result));
          reader.readAsDataURL(f);
        }}
      />
    </div>
  );
}

export default function AccountSettingsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => v2.get<SettingsData>('/settings') });
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const initial = React.useMemo(() => (data ? { ...data.settings, custom_statuses: data.custom_statuses, organization_name: data.organization.name, organization_description: data.organization.description ?? '' } : {}), [data]);
  React.useEffect(() => setValues(initial), [initial]);
  const save = useMutation({
    mutationFn: (extra?: Record<string, unknown>) => v2.put('/settings', { ...values, ...extra, auto_close_resolved_hours: Number(values.auto_close_resolved_hours), password_min_length: Number(values.password_min_length), session_timeout_minutes: Number(values.session_timeout_minutes) }),
    onSuccess: () => {
      toast.success('Settings saved');
      setErrors({});
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      toast.error(err.message);
    },
  });
  if (isLoading || !data) return <LoadingBlock />;
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const section = (title: string, fields: FieldSpec[], extra?: React.ReactNode) => (
    <Card title={title}>
      <SchemaForm fields={fields} values={values} onChange={setValues} errors={errors} />
      {extra}
    </Card>
  );
  return (
    <>
      <PageHeader
        title="Account & helpdesk"
        subtitle={`Organization created ${new Date(data.organization.created_at).toLocaleDateString()}`}
        breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Account' }]}
        actions={<Btn variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save changes</Btn>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active agents" value={data.usage.agents} href="/admin/agents" />
        <Stat label="Active requesters" value={data.usage.requesters} href="/admin/requesters" />
        <Stat label="Domain" value={<span className="text-base">{data.organization.domain || '—'}</span>} />
        <Stat label="Time zone" value={<span className="text-base">{String(values.time_zone)}</span>} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {section('Organization', [
          { name: 'organization_name', label: 'Organization name', required: true },
          { name: 'organization_description', label: 'Description', type: 'textarea', rows: 2 },
        ])}
        {section('Branding', [
          { name: 'helpdesk_name', label: 'Helpdesk name', required: true, span: 1 },
          { name: 'portal_name', label: 'Portal name', required: true, span: 1 },
          { name: 'portal_welcome', label: 'Portal welcome message' },
          { name: 'primary_color', label: 'Brand color', type: 'color', span: 1 },
          { name: 'logo_url', label: 'Logo', type: 'custom', render: (v, onChange) => <LogoInput value={String(v ?? '')} onChange={onChange} /> },
        ])}
        {section('Localization', [
          { name: 'time_zone', label: 'Time zone', type: 'select', required: true, span: 1, options: Array.from(new Set([...TIME_ZONES, String(values.time_zone || 'UTC')])).map((t) => ({ value: t, label: t })) },
          { name: 'language', label: 'Language', type: 'select', span: 1, options: [{ value: 'en', label: 'English' }, { value: 'es', label: 'Español' }, { value: 'fr', label: 'Français' }, { value: 'de', label: 'Deutsch' }] },
          { name: 'date_format', label: 'Date format', type: 'select', span: 1, options: [{ value: 'MMM d, yyyy', label: 'Oct 15, 2026' }, { value: 'dd/MM/yyyy', label: '15/10/2026' }, { value: 'MM/dd/yyyy', label: '10/15/2026' }, { value: 'yyyy-MM-dd', label: '2026-10-15' }] },
        ])}
        {section('Tickets', [
          { name: 'prefix_incident', label: 'Incident prefix', span: 1 },
          { name: 'prefix_service_request', label: 'Service request prefix', span: 1 },
          { name: 'prefix_problem', label: 'Problem prefix', span: 1 },
          { name: 'prefix_change', label: 'Change prefix', span: 1 },
          { name: 'prefix_release', label: 'Release prefix', span: 1 },
          { name: 'auto_close_resolved_hours', label: 'Auto-close resolved tickets after (hours)', type: 'number', span: 1, hint: '0 disables auto-close' },
          { name: 'require_category_on_resolve', label: 'Require a category to resolve tickets', type: 'checkbox' },
          { name: 'require_time_on_close', label: 'Require logged time to close tickets', type: 'checkbox' },
          { name: 'csat_enabled', label: 'Send satisfaction surveys when tickets are resolved', type: 'checkbox' },
          { name: 'custom_statuses', label: 'Custom statuses', type: 'custom', render: (v, onChange) => <StatusesEditor value={(v as CustomStatus[]) ?? []} onChange={onChange} /> },
        ])}
        {section('Self-service portal', [
          { name: 'requester_can_close', label: 'Requesters can close their tickets', type: 'checkbox' },
          { name: 'requester_can_reopen', label: 'Requesters can reopen resolved tickets', type: 'checkbox' },
          { name: 'dept_head_sees_dept_tickets', label: "Department heads can see their department's tickets", type: 'checkbox' },
          { name: 'allow_requester_signup', label: 'Allow people to sign up from the portal', type: 'checkbox' },
        ])}
        {section('Email', [
          { name: 'support_email', label: 'Support email address', type: 'email', hint: 'Shown to requesters; forward it to the inbound URL below' },
          { name: 'create_requester_from_email', label: 'Create requesters automatically from new email senders', type: 'checkbox' },
        ], (
          <div className="mt-4 rounded-md bg-slate-50 p-3">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Inbound email webhook</div>
            <p className="mb-2 text-xs text-slate-500">Point your email provider’s inbound parse webhook (JSON: from, subject, text, cc) here. Replies with [INC-123] in the subject thread onto the ticket.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs">{data.inbound_email_url}</code>
              <Btn size="xs" aria-label="Copy URL" onClick={() => navigator.clipboard.writeText(data.inbound_email_url).then(() => toast.success('Copied'))}><Copy className="h-3.5 w-3.5" /></Btn>
              <Btn size="xs" aria-label="Regenerate key" onClick={async () => (await confirm({ title: 'Regenerate inbound key?', message: 'The current webhook URL stops working immediately.', confirmLabel: 'Regenerate', danger: true })) && save.mutate({ regenerate_inbound_key: true })}><RefreshCw className="h-3.5 w-3.5" /></Btn>
            </div>
          </div>
        ))}
        {section('Security', [
          { name: 'password_min_length', label: 'Minimum password length', type: 'number', span: 1 },
          { name: 'session_timeout_minutes', label: 'Sign out after inactivity (minutes)', type: 'number', span: 1 },
          { name: 'password_require_upper', label: 'Require an uppercase letter', type: 'checkbox' },
          { name: 'password_require_number', label: 'Require a number', type: 'checkbox' },
          { name: 'password_require_special', label: 'Require a special character', type: 'checkbox' },
        ], <p className="mt-3 text-xs text-slate-500">Accounts lock for 15 minutes after 5 failed sign-in attempts. Admins can unlock them from Agents or Requesters.</p>)}
      </div>
      <div className="mt-5 flex justify-end">
        <Btn variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save changes</Btn>
      </div>
    </>
  );
}
