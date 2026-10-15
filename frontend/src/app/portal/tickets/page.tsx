'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Card, EmptyState, LinkBtn, LoadingBlock, Pagination, SearchInput, StatusBadge, Tabs } from '@/components/desk/kit';
import { useDebounced } from '@/components/desk/pickers';
import { v2 } from '@/lib/itsm/api';
import { fmtDate, timeAgo } from '@/lib/itsm/format';
import type { Ticket } from '@/lib/itsm/types';

export default function MyTicketsPage() {
  const [tab, setTab] = React.useState('open');
  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState('');
  const term = useDebounced(q, 300);
  React.useEffect(() => setPage(1), [tab, term]);
  const status = tab === 'open' ? 'open,pending' : tab === 'closed' ? 'resolved,closed' : undefined;
  const { data, isLoading } = useQuery({
    queryKey: ['portal', 'tickets', tab, page, term],
    queryFn: () => v2.list<Ticket>('/tickets', { view: 'raised_by_me', status, page, per_page: 20, q: term }),
    placeholderData: (p) => p,
  });
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">My tickets</h1>
          <p className="mt-1 text-sm text-slate-500">Track the issues and requests you have raised.</p>
        </div>
        <LinkBtn href="/portal/new" variant="primary" icon={<Plus className="h-4 w-4" />}>
          New ticket
        </LinkBtn>
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-2">
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Resolved & closed' }, { value: 'all', label: 'All' }]} className="border-0" />
          <SearchInput value={q} onChange={setQ} placeholder="Search your tickets" className="w-64 pb-2" />
        </div>
        {isLoading ? (
          <LoadingBlock />
        ) : (data?.items ?? []).length === 0 ? (
          <EmptyState title="No tickets here" description="When you report an issue or request a service it will appear here." />
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {data!.items.map((t) => (
              <li key={t.id}>
                <Link href={`/portal/tickets/${t.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3.5 hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-900">{t.subject}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {t.display_id} · Raised {fmtDate(t.created_at)} · Updated {timeAgo(t.updated_at)}
                      {t.responder && ` · ${t.responder.name} is working on it`}
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {data && <Pagination page={data.page} perPage={data.per_page} total={data.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
