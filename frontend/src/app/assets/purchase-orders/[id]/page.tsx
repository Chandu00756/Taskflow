'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageCheck, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AssetNav, typeOptions } from '@/components/desk/assets';
import { SchemaForm } from '@/components/desk/crud';
import { Btn, Card, LoadingBlock, Modal, PageHeader, SelectBox, StatusBadge, Table, Td, TextInput, Th } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useAssetTypes, useDepartments, useLocations, useVendors } from '@/lib/itsm/hooks';
import { fmtMoney, labelize, toDateInput } from '@/lib/itsm/format';
import type { POItem, PurchaseOrder } from '@/lib/itsm/types';

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const router = useRouter();
  const qc = useQueryClient();
  const vendors = useVendors();
  const depts = useDepartments();
  const types = useAssetTypes();
  const locations = useLocations();
  const { data, isLoading } = useQuery({ queryKey: ['purchase-order', id], queryFn: () => v2.get<{ purchase_order: PurchaseOrder; items: POItem[]; display_id: string }>(`/purchase-orders/${id}`), enabled: !isNew });
  const [values, setValues] = React.useState<Record<string, unknown>>({ name: '', status: 'open', currency: 'USD', tax_percent: 0, discount_percent: 0, shipping_cost: 0 });
  const [items, setItems] = React.useState<POItem[]>([{ item_type: 'asset', item_name: '', description: '', cost: 0, quantity: 1 }]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [receiving, setReceiving] = React.useState(false);
  React.useEffect(() => {
    if (!data) return;
    const po = data.purchase_order;
    setValues({ ...po, expected_delivery: toDateInput(po.expected_delivery), vendor_id: po.vendor_id ?? '', department_id: po.department_id ?? '' });
    setItems(data.items);
  }, [data]);
  const subtotal = items.reduce((s, i) => s + (Number(i.cost) || 0) * (Number(i.quantity) || 0), 0);
  const discounted = subtotal - (subtotal * Number(values.discount_percent || 0)) / 100;
  const total = discounted + (discounted * Number(values.tax_percent || 0)) / 100 + Number(values.shipping_cost || 0);
  const save = useMutation({
    mutationFn: () => {
      const body = { ...values, tax_percent: Number(values.tax_percent || 0), discount_percent: Number(values.discount_percent || 0), shipping_cost: Number(values.shipping_cost || 0),
        items: items.map((i) => ({ ...i, cost: Number(i.cost), quantity: Number(i.quantity) })) };
      return isNew ? v2.post<PurchaseOrder>('/purchase-orders', body) : v2.put<PurchaseOrder>(`/purchase-orders/${id}`, body);
    },
    onSuccess: (po) => {
      toast.success('Purchase order saved');
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['purchase-order', po.id] });
      if (isNew) router.replace(`/assets/purchase-orders/${po.id}`);
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      toast.error(err.message);
    },
  });
  if (!isNew && isLoading) return <LoadingBlock />;
  const status = String(values.status ?? 'open');
  const locked = status === 'received' || status === 'cancelled';
  const updateItem = (i: number, patch: Partial<POItem>) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <>
      <PageHeader
        title={isNew ? 'New purchase order' : String(values.name)}
        subtitle={!isNew && <span className="flex items-center gap-2"><span className="font-mono text-xs">{String(values.po_number)}</span><StatusBadge status={status} /></span>}
        breadcrumbs={[{ label: 'Purchase orders', href: '/assets/purchase-orders' }, { label: isNew ? 'New' : data?.display_id ?? '' }]}
        actions={
          <>
            {!isNew && !locked && ['ordered', 'partially_received', 'open'].includes(status) && <Btn size="sm" icon={<PackageCheck className="h-4 w-4" />} onClick={() => setReceiving(true)}>Receive items</Btn>}
            <Btn size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()} disabled={locked && !isNew}>Save</Btn>
          </>
        }
      />
      <AssetNav />
      <div className="space-y-5">
        <Card title="Order details">
          <SchemaForm
            values={values}
            onChange={setValues}
            errors={errors}
            fields={[
              { name: 'name', label: 'Name', required: true, span: 1 },
              { name: 'vendor_id', label: 'Vendor', type: 'select', required: true, span: 1, options: (vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })) },
              { name: 'po_number', label: 'PO number', span: 1, hint: 'Generated when left empty' },
              { name: 'status', label: 'Status', type: 'select', required: true, span: 1, options: ['open', 'ordered', 'partially_received', 'received', 'cancelled'].map((v) => ({ value: v, label: labelize(v) })) },
              { name: 'expected_delivery', label: 'Expected delivery', type: 'date', span: 1 },
              { name: 'department_id', label: 'Department', type: 'select', span: 1, options: (depts.data ?? []).map((d) => ({ value: d.id, label: d.name })) },
              { name: 'shipping_address', label: 'Shipping address', type: 'textarea', rows: 2, span: 1 },
              { name: 'billing_address', label: 'Billing address', type: 'textarea', rows: 2, span: 1 },
              { name: 'terms', label: 'Terms & conditions', type: 'textarea', rows: 2 },
            ]}
          />
        </Card>
        <Card title="Line items" padded={false}>
          {errors.items && <p className="px-4 pt-3 text-sm text-rose-600">{errors.items}</p>}
          <Table>
            <thead><tr><Th>Item</Th><Th>Type</Th><Th>Asset type</Th><Th className="w-28">Unit cost</Th><Th className="w-20">Qty</Th><Th className="w-20">Received</Th><Th className="text-right">Amount</Th><Th className="w-10" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it, i) => (
                <tr key={it.id ?? i}>
                  <Td><TextInput value={it.item_name} onChange={(e) => updateItem(i, { item_name: e.target.value })} placeholder="e.g. MacBook Air 13" disabled={locked} /></Td>
                  <Td><SelectBox value={it.item_type} onChange={(v) => updateItem(i, { item_type: v })} options={['asset', 'software', 'consumable', 'service'].map((v) => ({ value: v, label: labelize(v) }))} disabled={locked} /></Td>
                  <Td><SelectBox value={it.asset_type_id ?? ''} onChange={(v) => updateItem(i, { asset_type_id: v })} placeholder="—" options={typeOptions(types.data ?? [])} disabled={locked || it.item_type !== 'asset'} /></Td>
                  <Td><TextInput type="number" min={0} step="0.01" value={it.cost} onChange={(e) => updateItem(i, { cost: Number(e.target.value) })} disabled={locked} /></Td>
                  <Td><TextInput type="number" min={1} value={it.quantity} onChange={(e) => updateItem(i, { quantity: Number(e.target.value) })} disabled={locked} /></Td>
                  <Td className="tabular-nums">{it.received ?? 0}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney((Number(it.cost) || 0) * (Number(it.quantity) || 0))}</Td>
                  <Td>{!locked && items.length > 1 && <button aria-label="Remove line" onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex flex-wrap items-start justify-between gap-4 border-t border-slate-100 p-4">
            {!locked ? <Btn size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setItems([...items, { item_type: 'asset', item_name: '', description: '', cost: 0, quantity: 1 }])}>Add line</Btn> : <span />}
            <div className="w-72 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="tabular-nums">{fmtMoney(subtotal)}</span></div>
              <div className="flex items-center justify-between gap-2"><span className="text-slate-500">Discount %</span><TextInput type="number" className="w-24" value={String(values.discount_percent ?? 0)} onChange={(e) => setValues({ ...values, discount_percent: e.target.value })} disabled={locked} /></div>
              <div className="flex items-center justify-between gap-2"><span className="text-slate-500">Tax %</span><TextInput type="number" className="w-24" value={String(values.tax_percent ?? 0)} onChange={(e) => setValues({ ...values, tax_percent: e.target.value })} disabled={locked} /></div>
              <div className="flex items-center justify-between gap-2"><span className="text-slate-500">Shipping</span><TextInput type="number" className="w-24" value={String(values.shipping_cost ?? 0)} onChange={(e) => setValues({ ...values, shipping_cost: e.target.value })} disabled={locked} /></div>
              <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{fmtMoney(total, String(values.currency || 'USD'))}</span></div>
            </div>
          </div>
        </Card>
      </div>
      {!isNew && <ReceiveDialog open={receiving} onClose={() => setReceiving(false)} poId={id} items={items} locations={(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />}
    </>
  );
}

function ReceiveDialog({ open, onClose, poId, items, locations }: { open: boolean; onClose: () => void; poId: string; items: POItem[]; locations: { value: string; label: string }[] }) {
  const qc = useQueryClient();
  const [qty, setQty] = React.useState<Record<string, number>>({});
  const [location, setLocation] = React.useState('');
  const receive = useMutation({
    mutationFn: () => v2.post<{ created_asset_ids: string[] }>(`/purchase-orders/${poId}/receive`, { lines: Object.entries(qty).filter(([, q]) => q > 0).map(([id, quantity]) => ({ id, quantity, location_id: location })) }),
    onSuccess: (r) => {
      toast.success(`Items received${r.created_asset_ids.length ? ` — ${r.created_asset_ids.length} asset(s) added to inventory` : ''}`);
      setQty({});
      onClose();
      qc.invalidateQueries({ queryKey: ['purchase-order', poId] });
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  return (
    <Modal open={open} onClose={onClose} title="Receive items" size="lg" footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" loading={receive.isPending} onClick={() => receive.mutate()}>Receive</Btn></>}>
      <p className="mb-3 text-sm text-slate-600">Received asset lines with an asset type are added to the CMDB as “In stock”.</p>
      <div className="space-y-2">
        {items.filter((i) => i.id).map((i) => {
          const remaining = i.quantity - (i.received ?? 0);
          return (
            <div key={i.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm">
              <span>{i.item_name} <span className="text-xs text-slate-500">({remaining} remaining)</span></span>
              <TextInput type="number" min={0} max={remaining} className="w-24" value={qty[i.id!] ?? 0} onChange={(e) => setQty({ ...qty, [i.id!]: Math.max(0, Math.min(remaining, Number(e.target.value))) })} disabled={remaining <= 0} />
            </div>
          );
        })}
      </div>
      <div className="mt-4">
        <SelectBox value={location} onChange={setLocation} placeholder="Store at location (optional)" options={locations} />
      </div>
    </Modal>
  );
}
