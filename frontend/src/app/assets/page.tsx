'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Download, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { AssetNav } from '@/components/desk/assets';
import { Btn, Card, EmptyState, LinkBtn, LoadingBlock, PageHeader, Pagination, SearchInput, SelectBox, StatusBadge, Table, Td, Th } from '@/components/desk/kit';
import { useDebounced, useDepartmentOptions } from '@/components/desk/pickers';
import { v2, parseApiError, downloadFile } from '@/lib/itsm/api';
import { useAssetTypes, useCan } from '@/lib/itsm/hooks';
import { ASSET_STATES, fmtDate } from '@/lib/itsm/format';
import type { Asset, AssetType } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';

export default function AssetsPage() {
  const can = useCan();
  const types = useAssetTypes();
  const depts = useDepartmentOptions();
  const [typeId, setTypeId] = React.useState('');
  const [state, setState] = React.useState('');
  const [dept, setDept] = React.useState('');
  const [warranty, setWarranty] = React.useState('');
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(1);
  const term = useDebounced(q, 300);
  React.useEffect(() => setPage(1), [typeId, state, dept, term, warranty]);
  const { data, isLoading, error } = useQuery({
    queryKey: ['assets', typeId, state, dept, term, warranty, page],
    queryFn: () => v2.list<Asset>('/assets', { asset_type_id: typeId, state, department_id: dept, q: term, warranty, page, per_page: 30, sort: 'name', order: 'asc' }),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader
        title="Assets"
        subtitle="Configuration items across hardware, software, network and cloud."
        actions={
          <>
            <Btn size="sm" icon={<Download className="h-4 w-4" />} onClick={() => downloadFile('/assets/export', 'assets.csv').catch((e) => toast.error(parseApiError(e).message))}>
              Export
            </Btn>
            {can('assets.manage') && (
              <LinkBtn href="/assets/new" variant="primary" size="sm" icon={<Plus className="h-4 w-4" />}>
                New asset
              </LinkBtn>
            )}
          </>
        }
      />
      <AssetNav />
      <div className="flex flex-col gap-5 lg:flex-row">
        <aside className="shrink-0 lg:w-56">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Asset types</div>
          <TypeTree types={types.data ?? []} value={typeId} onChange={setTypeId} />
        </aside>
        <div className="min-w-0 flex-1">
          <Card padded={false}>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
              <SearchInput value={q} onChange={setQ} placeholder="Search name, tag, serial, hostname…" className="w-full sm:w-72" />
              <SelectBox aria-label="State" value={state} onChange={setState} placeholder="Any state" options={ASSET_STATES} className="w-36" />
              <SelectBox aria-label="Department" value={dept} onChange={setDept} placeholder="Any department" options={depts} className="w-44" />
              <SelectBox aria-label="Warranty" value={warranty} onChange={setWarranty} placeholder="Any warranty" options={[{ value: 'expiring', label: 'Expiring in 30 days' }]} className="w-44" />
            </div>
            {isLoading ? (
              <LoadingBlock />
            ) : error ? (
              <div className="p-6 text-center text-sm text-rose-600">{parseApiError(error).message}</div>
            ) : (data?.items ?? []).length === 0 ? (
              <EmptyState icon={<Boxes className="h-6 w-6" />} title="No assets found" action={can('assets.manage') ? <LinkBtn href="/assets/new" variant="primary" size="sm">Add an asset</LinkBtn> : undefined} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Asset</Th>
                    <Th>Type</Th>
                    <Th>State</Th>
                    <Th>Used by</Th>
                    <Th>Location</Th>
                    <Th>Warranty</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data!.items.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <Td>
                        <Link href={`/assets/${a.id}`} className="block">
                          <div className="font-medium text-slate-900 hover:text-blue-700">{a.name}</div>
                          <div className="text-xs text-slate-500">
                            <span className="font-mono">{a.asset_tag}</span>
                            {a.serial_number && ` · SN ${a.serial_number}`}
                          </div>
                        </Link>
                      </Td>
                      <Td>{a.asset_type?.name}</Td>
                      <Td><StatusBadge status={a.state} /></Td>
                      <Td>{a.user?.name ?? '—'}</Td>
                      <Td>{a.location?.name ?? '—'}</Td>
                      <Td className={cn(a.warranty_expiry && new Date(a.warranty_expiry) < new Date() && 'text-rose-600')}>{fmtDate(a.warranty_expiry)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {data && <Pagination page={data.page} perPage={data.per_page} total={data.total} onPage={setPage} />}
          </Card>
        </div>
      </div>
    </>
  );
}

function TypeTree({ types, value, onChange }: { types: AssetType[]; value: string; onChange: (v: string) => void }) {
  const children = React.useMemo(() => {
    const m = new Map<string, AssetType[]>();
    types.forEach((t) => m.set(t.parent_id ?? '', [...(m.get(t.parent_id ?? '') ?? []), t]));
    return m;
  }, [types]);
  const total = (id: string): number => {
    const t = types.find((x) => x.id === id);
    return (t?.asset_count ?? 0) + (children.get(id) ?? []).reduce((s, c) => s + total(c.id), 0);
  };
  const render = (parent: string, depth: number): React.ReactNode =>
    (children.get(parent) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => (
        <React.Fragment key={t.id}>
          <button
            onClick={() => onChange(t.id)}
            style={{ paddingLeft: 12 + depth * 14 }}
            className={cn('flex w-full items-center justify-between rounded-md py-1.5 pr-2 text-left text-sm', value === t.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100')}
          >
            <span className="truncate">{t.name}</span>
            <span className="text-xs text-slate-400">{total(t.id)}</span>
          </button>
          {render(t.id, depth + 1)}
        </React.Fragment>
      ));
  return (
    <nav className="space-y-0.5">
      <button onClick={() => onChange('')} className={cn('block w-full rounded-md px-3 py-1.5 text-left text-sm', !value ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100')}>
        All assets
      </button>
      {render('', 0)}
    </nav>
  );
}
