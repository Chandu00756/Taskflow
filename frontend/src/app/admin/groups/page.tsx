'use client';

import Link from 'next/link';
import { CrudPage } from '@/components/desk/crud';
import { Avatar, Badge } from '@/components/desk/kit';
import { useAgentOptions } from '@/components/desk/pickers';
import { useBusinessHours } from '@/lib/itsm/hooks';
import type { AgentGroup } from '@/lib/itsm/types';

export default function GroupsPage() {
  const agents = useAgentOptions();
  const bh = useBusinessHours();
  return (
    <CrudPage<AgentGroup>
      title="Agent groups"
      subtitle="Groups own tickets. Turn on round-robin to assign new tickets automatically."
      singular="Group"
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Agent groups' }]}
      listPath="/groups"
      queryKey={['lookup', 'groups']}
      searchable={(r, q) => r.name.toLowerCase().includes(q)}
      columns={[
        { label: 'Group', render: (r) => <div><div className="font-medium text-slate-900">{r.name}</div><div className="text-xs text-slate-500">{r.description}</div></div> },
        {
          label: 'Members',
          render: (r) => (
            <div>
              <span className="flex -space-x-1.5">
                {r.members.slice(0, 6).map((m) => <Avatar key={m.id} name={m.name} src={m.avatar_url} size="sm" className="ring-2 ring-white" />)}
                {r.members.length > 6 && <span className="ml-2 text-xs text-slate-500">+{r.members.length - 6}</span>}
                {r.members.length === 0 && <span className="text-xs text-slate-400">No members</span>}
              </span>
              {r.observers.length > 0 && <div className="mt-1 text-xs text-slate-500">{r.observers.length} observer{r.observers.length === 1 ? '' : 's'}</div>}
            </div>
          ),
        },
        { label: 'Leader', render: (r) => (r.leader ? <span className="inline-flex items-center gap-1.5"><Avatar name={r.leader.name} src={r.leader.avatar_url} size="xs" />{r.leader.name}</span> : '—') },
        { label: 'Open tickets', render: (r) => <Link className="text-blue-700 hover:underline" href={`/tickets?group_id=${r.id}`}>{r.open_tickets}</Link> },
        { label: 'Assignment', render: (r) => (r.auto_assign ? <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">Round-robin</Badge> : <span className="text-xs text-slate-500">Manual</span>) },
        { label: 'Escalation', render: (r) => (r.escalate_to ? `${r.escalate_to.name} after ${r.unassigned_for_minutes || '—'} min` : '—') },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
        { name: 'leader_id', label: 'Group leader', type: 'select', span: 1, options: agents },
        { name: 'email', label: 'Group email', type: 'email', span: 1, placeholder: 'network@example.com' },
        { name: 'member_ids', label: 'Members', type: 'multiselect', options: agents, hint: 'Members can be assigned tickets and take part in round-robin.' },
        { name: 'observer_ids', label: 'Observers', type: 'multiselect', options: agents, hint: 'Observers see the group’s tickets but are never assigned automatically.' },
        { name: 'auto_assign', label: 'Round-robin assignment', type: 'toggle', description: 'Assign new tickets in turn to available members' },
        { name: 'business_hours_id', label: 'Business hours', type: 'select', span: 1, options: (bh.data ?? []).map((b) => ({ value: b.id, label: b.name })) },
        { name: 'escalate_to_id', label: 'Escalate unassigned tickets to', type: 'select', span: 1, options: agents },
        { name: 'unassigned_for_minutes', label: 'Escalate after (minutes unassigned)', type: 'number', span: 1 },
        { name: 'restricted', label: 'Restricted group', type: 'toggle', description: 'Only members can see this group’s tickets when their access is limited to groups' },
      ]}
      defaults={{ name: '', description: '', leader_id: '', email: '', member_ids: [], observer_ids: [], auto_assign: false, business_hours_id: '', escalate_to_id: '', unassigned_for_minutes: 30, restricted: false }}
      toForm={(r) => ({ name: r.name, description: r.description, leader_id: r.leader_id ?? '', email: r.email, member_ids: r.member_ids, observer_ids: r.observer_ids, auto_assign: r.auto_assign, business_hours_id: r.business_hours_id ?? '', escalate_to_id: r.escalate_to_id ?? '', unassigned_for_minutes: r.unassigned_for_minutes, restricted: r.restricted })}
    />
  );
}
