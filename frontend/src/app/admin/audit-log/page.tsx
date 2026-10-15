'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Card, EmptyState, LoadingBlock, PageHeader, Pagination, SearchInput, Table, Td, Th } from '@/components/desk/kit';
import { useDebounced } from '@/components/desk/pickers';
import { v2 } from '@/lib/itsm/api';
import { fmtDateTime } from '@/lib/itsm/format';
import type { UserBrief } from '@/lib/itsm/types';

type Row = { id: string; action: string; entity_type: string; summary: string; ip: string; actor: UserBrief | null; created_at: string };

export default function AuditLogPage() {
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(1);
  const term = useDebounced(q, 300);
  React.useEffect(() => setPage(1), [term]);
  const { data, isLoading } = useQuery({ queryKey: ['audit', term, page], queryFn: () => v2.list<Row>('/audit-logs', { action: term, page, per_page: 50 }), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Audit log" subtitle="Administrative changes across the account, newest first." breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Audit log' }]} />
      <Card padded={false}>
        <div className="border-b border-slate-100 p-3"><SearchInput value={q} onChange={setQ} placeholder="Filter by action (e.g. person, sla, settings)" className="max-w-sm" /></div>
        {isLoading ? <LoadingBlock /> : (data?.items ?? []).length === 0 ? <EmptyState title="No audit entries" /> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Details</Th><Th>IP</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data!.items.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at)}</Td>
                  <Td><span className="flex items-center gap-1.5"><Avatar name={r.actor?.name} src={r.actor?.avatar_url} size="xs" />{r.actor?.name ?? 'System'}</span></Td>
                  <Td><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.action}</code></Td>
                  <Td className="text-sm">{r.summary}</Td>
                  <Td className="font-mono text-xs text-slate-500">{r.ip || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {data && <Pagination page={data.page} perPage={data.per_page} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
