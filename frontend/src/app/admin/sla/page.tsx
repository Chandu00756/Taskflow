'use client';

import { CrudPage, FieldSpec } from '@/components/desk/crud';
import { Badge, StatusBadge } from '@/components/desk/kit';
import { SLATargetsEditor } from '@/components/admin/editors';
import { useDepartmentOptions, useGroupOptions } from '@/components/desk/pickers';
import { TICKET_SOURCES, fmtMinutes, priorityMeta } from '@/lib/itsm/format';
import type { SLAPolicy, SLATarget } from '@/lib/itsm/types';

export default function SLAPage() {
  const groups = useGroupOptions();
  const depts = useDepartmentOptions();
  return (
    <CrudPage<SLAPolicy>
      title="SLA policies"
      subtitle="The first active policy (by position) whose conditions match a ticket applies; the default policy catches the rest."
      singular="SLA policy"
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'SLA policies' }]}
      listPath="/sla-policies"
      queryKey={['admin-sla']}
      deletePath={(r) => (r.is_default ? null : `/sla-policies/${r.id}`)}
      columns={[
        { label: 'Policy', render: (r) => <div><div className="font-medium text-slate-900">{r.name} {r.is_default && <Badge className="ml-1 bg-blue-50 text-blue-700 ring-blue-600/20">Default</Badge>}</div><div className="text-xs text-slate-500">{r.description}</div></div> },
        { label: 'Applies to', render: (r) => (r.is_default ? 'All other tickets' : describe(r.conditions)) },
        { label: 'Targets (respond / resolve)', render: (r) => <div className="space-y-0.5 text-xs">{[...r.targets].sort((a, b) => b.priority - a.priority).map((t) => <div key={t.priority}>{priorityMeta(t.priority).label}: {fmtMinutes(t.respond_within_minutes)} / {fmtMinutes(t.resolve_within_minutes)}{t.business_hours ? ' (business hrs)' : ''}</div>)}</div> },
        { label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'draft'} label={r.active ? 'Active' : 'Inactive'} /> },
      ]}
      fields={(row) => [
        { name: 'name', label: 'Name', required: true },
        { name: 'description', label: 'Description' },
        { name: 'active', label: 'Active', type: 'toggle' },
        ...(row?.is_default ? [] : ([
          { name: 'position', label: 'Position (lower runs first)', type: 'number', span: 1 },
          { name: 'ticket_types', label: 'Ticket types', type: 'multiselect', options: [{ value: 'incident', label: 'Incident' }, { value: 'service_request', label: 'Service request' }] },
          { name: 'sources', label: 'Sources', type: 'multiselect', options: TICKET_SOURCES },
          { name: 'group_ids', label: 'Groups', type: 'multiselect', options: groups },
          { name: 'department_ids', label: 'Departments', type: 'multiselect', options: depts },
          { name: 'categories', label: 'Categories', type: 'tags', placeholder: 'Hardware, Network…' },
        ] as FieldSpec[])),
        { name: 'targets', label: 'Targets', type: 'custom', render: (v: unknown, onChange: (x: unknown) => void) => <SLATargetsEditor value={(v as SLATarget[]) ?? []} onChange={onChange} /> },
      ] as FieldSpec[]}
      defaults={{ name: '', description: '', active: true, position: 0, ticket_types: [], sources: [], group_ids: [], department_ids: [], categories: [], targets: [] }}
      toForm={(r) => ({ name: r.name, description: r.description, active: r.active, position: r.position, targets: r.targets, ticket_types: r.conditions?.ticket_types ?? [], sources: r.conditions?.sources ?? [], group_ids: r.conditions?.group_ids ?? [], department_ids: r.conditions?.department_ids ?? [], categories: r.conditions?.categories ?? [] })}
      toPayload={(v) => ({
        name: v.name, description: v.description, active: v.active, position: Number(v.position || 0),
        targets: (v.targets as SLATarget[]).length ? v.targets : [4, 3, 2, 1].map((p) => ({ priority: p, respond_within_minutes: 60, resolve_within_minutes: 480, business_hours: true, escalation_enabled: true })),
        conditions: { ticket_types: v.ticket_types, sources: v.sources, group_ids: v.group_ids, department_ids: v.department_ids, categories: v.categories },
      })}
      drawerWidth="max-w-3xl"
    />
  );
}

function describe(c: SLAPolicy['conditions']) {
  const parts = [c.ticket_types?.length && `${c.ticket_types.length} type(s)`, c.sources?.length && `${c.sources.length} source(s)`, c.group_ids?.length && `${c.group_ids.length} group(s)`, c.department_ids?.length && `${c.department_ids.length} department(s)`, c.categories?.length && c.categories.join(', ')].filter(Boolean);
  return parts.join(' · ') || 'All tickets';
}
