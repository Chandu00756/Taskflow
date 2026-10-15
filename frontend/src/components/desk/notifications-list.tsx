'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Card, EmptyState, LoadingBlock, Pagination, Tabs } from './kit';
import { notificationHref } from './shell';
import { v2 } from '@/lib/itsm/api';
import { fmtDateTime, timeAgo } from '@/lib/itsm/format';
import type { AppNotification } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';

export function NotificationsList({ portal = false }: { portal?: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = React.useState('all');
  const [page, setPage] = React.useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'page', tab, page],
    queryFn: () => v2.get<{ items: AppNotification[]; total: number; unread: number; page: number; per_page: number }>('/me/notifications', { unread: tab === 'unread' ? 1 : undefined, page, per_page: 30 }),
  });
  const mark = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => v2.post('/me/notifications/read', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <Card padded={false}>
      <div className="flex items-center justify-between px-4 pt-2">
        <Tabs className="border-0" value={tab} onChange={(v) => { setTab(v); setPage(1); }} tabs={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread', count: data?.unread }]} />
        {!!data?.unread && <Btn size="sm" variant="ghost" onClick={() => mark.mutate({ all: true })}>Mark all as read</Btn>}
      </div>
      {isLoading ? <LoadingBlock /> : (data?.items ?? []).length === 0 ? <EmptyState title="No notifications" /> : (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {data!.items.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => {
                  if (!n.read) mark.mutate({ ids: [n.id] });
                  const href = notificationHref(n, portal);
                  if (href) router.push(href);
                }}
                className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50', !n.read && 'bg-blue-50/40')}
              >
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-slate-200' : 'bg-blue-600')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-slate-900">{n.title}</span>
                  {n.message && <span className="block truncate text-sm text-slate-500">{n.message}</span>}
                </span>
                <span className="shrink-0 text-xs text-slate-400" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination page={data.page} perPage={data.per_page} total={data.total} onPage={setPage} />}
    </Card>
  );
}
