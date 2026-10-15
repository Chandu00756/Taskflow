'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CrudPage } from '@/components/desk/crud';
import { PageHeader, StatusBadge } from '@/components/desk/kit';
import { v2 } from '@/lib/itsm/api';
import { useDepartments } from '@/lib/itsm/hooks';
import type { KBCategory, KBFolder } from '@/lib/itsm/types';

const VISIBILITY = [
  { value: 'all', label: 'Everyone (portal and agents)' },
  { value: 'logged_in', label: 'Signed-in users' },
  { value: 'departments', label: 'Selected departments' },
  { value: 'agents', label: 'Agents only' },
];

export default function ManageSolutionsPage() {
  const tree = useQuery({ queryKey: ['kb-tree'], queryFn: () => v2.items<KBCategory>('/solutions') });
  const depts = useDepartments();
  const categories = tree.data ?? [];
  return (
    <>
      <PageHeader title="Categories & folders" subtitle="Organize the knowledge base and control who can see each folder." breadcrumbs={[{ label: 'Solutions', href: '/solutions' }, { label: 'Manage' }]} />
      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Categories</h2>
          <CrudPage<KBCategory>
            hideHeader
            title="Categories"
            singular="Category"
            listPath="/solutions"
            createPath="/solutions/categories"
            updatePath={(r) => `/solutions/categories/${r.id}`}
            deletePath={(r) => `/solutions/categories/${r.id}`}
            queryKey={['kb-tree']}
            columns={[
              { label: 'Name', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
              { label: 'Description', render: (r) => r.description || '—' },
              { label: 'Folders', render: (r) => r.folders.length },
            ]}
            fields={[
              { name: 'name', label: 'Name', required: true },
              { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
              { name: 'position', label: 'Position', type: 'number', span: 1 },
            ]}
            defaults={{ name: '', description: '', position: categories.length + 1 }}
            toForm={(r) => ({ name: r.name, description: r.description, position: r.position })}
          />
        </section>
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Folders</h2>
          <CrudPage<KBFolder & { category: string }>
            hideHeader
            title="Folders"
            singular="Folder"
            listPath="/solutions"
            createPath="/solutions/folders"
            updatePath={(r) => `/solutions/folders/${r.id}`}
            deletePath={(r) => `/solutions/folders/${r.id}`}
            queryKey={['kb-tree', 'folders-view']}
            fetcher={async () => (await v2.items<KBCategory>('/solutions')).flatMap((c) => c.folders.map((f) => ({ ...f, category: c.name })))}
            columns={[
              { label: 'Folder', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
              { label: 'Category', render: (r) => r.category },
              { label: 'Visibility', render: (r) => <StatusBadge status={r.visibility === 'agents' ? 'draft' : 'active'} label={VISIBILITY.find((v) => v.value === r.visibility)?.label} /> },
              { label: 'Articles', render: (r) => r.article_count },
            ]}
            fields={[
              { name: 'name', label: 'Name', required: true },
              { name: 'category_id', label: 'Category', type: 'select', required: true, options: categories.map((c) => ({ value: c.id, label: c.name })) },
              { name: 'visibility', label: 'Visible to', type: 'select', required: true, options: VISIBILITY },
              { name: 'department_ids', label: 'Departments', type: 'multiselect', options: (depts.data ?? []).map((d) => ({ value: d.id, label: d.name })), show: (v) => v.visibility === 'departments' },
              { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
            ]}
            defaults={{ name: '', category_id: categories[0]?.id ?? '', visibility: 'all', department_ids: [], description: '' }}
            toForm={(r) => ({ name: r.name, category_id: r.category_id, visibility: r.visibility, department_ids: r.department_ids, description: r.description })}
            onSaved={() => tree.refetch()}
          />
        </section>
      </div>
    </>
  );
}
