'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, Btn, Card, EmptyState, LoadingBlock, PageHeader, SelectBox, Table, Tabs, Td, Th } from '@/components/desk/kit';
import { ColumnChart, BarList, fmtDay } from '@/components/desk/charts';
import { v2, downloadFile, parseApiError } from '@/lib/itsm/api';
import { fmtMinutes, fmtMoney, priorityMeta, labelize } from '@/lib/itsm/format';
import type { Ref, UserBrief } from '@/lib/itsm/types';

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);

export default function ReportsPage() {
  const [tab, setTab] = React.useState('ticket-volume');
  const [range, setRange] = React.useState('30d');
  const [interval, setInterval] = React.useState('day');
  const { data, isLoading, error } = useQuery({
    queryKey: ['report', tab, range, interval],
    queryFn: () => v2.get<Record<string, unknown>>(`/reports/${tab}`, { range, interval }),
  });
  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Measure volume, service levels, team performance and satisfaction."
        actions={
          <>
            <SelectBox aria-label="Range" value={range} onChange={setRange} className="w-40" options={[{ value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: '90d', label: 'Last 90 days' }, { value: '365d', label: 'Last 12 months' }]} />
            <Btn size="sm" icon={<Download className="h-4 w-4" />} onClick={() => downloadFile('/tickets/export', 'tickets.csv').catch((e) => toast.error(parseApiError(e).message))}>Export tickets</Btn>
          </>
        }
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'ticket-volume', label: 'Ticket volume' },
          { value: 'sla', label: 'SLA compliance' },
          { value: 'agent-performance', label: 'Agent performance' },
          { value: 'group-performance', label: 'Group performance' },
          { value: 'csat', label: 'Satisfaction' },
          { value: 'assets', label: 'Asset inventory' },
        ]}
      />
      {isLoading ? <LoadingBlock /> : error ? <Card><p className="text-sm text-rose-600">{parseApiError(error).message}</p></Card> : data && (
        <>
          {tab === 'ticket-volume' && <VolumeReport rows={data.rows as VolumeRow[]} interval={interval} setInterval={setInterval} />}
          {tab === 'sla' && <SLAReport rows={data.rows as SLARow[]} />}
          {tab === 'agent-performance' && <AgentReport rows={data.rows as AgentRow[]} />}
          {tab === 'group-performance' && <GroupReport rows={data.rows as GroupRow[]} />}
          {tab === 'csat' && <CSATReport rows={data.rows as { period: string; responses: number; average: number }[]} dist={data.distribution as { rating: number; count: number }[]} />}
          {tab === 'assets' && <AssetReport rows={data.rows as { type: string; state: string; count: number; total_cost: number }[]} />}
        </>
      )}
    </>
  );
}

type VolumeRow = { period: string; created: number; resolved: number; incidents: number; service_requests: number };
type SLARow = { priority: number; total: number; first_response_met: number; first_response_missed: number; resolution_met: number; resolution_missed: number };
type AgentRow = { agent: UserBrief | null; assigned: number; resolved: number; first_response_sla_pct: number | null; avg_resolution_hours: number; avg_first_response_minutes: number; time_logged_minutes: number; csat: number };
type GroupRow = { group: Ref | null; created: number; resolved: number; sla_violations: number; avg_resolution_hours: number };

function VolumeReport({ rows, interval, setInterval }: { rows: VolumeRow[]; interval: string; setInterval: (v: string) => void }) {
  const totals = rows.reduce((s, r) => ({ created: s.created + r.created, resolved: s.resolved + r.resolved, inc: s.inc + r.incidents, sr: s.sr + r.service_requests }), { created: 0, resolved: 0, inc: 0, sr: 0 });
  return (
    <div className="space-y-5">
      <Card title="Tickets created" actions={<SelectBox aria-label="Interval" value={interval} onChange={setInterval} className="w-32" options={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />}>
        {rows.length === 0 ? <EmptyState title="No tickets in this period" /> : <ColumnChart data={rows} xKey="period" yKey="created" label="Created" format={fmtDay} />}
      </Card>
      <Card padded={false} title={`Breakdown · ${totals.created} created · ${totals.resolved} resolved · ${totals.inc} incidents · ${totals.sr} service requests`}>
        <Table>
          <thead><tr><Th>Period</Th><Th className="text-right">Created</Th><Th className="text-right">Resolved</Th><Th className="text-right">Incidents</Th><Th className="text-right">Service requests</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => <tr key={r.period}><Td>{fmtDay(r.period)}</Td><Td className="text-right tabular-nums">{r.created}</Td><Td className="text-right tabular-nums">{r.resolved}</Td><Td className="text-right tabular-nums">{r.incidents}</Td><Td className="text-right tabular-nums">{r.service_requests}</Td></tr>)}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function SLAReport({ rows }: { rows: SLARow[] }) {
  return (
    <Card padded={false}>
      {rows.length === 0 ? <EmptyState title="No tickets in this period" /> : (
        <Table>
          <thead><tr><Th>Priority</Th><Th className="text-right">Tickets</Th><Th className="text-right">First response met</Th><Th className="text-right">First response missed</Th><Th className="text-right">Resolution met</Th><Th className="text-right">Resolution missed</Th><Th className="text-right">Resolution compliance</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const total = r.resolution_met + r.resolution_missed;
              return (
                <tr key={r.priority}>
                  <Td>{priorityMeta(r.priority).label}</Td>
                  <Td className="text-right tabular-nums">{r.total}</Td>
                  <Td className="text-right tabular-nums text-emerald-700">{r.first_response_met}</Td>
                  <Td className="text-right tabular-nums text-rose-600">{r.first_response_missed}</Td>
                  <Td className="text-right tabular-nums text-emerald-700">{r.resolution_met}</Td>
                  <Td className="text-right tabular-nums text-rose-600">{r.resolution_missed}</Td>
                  <Td className="text-right font-semibold tabular-nums">{total ? pct((r.resolution_met * 100) / total) : '—'}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function AgentReport({ rows }: { rows: AgentRow[] }) {
  return (
    <Card padded={false}>
      {rows.length === 0 ? <EmptyState title="No assigned tickets in this period" /> : (
        <Table>
          <thead><tr><Th>Agent</Th><Th className="text-right">Assigned</Th><Th className="text-right">Resolved</Th><Th className="text-right">First response SLA</Th><Th className="text-right">Avg first response</Th><Th className="text-right">Avg resolution</Th><Th className="text-right">Time logged</Th><Th className="text-right">CSAT</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={r.agent?.id ?? i}>
                <Td><span className="flex items-center gap-2"><Avatar name={r.agent?.name} src={r.agent?.avatar_url} size="sm" />{r.agent?.name ?? '—'}</span></Td>
                <Td className="text-right tabular-nums">{r.assigned}</Td>
                <Td className="text-right tabular-nums">{r.resolved}</Td>
                <Td className="text-right tabular-nums">{pct(r.first_response_sla_pct)}</Td>
                <Td className="text-right tabular-nums">{fmtMinutes(Math.round(r.avg_first_response_minutes))}</Td>
                <Td className="text-right tabular-nums">{r.avg_resolution_hours.toFixed(1)}h</Td>
                <Td className="text-right tabular-nums">{fmtMinutes(r.time_logged_minutes)}</Td>
                <Td className="text-right tabular-nums">{r.csat ? r.csat.toFixed(1) : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function GroupReport({ rows }: { rows: GroupRow[] }) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Tickets by group">
        <BarList items={rows.map((r) => ({ key: r.group?.id ?? '', label: r.group?.name ?? '—', value: r.created }))} />
      </Card>
      <Card padded={false} className="lg:col-span-2">
        {rows.length === 0 ? <EmptyState title="No group activity in this period" /> : (
          <Table>
            <thead><tr><Th>Group</Th><Th className="text-right">Created</Th><Th className="text-right">Resolved</Th><Th className="text-right">SLA violations</Th><Th className="text-right">Avg resolution</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={r.group?.id ?? i}><Td>{r.group?.name ?? '—'}</Td><Td className="text-right tabular-nums">{r.created}</Td><Td className="text-right tabular-nums">{r.resolved}</Td><Td className="text-right tabular-nums text-rose-600">{r.sla_violations}</Td><Td className="text-right tabular-nums">{r.avg_resolution_hours.toFixed(1)}h</Td></tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function CSATReport({ rows, dist }: { rows: { period: string; responses: number; average: number }[]; dist: { rating: number; count: number }[] }) {
  const responses = rows.reduce((s, r) => s + r.responses, 0);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Rating distribution">
        {responses === 0 ? <EmptyState title="No ratings yet" /> : <BarList items={[5, 4, 3, 2, 1].map((n) => ({ key: String(n), label: `${n} star${n > 1 ? 's' : ''}`, value: dist.find((d) => d.rating === n)?.count ?? 0 }))} />}
      </Card>
      <Card title="Responses over time" className="lg:col-span-2">
        {rows.length === 0 ? <EmptyState title="No ratings in this period" /> : (
          <Table>
            <thead><tr><Th>Period</Th><Th className="text-right">Responses</Th><Th className="text-right">Average</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((r) => <tr key={r.period}><Td>{fmtDay(r.period)}</Td><Td className="text-right tabular-nums">{r.responses}</Td><Td className="text-right tabular-nums">{r.average.toFixed(2)}</Td></tr>)}</tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function AssetReport({ rows }: { rows: { type: string; state: string; count: number; total_cost: number }[] }) {
  return (
    <Card padded={false}>
      {rows.length === 0 ? <EmptyState title="No assets yet" /> : (
        <Table>
          <thead><tr><Th>Asset type</Th><Th>State</Th><Th className="text-right">Count</Th><Th className="text-right">Total cost</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => <tr key={`${r.type}-${r.state}`}><Td>{r.type}</Td><Td>{labelize(r.state)}</Td><Td className="text-right tabular-nums">{r.count}</Td><Td className="text-right tabular-nums">{fmtMoney(r.total_cost)}</Td></tr>)}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
