'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Mail, Phone, Plus } from 'lucide-react';
import { Avatar, Card, DefList, EmptyState, ErrorBlock, LinkBtn, LoadingBlock, PageHeader, StatusBadge, Stat, Badge } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useCan } from '@/lib/itsm/hooks';
import { fmtDate, timeAgo } from '@/lib/itsm/format';
import type { Asset, Person, Ticket } from '@/lib/itsm/types';

export default function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const { data, isLoading, error } = useQuery({
    queryKey: ['person', id],
    queryFn: () => v2.get<{ person: Person; recent_tickets: Ticket[]; assets: Asset[]; stats: { open: number; resolved: number; assigned: number } }>(`/people/${id}`),
  });
  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock message={parseApiError(error).message} />;
  const p = data.person;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: p.is_agent ? 'Agents' : 'Requesters', href: can('users.manage') ? (p.is_agent ? '/admin/agents' : '/admin/requesters') : undefined }, { label: p.name }]}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={p.name} src={p.avatar_url} size="lg" />
            <span>
              {p.name}
              <span className="mt-1 flex flex-wrap items-center gap-2 text-sm font-normal text-slate-500">
                {p.job_title && <span>{p.job_title}</span>}
                <Badge className={p.is_agent ? 'bg-blue-50 text-blue-700 ring-blue-600/20' : 'bg-slate-100 text-slate-700 ring-slate-500/20'}>{p.is_account_admin ? 'Account admin' : p.is_agent ? 'Agent' : 'Requester'}</Badge>
                {!p.active && <StatusBadge status="cancelled" label="Deactivated" />}
                {p.vip && <Badge className="bg-amber-100 text-amber-800 ring-amber-600/20">VIP</Badge>}
              </span>
            </span>
          </span>
        }
        actions={<LinkBtn href={`/tickets/new?requester_id=${p.id}`} size="sm" variant="primary" icon={<Plus className="h-4 w-4" />}>New ticket</LinkBtn>}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Open tickets" value={data.stats.open} href={`/tickets?view=all&requester_id=${p.id}`} />
            <Stat label="Resolved" value={data.stats.resolved} />
            {p.is_agent && <Stat label="Assigned to them" value={data.stats.assigned} tone="blue" href={`/tickets?view=open&responder_id=${p.id}`} />}
          </div>
          <Card title="Recent tickets" padded={false}>
            {data.recent_tickets.length === 0 ? <EmptyState title="No tickets raised" /> : (
              <ul className="divide-y divide-slate-100">
                {data.recent_tickets.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tickets/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                      <span className="font-mono text-xs text-slate-500">{t.display_id}</span>
                      <span className="flex-1 truncate text-sm text-slate-900">{t.subject}</span>
                      <span className="text-xs text-slate-400">{timeAgo(t.created_at)}</span>
                      <StatusBadge status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Assets in use" padded={false}>
            {data.assets.length === 0 ? <EmptyState title="No assets assigned" /> : (
              <ul className="divide-y divide-slate-100">
                {data.assets.map((a) => (
                  <li key={a.id}>
                    <Link href={`/assets/${a.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                      <span className="flex-1 text-sm text-slate-900">{a.name}</span>
                      <span className="font-mono text-xs text-slate-400">{a.asset_tag}</span>
                      <StatusBadge status={a.state} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title="Contact">
          <div className="mb-4 space-y-2 text-sm">
            <a href={`mailto:${p.email}`} className="flex items-center gap-2 text-blue-700 hover:underline"><Mail className="h-4 w-4" />{p.email}</a>
            {p.phone && <div className="flex items-center gap-2 text-slate-700"><Phone className="h-4 w-4" />{p.phone}</div>}
            {p.mobile && <div className="flex items-center gap-2 text-slate-700"><Phone className="h-4 w-4" />{p.mobile} (mobile)</div>}
          </div>
          <DefList
            items={[
              { label: 'Department', value: p.department?.name ?? '—' },
              { label: 'Location', value: p.location?.name ?? '—' },
              { label: 'Reports to', value: p.reporting_manager?.name ?? '—' },
              { label: 'Time zone', value: p.time_zone || '—' },
              { label: 'Last sign in', value: p.last_login ? timeAgo(p.last_login) : 'Never' },
              { label: 'Member since', value: fmtDate(p.created_at) },
              ...(p.is_agent ? [{ label: 'Groups', value: p.groups.map((g) => g.name).join(', ') || '—' }, { label: 'Roles', value: p.roles.map((r) => r.name).join(', ') || '—' }] : []),
            ]}
          />
          {p.background && <p className="mt-4 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-600">{p.background}</p>}
        </Card>
      </div>
    </>
  );
}
