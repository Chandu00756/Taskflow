'use client';

import { CrudPage } from '@/components/desk/crud';
import { Avatar } from '@/components/desk/kit';
import { useAgentOptions, useGroupOptions } from '@/components/desk/pickers';
import { v2 } from '@/lib/itsm/api';
import { TIME_ZONES, fmtDateTime, toLocalInput, fromLocalInput } from '@/lib/itsm/format';
import type { Ref, UserBrief } from '@/lib/itsm/types';

type Row = { id: string; name: string; group_id: string | null; member_ids: string[]; rotation_type: string; rotation_start: string; handoff_time: string; time_zone: string; group: Ref | null; members: UserBrief[]; on_call: UserBrief | null; next_handoff: string };

export default function OnCallPage() {
  const agents = useAgentOptions();
  const groups = useGroupOptions();
  return (
    <CrudPage<Row>
      title="On-call schedules"
      subtitle="Rotate after-hours responsibility within a group; see who is on call right now."
      singular="Schedule"
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'On-call' }]}
      listPath="/oncall"
      queryKey={['oncall']}
      fetcher={async () => (await v2.items<{ schedule: Row; group: Ref | null; members: UserBrief[]; on_call: UserBrief | null; next_handoff: string }>('/oncall')).map((x) => ({ ...x.schedule, group: x.group, members: x.members, on_call: x.on_call, next_handoff: x.next_handoff }))}
      columns={[
        { label: 'Schedule', render: (r) => <div><div className="font-medium text-slate-900">{r.name}</div><div className="text-xs text-slate-500">{r.group?.name ?? 'No group'} · {r.rotation_type} rotation at {r.handoff_time} {r.time_zone}</div></div> },
        { label: 'On call now', render: (r) => (r.on_call ? <span className="flex items-center gap-1.5"><Avatar name={r.on_call.name} src={r.on_call.avatar_url} size="xs" />{r.on_call.name}</span> : '—') },
        { label: 'Next handoff', render: (r) => <span className="text-xs">{fmtDateTime(r.next_handoff)}</span> },
        { label: 'Rotation', render: (r) => <span className="text-xs">{r.members.map((m) => m.name).join(' → ') || '—'}</span> },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'group_id', label: 'Group', type: 'select', span: 1, options: groups },
        { name: 'rotation_type', label: 'Rotation', type: 'select', span: 1, options: [{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }] },
        { name: 'member_ids', label: 'Members (in rotation order)', type: 'multiselect', options: agents },
        { name: 'rotation_start', label: 'Rotation starts', type: 'datetime', span: 1 },
        { name: 'handoff_time', label: 'Handoff time', span: 1, placeholder: '09:00' },
        { name: 'time_zone', label: 'Time zone', type: 'select', span: 1, options: TIME_ZONES.map((t) => ({ value: t, label: t })) },
      ]}
      defaults={{ name: '', group_id: '', rotation_type: 'weekly', member_ids: [], rotation_start: toLocalInput(new Date().toISOString()), handoff_time: '09:00', time_zone: 'UTC' }}
      toForm={(r) => ({ name: r.name, group_id: r.group_id ?? '', rotation_type: r.rotation_type, member_ids: r.member_ids, rotation_start: toLocalInput(r.rotation_start), handoff_time: r.handoff_time, time_zone: r.time_zone })}
      toPayload={(v) => ({ ...v, rotation_start: fromLocalInput(String(v.rotation_start || '')) || new Date().toISOString() })}
    />
  );
}
