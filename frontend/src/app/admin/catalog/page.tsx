'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CrudPage } from '@/components/desk/crud';
import { StatusBadge, Tabs } from '@/components/desk/kit';
import { FieldDefsEditor, FieldDef } from '@/components/desk/editors';
import { CatalogIcon, CATALOG_ICON_NAMES } from '@/components/desk/catalog-icon';
import { useAgentOptions, useDepartmentOptions, useGroupOptions } from '@/components/desk/pickers';
import { v2 } from '@/lib/itsm/api';
import { fmtMoney } from '@/lib/itsm/format';
import type { CatalogCategory, CatalogItem } from '@/lib/itsm/types';

const FIELD_TYPES = [
  { value: 'text', label: 'Text' }, { value: 'paragraph', label: 'Paragraph' }, { value: 'number', label: 'Number' }, { value: 'dropdown', label: 'Dropdown' },
  { value: 'multi_select', label: 'Multi-select' }, { value: 'checkbox', label: 'Checkbox' }, { value: 'date', label: 'Date' },
];

export default function CatalogAdminPage() {
  const [tab, setTab] = React.useState('items');
  const cats = useQuery({ queryKey: ['catalog', 'admin'], queryFn: () => v2.get<{ categories: CatalogCategory[]; items: CatalogItem[] }>('/catalog') });
  const agents = useAgentOptions();
  const groups = useGroupOptions();
  const depts = useDepartmentOptions();
  const categories = cats.data?.categories ?? [];
  return (
    <>
      {tab === 'items' ? (
        <CrudPage<CatalogItem>
          title="Service catalog"
          beforeTable={<Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ value: 'items', label: 'Catalog items' }, { value: 'categories', label: 'Categories' }]} />}
          subtitle="Services employees can request from the portal, with custom forms, approvals and fulfilment groups."
          singular="Catalog item"
          breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Service catalog' }]}
          listPath="/catalog/items"
          queryKey={['catalog', 'admin', 'items']}
          fetcher={async () => (await v2.get<{ items: CatalogItem[] }>('/catalog')).items}
          searchable={(r, q) => r.name.toLowerCase().includes(q)}
          columns={[
            { label: 'Item', render: (r) => <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600"><CatalogIcon name={r.icon} className="h-4 w-4" /></span><div><div className="font-medium text-slate-900">{r.name}</div><div className="text-xs text-slate-500">{r.short_description}</div></div></div> },
            { label: 'Category', render: (r) => categories.find((c) => c.id === r.category_id)?.name ?? '—' },
            { label: 'Cost', render: (r) => (r.cost ? fmtMoney(r.cost) : 'Free') },
            { label: 'Approval', render: (r) => (r.approval_required ? r.approver_type.replace('_', ' ') : '—') },
            { label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
          fields={[
            { name: 'name', label: 'Name', required: true, span: 1 },
            { name: 'category_id', label: 'Category', type: 'select', span: 1, options: categories.map((c) => ({ value: c.id, label: c.name })) },
            { name: 'short_description', label: 'Short description' },
            { name: 'description', label: 'Full description (Markdown)', type: 'textarea', rows: 4 },
            { name: 'icon', label: 'Icon', type: 'select', span: 1, options: CATALOG_ICON_NAMES.map((n) => ({ value: n, label: n })) },
            { name: 'status', label: 'Status', type: 'select', required: true, span: 1, options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }] },
            { name: 'cost', label: 'Cost', type: 'number', span: 1 },
            { name: 'delivery_hours', label: 'Delivery time (business hours)', type: 'number', span: 1 },
            { name: 'quantity_enabled', label: 'Allow requesting multiple', type: 'checkbox' },
            { name: 'allow_attachments', label: 'Allow attachments', type: 'checkbox' },
            { name: 'fields', label: 'Request form', type: 'custom', render: (v, onChange) => <FieldDefsEditor value={(v as FieldDef[]) ?? []} onChange={onChange} types={FIELD_TYPES} withRequired /> },
            { name: 'approval_required', label: 'Requires approval', type: 'toggle' },
            { name: 'approver_type', label: 'Approver', type: 'select', span: 1, show: (v) => !!v.approval_required, options: [{ value: 'reporting_manager', label: "Requester's manager" }, { value: 'department_head', label: 'Department head' }, { value: 'specific', label: 'Specific people' }] },
            { name: 'approver_ids', label: 'Approvers', type: 'multiselect', options: agents, show: (v) => !!v.approval_required && v.approver_type === 'specific' },
            { name: 'delivery_group_id', label: 'Fulfilment group', type: 'select', span: 1, options: groups },
            { name: 'delivery_agent_id', label: 'Fulfilment agent', type: 'select', span: 1, options: agents },
            { name: 'visibility', label: 'Visible to', type: 'select', span: 1, options: [{ value: 'all', label: 'Everyone' }, { value: 'departments', label: 'Selected departments' }] },
            { name: 'department_ids', label: 'Departments', type: 'multiselect', options: depts, show: (v) => v.visibility === 'departments' },
          ]}
          defaults={{ name: '', category_id: categories[0]?.id ?? '', short_description: '', description: '', icon: 'package', status: 'draft', cost: 0, delivery_hours: 24, quantity_enabled: false, allow_attachments: true, fields: [], approval_required: false, approver_type: 'reporting_manager', approver_ids: [], delivery_group_id: '', delivery_agent_id: '', visibility: 'all', department_ids: [] }}
          toForm={(r) => ({ ...r, category_id: r.category_id ?? '', delivery_group_id: r.delivery_group_id ?? '', delivery_agent_id: r.delivery_agent_id ?? '' })}
          toPayload={(v) => ({ ...v, cost: Number(v.cost || 0), delivery_hours: Number(v.delivery_hours || 0) })}
          onSaved={() => cats.refetch()}
          drawerWidth="max-w-3xl"
        />
      ) : (
        <CrudPage<CatalogCategory>
          title="Catalog categories"
          beforeTable={<Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ value: 'items', label: 'Catalog items' }, { value: 'categories', label: 'Categories' }]} />}
          singular="Category"
          breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Service catalog' }]}
          listPath="/catalog/categories"
          queryKey={['catalog', 'admin', 'categories']}
          fetcher={async () => (await v2.get<{ categories: CatalogCategory[] }>('/catalog')).categories}
          columns={[
            { label: 'Category', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
            { label: 'Description', render: (r) => r.description || '—' },
            { label: 'Position', render: (r) => r.position },
          ]}
          fields={[
            { name: 'name', label: 'Name', required: true },
            { name: 'description', label: 'Description' },
            { name: 'icon', label: 'Icon', type: 'select', span: 1, options: CATALOG_ICON_NAMES.map((n) => ({ value: n, label: n })) },
            { name: 'position', label: 'Position', type: 'number', span: 1 },
          ]}
          defaults={{ name: '', description: '', icon: 'package', position: categories.length + 1 }}
          toForm={(r) => ({ name: r.name, description: r.description, icon: r.icon, position: r.position })}
          toPayload={(v) => ({ ...v, position: Number(v.position || 0) })}
          onSaved={() => cats.refetch()}
        />
      )}
    </>
  );
}
