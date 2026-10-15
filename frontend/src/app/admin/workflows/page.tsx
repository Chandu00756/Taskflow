'use client';

import { CrudPage } from '@/components/desk/crud';
import { StatusBadge } from '@/components/desk/kit';
import { ActionsEditor, ConditionsEditor, PLACEHOLDER_HELP, describeActions } from '@/components/admin/editors';
import { timeAgo } from '@/lib/itsm/format';
import type { AutomationAction, RuleCondition, Workflow } from '@/lib/itsm/types';

export default function WorkflowsPage() {
  return (
    <CrudPage<Workflow>
      title="Workflow automator"
      subtitle="Automatically route, prioritize, tag and notify when tickets are created or updated. Workflows run in position order."
      singular="Workflow"
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Workflow automator' }]}
      listPath="/workflows"
      queryKey={['admin-workflows']}
      columns={[
        { label: 'Workflow', render: (r) => <div><div className="font-medium text-slate-900">{r.name}</div><div className="text-xs text-slate-500">{r.description}</div></div> },
        { label: 'Event', render: (r) => (r.event === 'ticket_created' ? 'Ticket is created' : 'Ticket is updated') },
        { label: 'Conditions', render: (r) => `${r.conditions?.rules?.length ?? 0} (${r.conditions?.match ?? 'all'})` },
        { label: 'Actions', render: (r) => <span className="text-xs">{describeActions(r.actions)}</span> },
        { label: 'Runs', render: (r) => <span className="text-xs">{r.execution_count}{r.last_executed_at ? ` · last ${timeAgo(r.last_executed_at)}` : ''}</span> },
        { label: 'Status', render: (r) => <StatusBadge status={r.active ? 'active' : 'draft'} label={r.active ? 'Active' : 'Inactive'} /> },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'description', label: 'Description' },
        { name: 'event', label: 'Run when', type: 'select', required: true, span: 1, options: [{ value: 'ticket_created', label: 'A ticket is created' }, { value: 'ticket_updated', label: 'A ticket is updated' }] },
        { name: 'position', label: 'Position', type: 'number', span: 1 },
        { name: 'active', label: 'Active', type: 'toggle' },
        { name: 'stop_processing', label: 'Stop processing other workflows when this one matches', type: 'checkbox' },
        { name: 'conditions', label: 'Conditions', type: 'custom', render: (v, onChange, values) => <ConditionsEditor value={v as { match: 'all' | 'any'; rules: RuleCondition[] }} onChange={onChange} event={String(values.event)} /> },
        { name: 'actions', label: 'Actions', type: 'custom', hint: `Email placeholders: ${PLACEHOLDER_HELP}`, render: (v, onChange) => <ActionsEditor value={(v as AutomationAction[]) ?? []} onChange={onChange} /> },
      ]}
      defaults={{ name: '', description: '', event: 'ticket_created', position: 10, active: true, stop_processing: false, conditions: { match: 'all', rules: [] }, actions: [] }}
      toForm={(r) => ({ name: r.name, description: r.description, event: r.event, position: r.position, active: r.active, stop_processing: r.stop_processing, conditions: r.conditions ?? { match: 'all', rules: [] }, actions: r.actions ?? [] })}
      toPayload={(v) => ({ ...v, position: Number(v.position || 0) })}
      drawerWidth="max-w-3xl"
    />
  );
}
