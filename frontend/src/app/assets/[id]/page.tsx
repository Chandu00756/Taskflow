'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { AssetNav, assetPayload, inheritedFields, useAssetFields } from '@/components/desk/assets';
import { SchemaForm, FieldSpec } from '@/components/desk/crud';
import { Btn, Card, DefList, EmptyState, ErrorBlock, Field, LoadingBlock, Modal, PageHeader, SelectBox, StatusBadge, Tabs, TextInput, useConfirm, Badge } from '@/components/desk/kit';
import { AssociationsPanel, ActivityList } from '@/components/desk/record-panels';
import { useDebounced } from '@/components/desk/pickers';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useAssetTypes, useCan } from '@/lib/itsm/hooks';
import { fmtDate, fmtMoney, labelize, toDateInput } from '@/lib/itsm/format';
import type { Activity, Asset, Contract } from '@/lib/itsm/types';

interface Relationship {
  id: string;
  type: string;
  label: string;
  direction: string;
  asset: { id: string; name: string; display_id: string; state: string; impact: string };
}

interface AssetDetail {
  asset: Asset;
  history: Activity[];
  contracts: Contract[];
  software: { id: string; software_id: string; name: string; publisher: string; version: string; installed_at: string }[];
  relationships: Relationship[];
}

const REL_TYPES = [
  { value: 'depends_on', label: 'Depends on' },
  { value: 'runs_on', label: 'Runs on' },
  { value: 'hosted_on', label: 'Hosted on' },
  { value: 'connected_to', label: 'Connected to' },
  { value: 'contains', label: 'Contains' },
  { value: 'member_of', label: 'Member of' },
  { value: 'backed_up_by', label: 'Backed up by' },
  { value: 'sends_data_to', label: 'Sends data to' },
];

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const can = useCan();
  const confirm = useConfirm();
  const types = useAssetTypes();
  const [tab, setTab] = React.useState('details');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['asset', id], queryFn: () => v2.get<AssetDetail>(`/assets/${id}`) });
  const { main, assignment, procurement } = useAssetFields(types.data ?? []);
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const initial = React.useMemo(() => {
    if (!data) return {};
    const a = data.asset;
    const v: Record<string, unknown> = {
      name: a.name, asset_type_id: a.asset_type_id, asset_tag: a.asset_tag, serial_number: a.serial_number, state: a.state, impact: a.impact,
      usage_type: a.usage_type, description: a.description, user_id: a.user_id ?? '', user_id__label: a.user?.name, department_id: a.department_id ?? '',
      location_id: a.location_id ?? '', agent_id: a.agent_id ?? '', group_id: a.group_id ?? '', product_id: a.product_id ?? '', vendor_id: a.vendor_id ?? '',
      cost: a.cost, acquisition_date: toDateInput(a.acquisition_date), warranty_expiry: toDateInput(a.warranty_expiry), end_of_life: toDateInput(a.end_of_life), tags: a.tags,
    };
    Object.entries(a.type_fields ?? {}).forEach(([k, val]) => (v[`tf_${k}`] = val));
    return v;
  }, [data]);
  React.useEffect(() => setValues(initial), [initial]);
  const typeFields = inheritedFields(types.data ?? [], String(values.asset_type_id ?? ''));
  const specFields: FieldSpec[] = typeFields.map((f) => ({
    name: `tf_${f.name}`,
    label: f.label,
    type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'dropdown' ? 'select' : f.type === 'checkbox' ? 'checkbox' : f.type === 'paragraph' ? 'textarea' : 'text',
    options: (f.choices ?? []).map((c) => ({ value: c, label: c })),
    span: 1,
  }));
  const refresh = () => qc.invalidateQueries({ queryKey: ['asset', id] });
  const save = useMutation({
    mutationFn: () => v2.put(`/assets/${id}`, assetPayload(values, typeFields.map((f) => f.name))),
    onSuccess: () => {
      toast.success('Asset updated');
      setErrors({});
      refresh();
      qc.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      toast.error(err.message);
    },
  });
  const trash = useMutation({
    mutationFn: (del: boolean) => (del ? v2.del(`/assets/${id}`) : v2.post(`/assets/${id}/restore`)),
    onSuccess: (_d, del) => {
      toast.success(del ? 'Asset moved to trash' : 'Asset restored');
      if (del) router.push('/assets');
      else refresh();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock message={parseApiError(error).message} onRetry={() => refetch()} />;
  const a = data.asset;
  const manage = can('assets.manage');
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Assets', href: '/assets' }, { label: a.display_id }]}
        title={a.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{a.asset_tag}</span>
            <StatusBadge status={a.state} />
            <Badge className="bg-slate-100 text-slate-700 ring-slate-500/20">{a.asset_type?.name}</Badge>
            <Badge className={a.impact === 'high' ? 'bg-rose-50 text-rose-700 ring-rose-600/20' : 'bg-slate-50 text-slate-600 ring-slate-500/20'}>{labelize(a.impact)} impact</Badge>
          </span>
        }
        actions={
          manage &&
          (a.is_deleted ? (
            <Btn size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => trash.mutate(false)}>Restore</Btn>
          ) : (
            <Btn size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={async () => (await confirm({ title: 'Move asset to trash?', danger: true, confirmLabel: 'Move to trash' })) && trash.mutate(true)}>
              Delete
            </Btn>
          ))
        }
      />
      <AssetNav />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'details', label: 'Details' },
              { value: 'relationships', label: 'Relationships', count: data.relationships.length },
              { value: 'associations', label: 'Tickets & changes' },
              { value: 'contracts', label: 'Contracts', count: data.contracts.length },
              { value: 'software', label: 'Software', count: data.software.length },
              { value: 'history', label: 'History' },
            ]}
          />
          {tab === 'details' && (
            <div className="space-y-5">
              <Card title="General"><SchemaForm fields={main} values={values} onChange={manage ? setValues : () => undefined} errors={errors} /></Card>
              {specFields.length > 0 && <Card title="Specifications"><SchemaForm fields={specFields} values={values} onChange={manage ? setValues : () => undefined} errors={errors} /></Card>}
              <Card title="Assignment"><SchemaForm fields={assignment} values={values} onChange={manage ? setValues : () => undefined} errors={errors} /></Card>
              <Card title="Procurement"><SchemaForm fields={procurement} values={values} onChange={manage ? setValues : () => undefined} errors={errors} /></Card>
              {manage && (
                <div className="flex justify-end">
                  <Btn variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save changes</Btn>
                </div>
              )}
            </div>
          )}
          {tab === 'relationships' && <Relationships assetId={id} items={data.relationships} manage={manage} onChange={refresh} />}
          {tab === 'associations' && <AssociationsPanel module="assets" id={id} canManage={manage} allowed={['ticket', 'problem', 'change', 'release']} />}
          {tab === 'contracts' && (
            <Card padded={false}>
              {data.contracts.length === 0 ? (
                <EmptyState title="No contracts cover this asset" action={<Link href="/assets/contracts" className="text-sm font-medium text-blue-600">Manage contracts</Link>} />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.contracts.map((c) => (
                    <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div>
                        <div className="font-medium text-slate-900">{c.name}</div>
                        <div className="text-xs text-slate-500">{labelize(c.contract_type)} · {fmtDate(c.start_date)} → {fmtDate(c.end_date)}</div>
                      </div>
                      <StatusBadge status={c.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {tab === 'software' && (
            <Card padded={false}>
              {data.software.length === 0 ? (
                <EmptyState title="No software recorded on this asset" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.software.map((s) => (
                    <li key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
                      <Link href={`/assets/software/${s.software_id}`} className="font-medium text-slate-900 hover:text-blue-700">{s.name}</Link>
                      <span className="text-xs text-slate-500">{s.publisher} · v{s.version || '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {tab === 'history' && <Card><ActivityList items={data.history} /></Card>}
        </div>
        <div className="space-y-5">
          <Card title="Summary">
            <DefList
              items={[
                { label: 'Used by', value: a.user ? <Link href={`/people/${a.user.id}`} className="text-blue-700 hover:underline">{a.user.name}</Link> : '—' },
                { label: 'Assigned on', value: fmtDate(a.assigned_on) },
                { label: 'Department', value: a.department?.name ?? '—' },
                { label: 'Location', value: a.location?.name ?? '—' },
                { label: 'Managed by', value: a.agent?.name ?? a.group?.name ?? '—' },
                { label: 'Cost', value: fmtMoney(a.cost) },
                { label: 'Warranty', value: fmtDate(a.warranty_expiry) },
                { label: 'Vendor', value: a.vendor?.name ?? '—' },
              ]}
            />
          </Card>
          <ImpactCard assetId={id} />
        </div>
      </div>
    </>
  );
}

function Relationships({ assetId, items, manage, onChange }: { assetId: string; items: Relationship[]; manage: boolean; onChange: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState('depends_on');
  const [q, setQ] = React.useState('');
  const term = useDebounced(q, 250);
  const results = useQuery({ queryKey: ['asset-search', term], queryFn: () => v2.list<Asset>('/assets', { q: term, per_page: 10 }), enabled: open });
  const add = useMutation({
    mutationFn: (target: string) => v2.post(`/assets/${assetId}/relationships`, { target_id: target, type }),
    onSuccess: () => {
      toast.success('Relationship added');
      setOpen(false);
      setQ('');
      onChange();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const del = useMutation({ mutationFn: (rid: string) => v2.del(`/relationships/${rid}`), onSuccess: onChange, onError: (e) => toast.error(parseApiError(e).message) });
  return (
    <Card title="CMDB relationships" actions={manage && <Btn size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Add relationship</Btn>} padded={false}>
      {items.length === 0 ? (
        <EmptyState icon={<Network className="h-6 w-6" />} title="No relationships" description="Map dependencies (runs on, hosted on, depends on) to analyse the impact of outages and changes." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-32 shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">{r.label}</span>
              <Link href={`/assets/${r.asset.id}`} className="min-w-0 flex-1 truncate text-slate-900 hover:text-blue-700">
                {r.asset.name} <span className="font-mono text-xs text-slate-400">{r.asset.display_id}</span>
              </Link>
              <StatusBadge status={r.asset.state} />
              {manage && r.direction === 'outgoing' && (
                <button aria-label="Remove relationship" onClick={() => del.mutate(r.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"><X className="h-4 w-4" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add relationship">
        <div className="space-y-3">
          <Field label="This asset…">
            <SelectBox value={type} onChange={setType} options={REL_TYPES} />
          </Field>
          <TextInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assets…" />
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
            {(results.data?.items ?? []).filter((x) => x.id !== assetId).map((x) => (
              <li key={x.id}>
                <button onClick={() => add.mutate(x.id)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <span>{x.name} <span className="font-mono text-xs text-slate-400">{x.asset_tag}</span></span>
                  <span className="text-xs text-slate-500">{x.asset_type?.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </Card>
  );
}

function ImpactCard({ assetId }: { assetId: string }) {
  const { data } = useQuery({ queryKey: ['asset-impact', assetId], queryFn: () => v2.items<{ asset: Asset; depth: number }>(`/assets/${assetId}/impact`) });
  return (
    <Card title="Impact analysis">
      {(data ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">No other configuration items depend on this asset.</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-500">If this asset fails, these items are affected:</p>
          <ul className="space-y-1.5">
            {data!.map((i) => (
              <li key={i.asset.id} className="flex items-center justify-between gap-2 text-sm">
                <Link href={`/assets/${i.asset.id}`} className="truncate text-slate-800 hover:text-blue-700" style={{ paddingLeft: (i.depth - 1) * 12 }}>
                  {i.asset.name}
                </Link>
                <Badge className={i.asset.impact === 'high' ? 'bg-rose-50 text-rose-700 ring-rose-600/20' : 'bg-slate-50 text-slate-600 ring-slate-500/20'}>{labelize(i.asset.impact)}</Badge>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
