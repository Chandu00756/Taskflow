'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, List } from 'lucide-react';
import { RecordList } from '@/components/desk/itil';
import { Avatar, Btn, Card, LoadingBlock, PageHeader, PriorityBadge, StatusBadge } from '@/components/desk/kit';
import { useAgentOptions } from '@/components/desk/pickers';
import { CHANGE_STATUSES, CHANGE_TYPES, RISKS, fmtDateTime, labelize } from '@/lib/itsm/format';
import { v2 } from '@/lib/itsm/api';
import type { Change, Release } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';

function ChangesContent() {
  const sp = useSearchParams();
  const [view, setView] = React.useState(sp.get('view') === 'calendar' ? 'calendar' : 'list');
  const agents = useAgentOptions();
  const toggle = (
    <div className="flex rounded-md border border-slate-200 bg-white p-0.5">
      <button onClick={() => setView('list')} className={cn('flex items-center gap-1 rounded px-2 py-1 text-xs', view === 'list' ? 'bg-slate-100 font-medium' : 'text-slate-500')}>
        <List className="h-3.5 w-3.5" /> List
      </button>
      <button onClick={() => setView('calendar')} className={cn('flex items-center gap-1 rounded px-2 py-1 text-xs', view === 'calendar' ? 'bg-slate-100 font-medium' : 'text-slate-500')}>
        <CalendarDays className="h-3.5 w-3.5" /> Calendar
      </button>
    </div>
  );
  if (view === 'calendar') {
    return (
      <>
        <PageHeader title="Change calendar" subtitle="Planned changes and releases by date." actions={toggle} />
        <ChangeCalendar />
      </>
    );
  }
  return (
    <RecordList<Change>
      module="changes"
      title="Changes"
      subtitle="Plan, approve and implement changes with minimal disruption."
      singular="Change"
      newHref="/changes/new"
      managePriv="changes.manage"
      headerExtra={toggle}
      filters={[
        { name: 'status', label: 'Status', options: CHANGE_STATUSES },
        { name: 'change_type', label: 'Type', options: CHANGE_TYPES },
        { name: 'approval_status', label: 'Approval', options: ['not_requested', 'requested', 'approved', 'rejected'].map((v) => ({ value: v, label: labelize(v) })) },
        { name: 'agent_id', label: 'Agent', options: [{ value: 'me', label: 'Me' }, ...agents] },
      ]}
      columns={[
        {
          label: 'Change',
          sortKey: 'number',
          render: (c) => (
            <div>
              <div className="font-medium text-slate-900">{c.subject}</div>
              <div className="text-xs text-slate-500">
                <span className="font-mono">{c.display_id}</span> · {labelize(c.change_type)} · Risk {RISKS.find((r) => r.value === c.risk)?.label}
              </div>
            </div>
          ),
        },
        { label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
        { label: 'Approval', render: (c) => <StatusBadge status={c.approval_status} /> },
        { label: 'Priority', sortKey: 'priority', render: (c) => <PriorityBadge priority={c.priority} compact /> },
        { label: 'Agent', render: (c) => (c.agent ? <span className="flex items-center gap-1.5"><Avatar name={c.agent.name} src={c.agent.avatar_url} size="xs" />{c.agent.name}</span> : <span className="text-slate-400">—</span>) },
        { label: 'Planned', sortKey: 'planned_start', render: (c) => <span className="text-xs">{fmtDateTime(c.planned_start)}</span> },
      ]}
    />
  );
}

function ChangeCalendar() {
  const [month, setMonth] = React.useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const start = new Date(month);
  start.setDate(1 - start.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 42);
  const { data, isLoading } = useQuery({
    queryKey: ['change-calendar', start.toISOString()],
    queryFn: () => v2.get<{ changes: Change[]; releases: Release[] }>('/changes/calendar', { from: start.toISOString(), to: end.toISOString() }),
  });
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const covers = (s: string | null, e: string | null, day: Date) => {
    if (!s) return false;
    const ds = new Date(s);
    const de = e ? new Date(e) : ds;
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    return ds < dayEnd && de >= dayStart;
  };
  return (
    <Card padded={false}>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Btn size="xs" variant="ghost" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Btn>
          <span className="w-40 text-center text-sm font-semibold text-slate-900">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
          <Btn size="xs" variant="ghost" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Btn>
        </div>
        <div className="flex gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> Change</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-500" /> Release</span>
        </div>
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="grid grid-cols-7 text-xs">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="border-b border-slate-100 bg-slate-50 px-2 py-1.5 font-semibold text-slate-500">{d}</div>
          ))}
          {days.map((day) => {
            const changes = (data?.changes ?? []).filter((c) => covers(c.planned_start, c.planned_end, day));
            const releases = (data?.releases ?? []).filter((r) => covers(r.planned_start, r.planned_end, day));
            const inMonth = day.getMonth() === month.getMonth();
            return (
              <div key={day.toISOString()} className={cn('min-h-[104px] border-b border-r border-slate-100 p-1.5', !inMonth && 'bg-slate-50/60')}>
                <div className={cn('mb-1 text-right', sameDay(day, new Date()) ? 'font-bold text-blue-600' : inMonth ? 'text-slate-700' : 'text-slate-400')}>{day.getDate()}</div>
                <div className="space-y-0.5">
                  {changes.slice(0, 3).map((c) => (
                    <Link key={c.id} href={`/changes/${c.id}`} title={`${c.display_id} ${c.subject}`} className="block truncate rounded bg-blue-50 px-1 py-0.5 text-blue-800 hover:bg-blue-100">
                      {c.display_id} {c.subject}
                    </Link>
                  ))}
                  {releases.slice(0, 2).map((r) => (
                    <Link key={r.id} href={`/releases/${r.id}`} title={r.subject} className="block truncate rounded bg-violet-50 px-1 py-0.5 text-violet-800 hover:bg-violet-100">
                      {r.display_id} {r.subject}
                    </Link>
                  ))}
                  {changes.length + releases.length > 5 && <div className="px-1 text-slate-500">+{changes.length + releases.length - 5} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default function ChangesPage() {
  return (
    <React.Suspense fallback={<LoadingBlock />}>
      <ChangesContent />
    </React.Suspense>
  );
}
