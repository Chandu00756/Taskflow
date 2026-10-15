'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Columns3, Download, Filter, List, Plus, RefreshCw, Ticket as TicketIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, Btn, Card, EmptyState, LinkBtn, LoadingBlock, PageHeader, Pagination, PriorityBadge, SearchInput, SelectBox, SLABadge, StatusBadge, Table, Td, Th, useConfirm } from '@/components/desk/kit';
import { useAgentOptions, useDebounced, useGroupOptions } from '@/components/desk/pickers';
import { TicketBoard } from '@/components/desk/ticket-board';
import { v2, parseApiError, downloadFile } from '@/lib/itsm/api';
import { useCan, useMe } from '@/lib/itsm/hooks';
import { PRIORITIES, TICKET_SOURCES, TICKET_STATUSES, timeAgo, fmtDateTime, shortDue } from '@/lib/itsm/format';
import type { Ticket } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';
import { celebrate } from '@/lib/theme';

const VIEWS = [
  { value: 'open', label: 'All unresolved' },
  { value: 'my_open', label: 'My open tickets' },
  { value: 'my_groups', label: "My groups' tickets" },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_today', label: 'Due today' },
  { value: 'pending', label: 'Pending' },
  { value: 'watching', label: 'Watching' },
  { value: 'all', label: 'All tickets' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'spam', label: 'Spam' },
  { value: 'trash', label: 'Trash' },
];

const FILTER_KEYS = ['status', 'priority', 'group_id', 'responder_id', 'type', 'source', 'q', 'tag', 'category'] as const;

function TicketsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const can = useCan();
  const confirm = useConfirm();
  const { data: me } = useMe();
  const agentOptions = useAgentOptions();
  const groupOptions = useGroupOptions();

  const view = sp.get('view') || 'open';
  const layout = sp.get('layout') === 'board' ? 'board' : 'list';
  const page = Number(sp.get('page') || 1);
  const sort = sp.get('sort') || 'created_at';
  const order = sp.get('order') || 'desc';
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) || '']));
  const [search, setSearch] = React.useState(filters.q);
  const debouncedSearch = useDebounced(search, 350);
  const [showFilters, setShowFilters] = React.useState(FILTER_KEYS.some((k) => k !== 'q' && sp.get(k)));
  const [selected, setSelected] = React.useState<string[]>([]);

  const setParams = React.useCallback(
    (patch: Record<string, string | number | null>) => {
      const next = new URLSearchParams(sp.toString());
      Object.entries(patch).forEach(([k, v]) => {
        if (v === null || v === '') next.delete(k);
        else next.set(k, String(v));
      });
      if (!('page' in patch)) next.delete('page');
      router.replace(`${pathname}?${next.toString()}`);
    },
    [router, pathname, sp]
  );

  React.useEffect(() => {
    if (debouncedSearch !== filters.q) setParams({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // The board shows up to 100 tickets at once instead of paging.
  const params = { view, page: layout === 'board' ? 1 : page, per_page: layout === 'board' ? 100 : 30, sort, order, ...filters };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['tickets', params],
    queryFn: () => v2.list<Ticket>('/tickets', params),
    placeholderData: (prev) => prev,
  });
  React.useEffect(() => setSelected([]), [view, page, sort, order, sp]);

  const bulk = useMutation({
    mutationFn: (body: { action: string; properties?: Record<string, unknown> }) => v2.post<{ updated: number; failed: Record<string, string> }>('/tickets/bulk', { ids: selected, ...body }),
    onSuccess: (res, body) => {
      const failed = Object.keys(res.failed ?? {}).length;
      if (res.updated > 0 && (body.action === 'resolve' || body.action === 'close')) celebrate(res.updated > 4 ? 'big' : 'small');
      toast.success(`${res.updated} ticket${res.updated === 1 ? '' : 's'} updated${failed ? `, ${failed} skipped` : ''}`);
      if (failed) toast.warning(Object.values(res.failed)[0]);
      setSelected([]);
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && selected.length === items.length;
  const sortBy = (key: string) => setParams({ sort: key, order: sort === key && order === 'desc' ? 'asc' : 'desc' });
  const activeFilterCount = FILTER_KEYS.filter((k) => k !== 'q' && filters[k]).length;

  const exportCsv = async () => {
    try {
      await downloadFile(`/tickets/export?status=${filters.status}`, `tickets-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Tickets"
        subtitle={`${VIEWS.find((v) => v.value === view)?.label ?? 'Tickets'} · ${data?.total ?? 0} tickets`}
        actions={
          <>
            <Btn size="sm" variant="ghost" onClick={() => refetch()} icon={<RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />}>
              Refresh
            </Btn>
            {can('reports.view') && (
              <Btn size="sm" onClick={exportCsv} icon={<Download className="h-4 w-4" />}>
                Export
              </Btn>
            )}
            <LinkBtn href="/tickets/new" variant="primary" size="sm" icon={<Plus className="h-4 w-4" />}>
              New ticket
            </LinkBtn>
          </>
        }
      />
      <div className="flex flex-col gap-5 xl:flex-row">
        <aside className="hidden shrink-0 xl:block xl:w-52">
          <nav className="flex flex-col gap-1">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                onClick={() => setParams({ view: v.value })}
                className={cn(
                  'shrink-0 rounded-md px-3 py-1.5 text-left text-sm',
                  view === v.value ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100'
                )}
              >
                {v.label}
              </button>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <Card padded={false}>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
              <SelectBox aria-label="View" value={view} onChange={(v) => setParams({ view: v })} options={VIEWS} className="w-48 xl:hidden" />
              <SearchInput value={search} onChange={setSearch} placeholder="Search by subject, description or #number" className="w-full sm:w-72" />
              <div className="flex items-center rounded-md border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label="Layout">
                {([
                  { value: 'list', label: 'List', icon: List },
                  { value: 'board', label: 'Board', icon: Columns3 },
                ] as const).map((l) => (
                  <button
                    key={l.value}
                    role="radio"
                    aria-checked={layout === l.value}
                    aria-label={`${l.label} layout`}
                    title={`${l.label} view`}
                    onClick={() => setParams({ layout: l.value === 'list' ? null : 'board' })}
                    className={cn('flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-800', layout === l.value && 'bg-slate-100 text-slate-900')}
                  >
                    <l.icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{l.label}</span>
                  </button>
                ))}
              </div>
              <Btn size="sm" variant={showFilters ? 'subtle' : 'ghost'} onClick={() => setShowFilters((v) => !v)} icon={<Filter className="h-4 w-4" />}>
                Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
              </Btn>
              {activeFilterCount > 0 && (
                <Btn size="sm" variant="ghost" onClick={() => setParams(Object.fromEntries(FILTER_KEYS.filter((k) => k !== 'q').map((k) => [k, null])))} icon={<X className="h-4 w-4" />}>
                  Clear
                </Btn>
              )}
              <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
                Sort
                <SelectBox
                  aria-label="Sort tickets"
                  value={sort}
                  onChange={(v) => setParams({ sort: v })}
                  className="w-40"
                  options={[
                    { value: 'created_at', label: 'Date created' },
                    { value: 'updated_at', label: 'Last modified' },
                    { value: 'due_by', label: 'Due by' },
                    { value: 'priority', label: 'Priority' },
                    { value: 'status', label: 'Status' },
                  ]}
                />
              </div>
            </div>
            {showFilters && (
              <div className="grid grid-cols-2 gap-2 border-b border-slate-100 bg-slate-50/60 p-3 md:grid-cols-3 xl:grid-cols-6">
                <SelectBox aria-label="Status" value={filters.status} onChange={(v) => setParams({ status: v })} placeholder="Any status" options={[...TICKET_STATUSES, ...(me?.settings.custom_statuses ?? []).map((s) => ({ value: s.key, label: s.label }))]} />
                <SelectBox aria-label="Priority" value={filters.priority} onChange={(v) => setParams({ priority: v })} placeholder="Any priority" options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} />
                <SelectBox aria-label="Group" value={filters.group_id} onChange={(v) => setParams({ group_id: v })} placeholder="Any group" options={groupOptions} />
                <SelectBox aria-label="Agent" value={filters.responder_id} onChange={(v) => setParams({ responder_id: v })} placeholder="Any agent" options={[{ value: 'none', label: 'Unassigned' }, ...agentOptions]} />
                <SelectBox aria-label="Type" value={filters.type} onChange={(v) => setParams({ type: v })} placeholder="Any type" options={[{ value: 'incident', label: 'Incident' }, { value: 'service_request', label: 'Service request' }]} />
                <SelectBox aria-label="Source" value={filters.source} onChange={(v) => setParams({ source: v })} placeholder="Any source" options={TICKET_SOURCES} />
              </div>
            )}
            {layout === 'list' && selected.length > 0 && (
              <BulkBar
                count={selected.length}
                agentOptions={agentOptions}
                groupOptions={groupOptions}
                canDelete={can('tickets.delete')}
                busy={bulk.isPending}
                onAction={async (action, properties) => {
                  if (action === 'delete' || action === 'spam') {
                    const ok = await confirm({ title: action === 'delete' ? 'Move tickets to trash?' : 'Mark as spam?', message: `${selected.length} ticket(s) will be ${action === 'delete' ? 'moved to trash' : 'marked as spam'}.`, danger: true, confirmLabel: 'Continue' });
                    if (!ok) return;
                  }
                  bulk.mutate({ action, properties });
                }}
                onClear={() => setSelected([])}
              />
            )}
            {isLoading ? (
              <LoadingBlock />
            ) : error ? (
              <div className="p-6 text-center text-sm text-rose-600">{parseApiError(error).message}</div>
            ) : layout === 'board' ? (
              <>
                <TicketBoard
                  items={items}
                  canEdit={can('tickets.manage')}
                  statuses={[
                    TICKET_STATUSES[0],
                    TICKET_STATUSES[1],
                    ...(me?.settings.custom_statuses ?? []).map((s) => ({ value: s.key, label: s.label })),
                    TICKET_STATUSES[2],
                    TICKET_STATUSES[3],
                  ]}
                />
                {(data?.total ?? 0) > items.length && (
                  <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                    Showing the first {items.length} of {data?.total} tickets. Narrow the view or filters, or switch to the list to page through all of them.
                  </p>
                )}
              </>
            ) : items.length === 0 ? (
              <EmptyState
                icon={<TicketIcon className="h-6 w-6" />}
                title="No tickets match this view"
                description="Try another view or clear your filters."
                action={<LinkBtn href="/tickets/new" variant="primary" size="sm">Create a ticket</LinkBtn>}
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th className="w-8">
                      <input type="checkbox" aria-label="Select all" className="h-4 w-4 rounded border-slate-300" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? items.map((t) => t.id) : [])} />
                    </Th>
                    <Th onClick={() => sortBy('created_at')} sorted={sort === 'created_at' ? (order as 'asc' | 'desc') : null}>Ticket</Th>
                    <Th onClick={() => sortBy('status')} sorted={sort === 'status' ? (order as 'asc' | 'desc') : null}>Status</Th>
                    <Th onClick={() => sortBy('priority')} sorted={sort === 'priority' ? (order as 'asc' | 'desc') : null}>Priority</Th>
                    <Th>Group / Agent</Th>
                    <Th onClick={() => sortBy('due_by')} sorted={sort === 'due_by' ? (order as 'asc' | 'desc') : null}>Due</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {items.map((t) => (
                    <tr key={t.id} className={cn('hover:bg-slate-50', selected.includes(t.id) && 'bg-blue-50/40')}>
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${t.display_id}`}
                          className="h-4 w-4 rounded border-slate-300"
                          checked={selected.includes(t.id)}
                          onChange={(e) => setSelected((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))}
                        />
                      </Td>
                      <Td className="max-w-[520px]">
                        <Link href={`/tickets/${t.id}`} className="group block">
                          <div className="flex items-center gap-2">
                            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', t.type === 'incident' ? 'bg-rose-50 text-rose-700' : 'bg-violet-50 text-violet-700')}>
                              {t.type === 'incident' ? 'INC' : 'SR'}
                            </span>
                            <span className="truncate font-medium text-slate-900 group-hover:text-blue-700">{t.subject}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-500">
                            <span className="font-mono">{t.display_id}</span>·<span>{t.requester?.name ?? 'Unknown'}</span>·<span title={fmtDateTime(t.created_at)}>{timeAgo(t.created_at)}</span>
                            {t.tags.slice(0, 2).map((tag) => (
                              <span key={tag} className="hidden rounded bg-slate-100 px-1 text-[10px] text-slate-600 2xl:inline">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </Link>
                      </Td>
                      <Td>
                        <StatusBadge status={t.status} />
                      </Td>
                      <Td>
                        <PriorityBadge priority={t.priority} compact />
                      </Td>
                      <Td>
                        <div className="text-xs text-slate-500">{t.group?.name ?? '—'}</div>
                        <div className="flex items-center gap-1.5 text-sm">
                          {t.responder ? (
                            <>
                              <Avatar name={t.responder.name} src={t.responder.avatar_url} size="xs" />
                              {t.responder.name}
                            </>
                          ) : (
                            <span className="text-slate-400">Unassigned</span>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <div className="whitespace-nowrap text-xs text-slate-600" title={fmtDateTime(t.due_by)}>{t.status === 'resolved' || t.status === 'closed' ? '—' : shortDue(t.due_by)}</div>
                        <SLABadge state={t.sla_state} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {data && layout === 'list' && <Pagination page={data.page} perPage={data.per_page} total={data.total} onPage={(p) => setParams({ page: p })} />}
          </Card>
        </div>
      </div>
    </>
  );
}

function BulkBar({ count, agentOptions, groupOptions, canDelete, busy, onAction, onClear }: {
  count: number;
  agentOptions: { value: string; label: string }[];
  groupOptions: { value: string; label: string }[];
  canDelete: boolean;
  busy: boolean;
  onAction: (action: string, properties?: Record<string, unknown>) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-blue-100 bg-blue-50 px-3 py-2">
      <span className="text-sm font-medium text-blue-900">{count} selected</span>
      <SelectBox aria-label="Assign agent" value="" onChange={(v) => v && onAction('update', { responder_id: v })} placeholder="Assign agent…" options={agentOptions} className="w-44" disabled={busy} />
      <SelectBox aria-label="Assign group" value="" onChange={(v) => v && onAction('update', { group_id: v })} placeholder="Assign group…" options={groupOptions} className="w-44" disabled={busy} />
      <SelectBox aria-label="Set priority" value="" onChange={(v) => v && onAction('update', { priority: Number(v) })} placeholder="Set priority…" options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} className="w-36" disabled={busy} />
      <Btn size="sm" onClick={() => onAction('resolve')} disabled={busy}>
        Resolve
      </Btn>
      <Btn size="sm" onClick={() => onAction('close')} disabled={busy}>
        Close
      </Btn>
      {canDelete && (
        <>
          <Btn size="sm" onClick={() => onAction('spam')} disabled={busy}>
            Spam
          </Btn>
          <Btn size="sm" variant="danger" onClick={() => onAction('delete')} disabled={busy}>
            Delete
          </Btn>
        </>
      )}
      <Btn size="sm" variant="ghost" onClick={onClear} className="ml-auto">
        Cancel
      </Btn>
    </div>
  );
}

export default function TicketsPage() {
  return (
    <React.Suspense fallback={<LoadingBlock />}>
      <TicketsContent />
    </React.Suspense>
  );
}
