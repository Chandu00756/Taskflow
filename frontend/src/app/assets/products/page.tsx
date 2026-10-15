'use client';

import { AssetNav, typeOptions } from '@/components/desk/assets';
import { CrudPage } from '@/components/desk/crud';
import { StatusBadge } from '@/components/desk/kit';
import { useAssetTypes, useCan } from '@/lib/itsm/hooks';
import { labelize } from '@/lib/itsm/format';
import type { Product } from '@/lib/itsm/types';

export default function ProductsPage() {
  const can = useCan();
  const types = useAssetTypes();
  const typeName = (id: string | null) => types.data?.find((t) => t.id === id)?.name ?? '—';
  return (
    <>
      <AssetNav />
      <CrudPage<Product>
        title="Products"
        subtitle="Makes and models you buy, used when creating assets and purchase orders."
        singular="Product"
        listPath="/products"
        queryKey={['lookup', 'products']}
        canEdit={can('assets.manage')}
        searchable={(r, q) => r.name.toLowerCase().includes(q) || r.manufacturer.toLowerCase().includes(q)}
        columns={[
          { label: 'Product', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
          { label: 'Manufacturer', render: (r) => r.manufacturer || '—' },
          { label: 'Asset type', render: (r) => typeName(r.asset_type_id) },
          { label: 'Procurement', render: (r) => labelize(r.procurement_mode) },
          { label: 'Status', render: (r) => <StatusBadge status={r.status === 'in_production' ? 'active' : r.status === 'retired' ? 'retired' : 'scheduled'} label={labelize(r.status)} /> },
        ]}
        fields={[
          { name: 'name', label: 'Name', required: true },
          { name: 'manufacturer', label: 'Manufacturer', span: 1 },
          { name: 'asset_type_id', label: 'Asset type', type: 'select', options: typeOptions(types.data ?? []), span: 1 },
          { name: 'status', label: 'Status', type: 'select', required: true, span: 1, options: [{ value: 'in_production', label: 'In production' }, { value: 'in_pipeline', label: 'In pipeline' }, { value: 'retired', label: 'Retired' }] },
          { name: 'procurement_mode', label: 'Procurement', type: 'select', required: true, span: 1, options: [{ value: 'buy', label: 'Buy' }, { value: 'lease', label: 'Lease' }, { value: 'both', label: 'Buy or lease' }] },
          { name: 'description', label: 'Description', type: 'textarea', rows: 3 },
        ]}
        defaults={{ name: '', manufacturer: '', asset_type_id: '', status: 'in_production', procurement_mode: 'buy', description: '' }}
        toPayload={(v) => ({ ...v, asset_type_id: v.asset_type_id || null })}
      />
    </>
  );
}
