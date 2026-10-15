'use client';

import { RecordList } from '@/components/desk/itil';
import { Avatar, PriorityBadge, StatusBadge } from '@/components/desk/kit';
import { useAgentOptions } from '@/components/desk/pickers';
import { PRIORITIES, PROBLEM_STATUSES, fmtDate } from '@/lib/itsm/format';
import type { Problem } from '@/lib/itsm/types';

export default function ProblemsPage() {
  const agents = useAgentOptions();
  return (
    <RecordList<Problem>
      module="problems"
      title="Problems"
      subtitle="Investigate the root cause of recurring incidents."
      singular="Problem"
      newHref="/problems/new"
      managePriv="problems.manage"
      filters={[
        { name: 'status', label: 'Status', options: PROBLEM_STATUSES },
        { name: 'priority', label: 'Priority', options: PRIORITIES.map((p) => ({ value: p.value, label: p.label })) },
        { name: 'agent_id', label: 'Agent', options: [{ value: 'me', label: 'Me' }, ...agents] },
        { name: 'known_error', label: 'Known error', options: [{ value: 'true', label: 'Known errors only' }] },
      ]}
      columns={[
        {
          label: 'Problem',
          sortKey: 'number',
          render: (p) => (
            <div>
              <div className="font-medium text-slate-900">{p.subject}</div>
              <div className="text-xs text-slate-500">
                <span className="font-mono">{p.display_id}</span>
                {p.known_error && <span className="ml-2 rounded bg-amber-50 px-1 text-amber-800">Known error</span>}
              </div>
            </div>
          ),
        },
        { label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
        { label: 'Priority', sortKey: 'priority', render: (p) => <PriorityBadge priority={p.priority} compact /> },
        { label: 'Agent', render: (p) => (p.agent ? <span className="flex items-center gap-1.5"><Avatar name={p.agent.name} src={p.agent.avatar_url} size="xs" />{p.agent.name}</span> : <span className="text-slate-400">Unassigned</span>) },
        { label: 'Incidents', render: (p) => p.incident_count },
        { label: 'Due', sortKey: 'due_by', render: (p) => fmtDate(p.due_by) },
      ]}
    />
  );
}
