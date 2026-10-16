'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Btn, Card, EmptyState, LoadingBlock, PageHeader, Pagination, SelectBox, StatusBadge, Table, Td, Th } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';
import { fmtDateTime } from '@/lib/itsm/format';

type Row = { id: string; to: string; subject: string; status: string; attempts: number; last_error: string; sent_at: string | null; created_at: string };

export default function EmailOutboxPage() {
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const { data, isLoading, refetch } = useQuery({ queryKey: ['outbox', status, page], queryFn: () => v2.list<Row>('/email-outbox', { status, page, per_page: 50 }), refetchInterval: 30_000 });
  const retry = useMutation({
    mutationFn: () => v2.post<{ message: string }>('/email-outbox/retry'),
    onSuccess: (r) => {
      toast.success(r.message);
      refetch();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  return (
    <>
      <PageHeader title="Email delivery log" subtitle="Every notification email the service desk generated and whether it was delivered." breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Email delivery' }]}
        actions={
          <>
            <Btn icon={<RefreshCw className="h-4 w-4" />} loading={retry.isPending} onClick={() => retry.mutate()}>Retry failed</Btn>
            <SelectBox aria-label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} placeholder="Any status" className="w-40" options={['queued', 'sent', 'failed', 'skipped'].map((v) => ({ value: v, label: v }))} />
          </>
        } />
      <Card padded={false}>
        {isLoading ? <LoadingBlock /> : (data?.items ?? []).length === 0 ? <EmptyState title="No emails yet" /> : (
          <Table>
            <thead><tr><Th>Queued</Th><Th>To</Th><Th>Subject</Th><Th>Status</Th><Th>Details</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data!.items.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at)}</Td>
                  <Td className="text-sm">{r.to}</Td>
                  <Td className="max-w-md truncate text-sm">{r.subject}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td className="text-xs text-slate-500">{r.status === 'sent' ? `Sent ${fmtDateTime(r.sent_at)}` : r.last_error || (r.attempts ? `${r.attempts} attempt(s)` : '—')}</Td>
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
