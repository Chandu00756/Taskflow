'use client';

import { CrudPage } from '@/components/desk/crud';
import { StatusBadge } from '@/components/desk/kit';
import { useGroupOptions } from '@/components/desk/pickers';
import { v2 } from '@/lib/itsm/api';
import { fmtDateTime, labelize, toLocalInput, fromLocalInput } from '@/lib/itsm/format';
import type { Announcement } from '@/lib/itsm/types';

export default function AnnouncementsPage() {
  const groups = useGroupOptions();
  return (
    <CrudPage<Announcement>
      title="Announcements"
      subtitle="Banners shown on the agent dashboard and the portal home page — outages, maintenance, policy updates."
      singular="Announcement"
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Announcements' }]}
      listPath="/announcements"
      queryKey={['announcements', 'manage']}
      fetcher={() => v2.items<Announcement>('/announcements', { manage: 1 })}
      onSaved={() => undefined}
      columns={[
        { label: 'Title', render: (r) => <span className="font-medium text-slate-900">{r.title}</span> },
        { label: 'Audience', render: (r) => labelize(r.visibility) },
        { label: 'Window', render: (r) => <span className="text-xs">{fmtDateTime(r.visible_from)} → {r.visible_till ? fmtDateTime(r.visible_till) : 'no end'}</span> },
        { label: 'State', render: (r) => <StatusBadge status={r.state} /> },
      ]}
      fields={[
        { name: 'title', label: 'Title', required: true },
        { name: 'body', label: 'Message (Markdown)', type: 'textarea', rows: 5 },
        { name: 'visibility', label: 'Show to', type: 'select', required: true, span: 1, options: [{ value: 'everyone', label: 'Everyone' }, { value: 'agents', label: 'Agents' }, { value: 'requesters', label: 'Requesters (portal)' }, { value: 'groups', label: 'Selected agent groups' }] },
        { name: 'group_ids', label: 'Groups', type: 'multiselect', options: groups, show: (v) => v.visibility === 'groups' },
        { name: 'visible_from', label: 'Show from', type: 'datetime', span: 1 },
        { name: 'visible_till', label: 'Show until', type: 'datetime', span: 1 },
      ]}
      defaults={{ title: '', body: '', visibility: 'everyone', group_ids: [], visible_from: toLocalInput(new Date().toISOString()), visible_till: '' }}
      toForm={(r) => ({ title: r.title, body: r.body, visibility: r.visibility, group_ids: r.group_ids, visible_from: toLocalInput(r.visible_from), visible_till: toLocalInput(r.visible_till) })}
      toPayload={(v) => ({ ...v, visible_from: fromLocalInput(String(v.visible_from || '')), visible_till: v.visible_till ? fromLocalInput(String(v.visible_till)) : '' })}
    />
  );
}
