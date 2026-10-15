'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { AssetNav } from '@/components/desk/assets';
import { Btn, Card, DefList, EmptyState, ErrorBlock, Field, LoadingBlock, Modal, PageHeader, StatusBadge, TextInput } from '@/components/desk/kit';
import { useDebounced } from '@/components/desk/pickers';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useCan } from '@/lib/itsm/hooks';
import { fmtDate, labelize } from '@/lib/itsm/format';
import type { Asset, Contract, Software, UserBrief } from '@/lib/itsm/types';

interface Detail {
  software: Software;
  installations: { id: string; version: string; installed_at: string; user: UserBrief | null; asset: { id: string; name: string; display_id: string } }[];
  contracts: Contract[];
}

export default function SoftwareDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const can = useCan();
  const { data, isLoading, error } = useQuery({ queryKey: ['software', id], queryFn: () => v2.get<Detail>(`/software/${id}`) });
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [version, setVersion] = React.useState('');
  const term = useDebounced(q, 250);
  const assets = useQuery({ queryKey: ['asset-search', term], queryFn: () => v2.list<Asset>('/assets', { q: term, per_page: 10 }), enabled: open });
  const add = useMutation({
    mutationFn: (assetId: string) => v2.post(`/software/${id}/installations`, { asset_id: assetId, version }),
    onSuccess: () => {
      toast.success('Installation recorded');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['software'] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const remove = useMutation({ mutationFn: (iid: string) => v2.del(`/installations/${iid}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['software'] }) });
  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock message={parseApiError(error).message} />;
  const licenses = data.contracts.filter((c) => c.status === 'active').reduce((s, c) => s + (c.license_count || 0), 0);
  return (
    <>
      <PageHeader title={data.software.name} subtitle={data.software.publisher} breadcrumbs={[{ label: 'Software', href: '/assets/software' }, { label: data.software.name }]} />
      <AssetNav />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card title={`Installations (${data.installations.length})`} padded={false} actions={can('contracts.manage') && <Btn size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Record installation</Btn>}>
          {data.installations.length === 0 ? (
            <EmptyState title="No installations recorded" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.installations.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Link href={`/assets/${i.asset.id}`} className="flex-1 text-slate-900 hover:text-blue-700">{i.asset.name} <span className="font-mono text-xs text-slate-400">{i.asset.display_id}</span></Link>
                  <span className="text-xs text-slate-500">v{i.version || '—'} · {fmtDate(i.installed_at)}</span>
                  {can('contracts.manage') && <button aria-label="Remove installation" onClick={() => remove.mutate(i.id)} className="rounded p-1 text-slate-400 hover:text-rose-600"><X className="h-4 w-4" /></button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-5">
          <Card title="License position">
            <DefList items={[
              { label: 'Installations', value: data.installations.length },
              { label: 'Active licenses', value: licenses || '—' },
              { label: 'Status', value: labelize(data.software.status) },
              { label: 'Compliance', value: !licenses || data.installations.length <= licenses ? <span className="text-emerald-700">Compliant</span> : <span className="text-rose-600">Over by {data.installations.length - licenses}</span> },
            ]} />
          </Card>
          <Card title="License contracts">
            {data.contracts.length === 0 ? <p className="text-sm text-slate-500">Link a software license contract to track entitlement.</p> : (
              <ul className="space-y-2">
                {data.contracts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-sm"><span>{c.name} ({c.license_count})</span><StatusBadge status={c.status} /></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Record installation">
        <div className="space-y-3">
          <Field label="Version"><TextInput value={version} onChange={(e) => setVersion(e.target.value)} /></Field>
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the device…" />
          <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
            {(assets.data?.items ?? []).map((a) => (
              <li key={a.id}><button onClick={() => add.mutate(a.id)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">{a.name} <span className="font-mono text-xs text-slate-400">{a.asset_tag}</span></button></li>
            ))}
          </ul>
        </div>
      </Modal>
    </>
  );
}
