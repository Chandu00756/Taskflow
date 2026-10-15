'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, AlertTriangle, CalendarClock, Clock, Inbox, Megaphone, Star, UserX } from 'lucide-react';
import { DeskShell } from '@/components/desk/shell';
import { Card, ErrorBlock, LoadingBlock, PageHeader, SelectBox, Stat, StatusBadge, Avatar, Table, Th, Td } from '@/components/desk/kit';
import { BarList, TrendChart } from '@/components/desk/charts';
import { Markdown } from '@/components/desk/markdown';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useMe } from '@/lib/itsm/hooks';
import { fmtDateTime } from '@/lib/itsm/format';
import type { Announcement, Change, UserBrief } from '@/lib/itsm/types';

interface KV {
  key: string;
  label: string;
  value: number;
}

interface DashboardData {
  counters: Record<string, number>;
  trend: { day: string; created: number; resolved: number }[];
  by_priority: KV[];
  by_status: KV[];
  by_source: KV[];
  by_group: KV[];
  by_category: KV[];
  sla: { first_response_pct: number | null; resolution_pct: number | null; avg_first_response_minutes: number; avg_resolution_hours: number };
  csat: { responses: number; average: number; positive_pct: number | null };
  leaderboard: { agent: UserBrief; resolved: number; avg_resolution_hours: number; csat: number }[];
  pending_approvals: number;
  problems?: { open: number; known_errors: number };
  upcoming_changes?: Change[];
  assets_by_state?: KV[];
  contracts_expiring?: number;
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);

function DashboardContent() {
  const [range, setRange] = React.useState('30d');
  const router = useRouter();
  const { data: me } = useMe();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', range],
    queryFn: () => v2.get<DashboardData>('/dashboard', { range }),
    refetchInterval: 60_000,
  });
  const announcements = useQuery({ queryKey: ['announcements'], queryFn: () => v2.items<Announcement>('/announcements') });

  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock message={parseApiError(error).message} onRetry={() => refetch()} />;
  const c = data.counters;
  const ticketLink = (params: string) => `/tickets?${params}`;

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${me?.user.name.split(' ')[0] ?? ''}`}
        subtitle="Here's what's happening across the service desk."
        actions={
          <SelectBox
            aria-label="Date range"
            value={range}
            onChange={setRange}
            options={[
              { value: '7d', label: 'Last 7 days' },
              { value: '30d', label: 'Last 30 days' },
              { value: '90d', label: 'Last 90 days' },
              { value: '365d', label: 'Last 12 months' },
            ]}
            className="w-44"
          />
        }
      />

      {(announcements.data ?? []).length > 0 && (
        <div className="mb-5 space-y-2">
          {announcements.data!.slice(0, 2).map((a) => (
            <div key={a.id} className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
              <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-blue-900">{a.title}</div>
                <Markdown text={a.body} className="text-sm text-blue-900/80" />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Unresolved" value={c.unresolved} href={ticketLink('view=open')} icon={<Inbox className="h-4 w-4" />} />
        <Stat label="Overdue" value={c.overdue} tone={c.overdue ? 'rose' : 'slate'} href={ticketLink('view=overdue')} icon={<AlertTriangle className="h-4 w-4" />} />
        <Stat label="Due today" value={c.due_today} tone={c.due_today ? 'amber' : 'slate'} href={ticketLink('view=due_today')} icon={<CalendarClock className="h-4 w-4" />} />
        <Stat label="Unassigned" value={c.unassigned} href={ticketLink('view=unassigned')} icon={<UserX className="h-4 w-4" />} />
        <Stat label="Pending" value={c.pending} href={ticketLink('view=pending')} icon={<Clock className="h-4 w-4" />} />
        <Stat label="My open" value={c.my_open} tone="blue" href={ticketLink('view=my_open')} hint={c.my_overdue ? `${c.my_overdue} overdue` : undefined} icon={<AlarmClock className="h-4 w-4" />} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card title="Ticket trend" className="xl:col-span-2" actions={<span className="text-xs text-slate-500">{c.created} created · {c.resolved} resolved</span>}>
          <TrendChart data={data.trend} />
        </Card>
        <Card title="Service levels">
          <div className="grid grid-cols-2 gap-4">
            <Metric label="First response SLA" value={pct(data.sla.first_response_pct)} good={(data.sla.first_response_pct ?? 100) >= 90} />
            <Metric label="Resolution SLA" value={pct(data.sla.resolution_pct)} good={(data.sla.resolution_pct ?? 100) >= 90} />
            <Metric label="Avg first response" value={formatMins(data.sla.avg_first_response_minutes)} />
            <Metric label="Avg resolution" value={`${data.sla.avg_resolution_hours.toFixed(1)}h`} />
          </div>
          <div className="mt-5 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Customer satisfaction</span>
              <Star className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-slate-900">{data.csat.responses ? data.csat.average.toFixed(1) : '—'}</span>
              <span className="text-sm text-slate-500">/ 5 · {pct(data.csat.positive_pct)} positive · {data.csat.responses} responses</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Unresolved by priority">
          <BarList items={data.by_priority} onSelect={(k) => router.push(ticketLink(`view=open&priority=${k}`))} empty="No unresolved tickets" />
        </Card>
        <Card title="Unresolved by group">
          <BarList items={data.by_group} onSelect={(k) => router.push(ticketLink(k ? `view=open&group_id=${k}` : 'view=open'))} empty="No unresolved tickets" />
        </Card>
        <Card title="Tickets by source">
          <BarList items={data.by_source} onSelect={(k) => router.push(ticketLink(`source=${k}`))} />
        </Card>
        <Card title="Top categories">
          <BarList items={data.by_category.slice(0, 6)} />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card title="Top performers" className="xl:col-span-2" padded={false}>
          {data.leaderboard.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">No resolved tickets in this period</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Agent</Th>
                  <Th className="text-right">Resolved</Th>
                  <Th className="text-right">Avg resolution</Th>
                  <Th className="text-right">CSAT</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.leaderboard.map((row) => (
                  <tr key={row.agent?.id}>
                    <Td>
                      <span className="flex items-center gap-2">
                        <Avatar name={row.agent?.name} src={row.agent?.avatar_url} size="sm" />
                        {row.agent?.name}
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums">{row.resolved}</Td>
                    <Td className="text-right tabular-nums">{row.avg_resolution_hours.toFixed(1)}h</Td>
                    <Td className="text-right tabular-nums">{row.csat ? row.csat.toFixed(1) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <div className="space-y-5">
          {data.upcoming_changes && (
            <Card title="Upcoming changes" actions={<Link href="/changes?view=calendar" className="text-xs font-medium text-blue-600">Calendar</Link>}>
              {data.upcoming_changes.length === 0 ? (
                <p className="text-sm text-slate-400">No changes scheduled in the next two weeks</p>
              ) : (
                <ul className="space-y-3">
                  {data.upcoming_changes.map((ch) => (
                    <li key={ch.id}>
                      <Link href={`/changes/${ch.id}`} className="block rounded-md hover:bg-slate-50">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm text-slate-800">
                            <span className="mr-1.5 font-mono text-xs text-slate-500">{ch.display_id}</span>
                            {ch.subject}
                          </span>
                          <StatusBadge status={ch.status} />
                        </div>
                        <div className="text-xs text-slate-500">{fmtDateTime(ch.planned_start)}</div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <Card title="At a glance">
            <ul className="space-y-2 text-sm">
              <GlanceRow href="/approvals" label="Approvals waiting on you" value={data.pending_approvals} />
              {data.problems && <GlanceRow href="/problems" label="Open problems" value={data.problems.open} />}
              {data.problems && <GlanceRow href="/problems?known_error=true" label="Known errors" value={data.problems.known_errors} />}
              {data.contracts_expiring !== undefined && <GlanceRow href="/assets/contracts?expiring=true" label="Contracts expiring in 30 days" value={data.contracts_expiring} />}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function GlanceRow({ href, label, value }: { href: string; label: string; value: number }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-slate-50">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold tabular-nums text-slate-900">{value}</span>
      </Link>
    </li>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${good === undefined ? 'text-slate-900' : good ? 'text-emerald-600' : 'text-amber-600'}`}>{value}</div>
    </div>
  );
}

function formatMins(m: number) {
  if (!m) return '—';
  if (m < 60) return `${Math.round(m)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

export default function DashboardPage() {
  return (
    <DeskShell>
      <DashboardContent />
    </DeskShell>
  );
}
