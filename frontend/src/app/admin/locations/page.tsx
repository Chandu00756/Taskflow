'use client';

import { CrudPage } from '@/components/desk/crud';
import { v2 } from '@/lib/itsm/api';
import { useLocations } from '@/lib/itsm/hooks';
import type { Location } from '@/lib/itsm/types';

export default function LocationsPage() {
  const locations = useLocations();
  const name = (id: string | null) => locations.data?.find((l) => l.id === id)?.name;
  return (
    <CrudPage<Location>
      title="Locations"
      subtitle="Offices, data centers and other sites."
      singular="Location"
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Locations' }]}
      listPath="/locations"
      queryKey={['lookup', 'locations', 'tree']}
      fetcher={async () => treeOrder(await v2.items<Location>('/locations'))}
      searchable={(r, q) => `${r.name} ${r.city} ${r.country}`.toLowerCase().includes(q)}
      columns={[
        { label: 'Location', render: (r) => <TreeName name={r.name} depth={(r as Location & { depth?: number }).depth ?? 0} /> },
        { label: 'Parent', render: (r) => name(r.parent_id) ?? '—' },
        { label: 'City', render: (r) => [r.city, r.state, r.country].filter(Boolean).join(', ') || '—' },
        { label: 'Contact', render: (r) => r.contact_name || '—' },
      ]}
      fields={(row) => [
        { name: 'name', label: 'Name', required: true, span: 1 },
        { name: 'parent_id', label: 'Parent location', type: 'select', span: 1, options: (locations.data ?? []).filter((l) => l.id !== row?.id).map((l) => ({ value: l.id, label: l.name })) },
        { name: 'address', label: 'Address' },
        { name: 'city', label: 'City', span: 1 },
        { name: 'state', label: 'State / region', span: 1 },
        { name: 'country', label: 'Country', span: 1 },
        { name: 'zip', label: 'Postal code', span: 1 },
        { name: 'contact_name', label: 'Contact name', span: 1 },
        { name: 'email', label: 'Contact email', type: 'email', span: 1 },
        { name: 'phone', label: 'Phone', span: 1 },
      ]}
      defaults={{ name: '', parent_id: '', address: '', city: '', state: '', country: '', zip: '', contact_name: '', email: '', phone: '' }}
      toForm={(r) => ({ ...r, parent_id: r.parent_id ?? '' })}
      toPayload={(v) => ({ ...v, parent_id: v.parent_id || null })}
    />
  );
}

function TreeName({ name, depth }: { name: string; depth: number }) {
  return (
    <span className="font-medium text-slate-900" style={{ paddingLeft: depth * 16 }}>
      {depth > 0 && <span className="mr-1 text-slate-400">↳</span>}
      {name}
    </span>
  );
}

/** Orders locations as a tree (parents before children) and records depth. */
function treeOrder(list: Location[]): (Location & { depth: number })[] {
  const byParent = new Map<string, Location[]>();
  const ids = new Set(list.map((l) => l.id));
  list.forEach((l) => {
    const key = l.parent_id && ids.has(l.parent_id) ? l.parent_id : '';
    byParent.set(key, [...(byParent.get(key) ?? []), l]);
  });
  const out: (Location & { depth: number })[] = [];
  const seen = new Set<string>();
  const walk = (parent: string, depth: number) => {
    (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name)).forEach((l) => {
      if (seen.has(l.id)) return;
      seen.add(l.id);
      out.push({ ...l, depth });
      walk(l.id, depth + 1);
    });
  };
  walk('', 0);
  list.forEach((l) => !seen.has(l.id) && out.push({ ...l, depth: 0 }));
  return out;
}
