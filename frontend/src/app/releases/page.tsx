'use client';

import { RecordList } from '@/components/desk/itil';
import { Avatar, PriorityBadge, StatusBadge } from '@/components/desk/kit';
import { CHANGE_TYPES, RELEASE_STATUSES, fmtDate, labelize } from '@/lib/itsm/format';
import type { Release } from '@/lib/itsm/types';

export default function ReleasesPage() {
  return (
    <RecordList<Release>
      module="releases"
      title="Releases"
      subtitle="Bundle approved changes and deploy them together."
      singular="Release"
      newHref="/releases/new"
      managePriv="releases.manage"
      filters={[
        { name: 'status', label: 'Status', options: RELEASE_STATUSES },
        { name: 'release_type', label: 'Type', options: CHANGE_TYPES },
      ]}
      columns={[
        {
          label: 'Release',
          sortKey: 'number',
          render: (r) => (
            <div>
              <div className="font-medium text-slate-900">{r.subject}</div>
              <div className="text-xs text-slate-500"><span className="font-mono">{r.display_id}</span> · {labelize(r.release_type)} · {r.change_count} change(s)</div>
            </div>
          ),
        },
        { label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { label: 'Priority', sortKey: 'priority', render: (r) => <PriorityBadge priority={r.priority} compact /> },
        { label: 'Owner', render: (r) => (r.agent ? <span className="flex items-center gap-1.5"><Avatar name={r.agent.name} src={r.agent.avatar_url} size="xs" />{r.agent.name}</span> : '—') },
        { label: 'Planned', sortKey: 'planned_start', render: (r) => `${fmtDate(r.planned_start)} → ${fmtDate(r.planned_end)}` },
      ]}
    />
  );
}
