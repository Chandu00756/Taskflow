'use client';

import { CrudPage } from '@/components/desk/crud';
import { ActionsEditor, describeActions } from '@/components/admin/editors';
import { useGroupOptions } from '@/components/desk/pickers';
import { labelize } from '@/lib/itsm/format';
import type { AutomationAction, Scenario } from '@/lib/itsm/types';

export default function ScenariosPage() {
  const groups = useGroupOptions();
  return (
    <CrudPage<Scenario>
      title="Scenario automations"
      subtitle="Bundles of actions agents apply to a ticket in one click (from the ticket's Scenarios menu)."
      singular="Scenario"
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Scenarios' }]}
      listPath="/scenarios"
      queryKey={['scenarios']}
      columns={[
        { label: 'Scenario', render: (r) => <div><div className="font-medium text-slate-900">{r.name}</div><div className="text-xs text-slate-500">{r.description}</div></div> },
        { label: 'Actions', render: (r) => <span className="text-xs">{describeActions(r.actions)}</span> },
        { label: 'Available to', render: (r) => (r.visibility === 'me' ? 'Only me' : labelize(r.visibility === 'all' ? 'all agents' : 'selected groups')) },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'description', label: 'Description' },
        { name: 'visibility', label: 'Available to', type: 'select', required: true, span: 1, options: [{ value: 'all', label: 'All agents' }, { value: 'groups', label: 'Selected groups' }, { value: 'me', label: 'Only me' }] },
        { name: 'group_ids', label: 'Groups', type: 'multiselect', options: groups, show: (v) => v.visibility === 'groups' },
        { name: 'actions', label: 'Actions', type: 'custom', render: (v, onChange) => <ActionsEditor value={(v as AutomationAction[]) ?? []} onChange={onChange} allowEmail={false} /> },
      ]}
      defaults={{ name: '', description: '', visibility: 'me', group_ids: [], actions: [] }}
      toForm={(r) => ({ name: r.name, description: r.description, visibility: r.visibility, group_ids: r.group_ids ?? [], actions: r.actions ?? [] })}
      drawerWidth="max-w-2xl"
    />
  );
}
