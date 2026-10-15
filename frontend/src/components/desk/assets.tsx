'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useCan } from '@/lib/itsm/hooks';
import type { AssetType } from '@/lib/itsm/types';
import { FieldSpec } from './crud';
import { useAgentOptions, useDepartmentOptions, useGroupOptions } from './pickers';
import { useLocations, useProducts, useVendors } from '@/lib/itsm/hooks';
import { ASSET_STATES } from '@/lib/itsm/format';

export function AssetNav() {
  const pathname = usePathname();
  const can = useCan();
  const tabs = [
    { href: '/assets', label: 'Assets', exact: true },
    { href: '/assets/contracts', label: 'Contracts' },
    { href: '/assets/software', label: 'Software' },
    ...(can('contracts.manage') ? [{ href: '/assets/purchase-orders', label: 'Purchase orders' }] : []),
    { href: '/assets/vendors', label: 'Vendors' },
    { href: '/assets/products', label: 'Products' },
    ...(can('assets.manage') ? [{ href: '/assets/types', label: 'Asset types' }] : []),
  ];
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200">
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href || /^\/assets\/[0-9a-f-]{36}/.test(pathname) || pathname === '/assets/new' : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={cn('-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium', active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Orders asset types depth-first with indentation for selects. */
export function typeOptions(types: AssetType[]) {
  const children = new Map<string, AssetType[]>();
  types.forEach((t) => {
    const k = t.parent_id ?? '';
    children.set(k, [...(children.get(k) ?? []), t]);
  });
  const out: { value: string; label: string }[] = [];
  const walk = (parent: string, depth: number) => {
    (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name)).forEach((t) => {
      out.push({ value: t.id, label: `${'   '.repeat(depth)}${t.name}` });
      walk(t.id, depth + 1);
    });
  };
  walk('', 0);
  return out;
}

/** Fields defined on a type and all of its ancestors. */
export function inheritedFields(types: AssetType[], typeId: string) {
  const byId = new Map(types.map((t) => [t.id, t]));
  const chain: AssetType[] = [];
  let cur = byId.get(typeId);
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  const seen = new Set<string>();
  return chain.flatMap((t) => t.fields ?? []).filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)));
}

export function useAssetFields(types: AssetType[]) {
  const agents = useAgentOptions();
  const groups = useGroupOptions();
  const depts = useDepartmentOptions();
  const locations = useLocations();
  const vendors = useVendors();
  const products = useProducts();
  const main: FieldSpec[] = [
    { name: 'name', label: 'Name', required: true, span: 1 },
    { name: 'asset_type_id', label: 'Asset type', type: 'select', required: true, options: typeOptions(types), span: 1 },
    { name: 'asset_tag', label: 'Asset tag', span: 1, hint: 'Leave empty to auto-generate' },
    { name: 'serial_number', label: 'Serial number', span: 1 },
    { name: 'state', label: 'State', type: 'select', required: true, options: ASSET_STATES, span: 1 },
    { name: 'impact', label: 'Impact', type: 'select', required: true, options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }], span: 1 },
    { name: 'usage_type', label: 'Usage', type: 'select', required: true, options: [{ value: 'permanent', label: 'Permanent' }, { value: 'loaner', label: 'Loaner' }], span: 1 },
    { name: 'description', label: 'Description', type: 'textarea', rows: 3 },
  ];
  const assignment: FieldSpec[] = [
    { name: 'user_id', label: 'Used by', type: 'person', span: 1 },
    { name: 'department_id', label: 'Department', type: 'select', options: depts, span: 1 },
    { name: 'location_id', label: 'Location', type: 'select', options: (locations.data ?? []).map((l) => ({ value: l.id, label: l.name })), span: 1 },
    { name: 'agent_id', label: 'Managed by', type: 'select', options: agents, span: 1 },
    { name: 'group_id', label: 'Managed by group', type: 'select', options: groups, span: 1 },
  ];
  const procurement: FieldSpec[] = [
    { name: 'product_id', label: 'Product', type: 'select', options: (products.data ?? []).map((p) => ({ value: p.id, label: p.name })), span: 1 },
    { name: 'vendor_id', label: 'Vendor', type: 'select', options: (vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })), span: 1 },
    { name: 'cost', label: 'Cost', type: 'number', span: 1 },
    { name: 'acquisition_date', label: 'Acquisition date', type: 'date', span: 1 },
    { name: 'warranty_expiry', label: 'Warranty expiry', type: 'date', span: 1 },
    { name: 'end_of_life', label: 'End of life', type: 'date', span: 1 },
    { name: 'tags', label: 'Tags', type: 'tags' },
  ];
  return { main, assignment, procurement };
}

export function assetPayload(values: Record<string, unknown>, typeFieldNames: string[]) {
  const type_fields: Record<string, unknown> = {};
  typeFieldNames.forEach((n) => {
    if (values[`tf_${n}`] !== undefined) type_fields[n] = values[`tf_${n}`];
  });
  const out: Record<string, unknown> = {};
  Object.entries(values).forEach(([k, v]) => {
    if (!k.startsWith('tf_') && !k.endsWith('__label')) out[k] = v;
  });
  return { ...out, cost: values.cost === null || values.cost === '' || values.cost === undefined ? 0 : Number(values.cost), type_fields };
}
