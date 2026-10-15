'use client';

import { AssetNav, typeOptions } from '@/components/desk/assets';
import { CrudPage } from '@/components/desk/crud';
import { FieldDefsEditor, FieldDef } from '@/components/desk/editors';
import { useAssetTypes, useCan } from '@/lib/itsm/hooks';
import type { AssetType } from '@/lib/itsm/types';

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'paragraph', label: 'Paragraph' },
];

export default function AssetTypesPage() {
  const can = useCan();
  const types = useAssetTypes();
  const name = (id: string | null) => types.data?.find((t) => t.id === id)?.name;
  return (
    <>
      <AssetNav />
      <CrudPage<AssetType>
        title="Asset types"
        subtitle="The CI type hierarchy. Child types inherit their parents' fields."
        singular="Asset type"
        listPath="/asset-types"
        queryKey={['lookup', 'asset-types']}
        canEdit={can('assets.manage')}
        searchable={(r, q) => r.name.toLowerCase().includes(q)}
        columns={[
          { label: 'Type', render: (r) => <span className="font-medium text-slate-900">{typeOptions(types.data ?? []).find((o) => o.value === r.id)?.label ?? r.name}</span> },
          { label: 'Parent', render: (r) => name(r.parent_id) ?? '—' },
          { label: 'Fields', render: (r) => r.fields?.length ?? 0 },
          { label: 'Assets', render: (r) => r.asset_count },
        ]}
        fields={(row) => [
          { name: 'name', label: 'Name', required: true, span: 1 },
          { name: 'parent_id', label: 'Parent type', type: 'select', span: 1, options: typeOptions(types.data ?? []).filter((o) => o.value !== row?.id) },
          { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
          { name: 'fields', label: 'Type-specific fields', type: 'custom', render: (v, onChange) => <FieldDefsEditor value={(v as FieldDef[]) ?? []} onChange={onChange} types={FIELD_TYPES} /> },
        ]}
        defaults={{ name: '', parent_id: '', description: '', fields: [] }}
        toForm={(r) => ({ name: r.name, parent_id: r.parent_id ?? '', description: r.description, fields: r.fields ?? [] })}
        toPayload={(v) => ({ ...v, parent_id: v.parent_id || '' })}
        drawerWidth="max-w-2xl"
      />
    </>
  );
}
