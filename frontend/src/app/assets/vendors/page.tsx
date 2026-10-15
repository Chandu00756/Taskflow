'use client';

import { AssetNav } from '@/components/desk/assets';
import { CrudPage } from '@/components/desk/crud';
import { useCan } from '@/lib/itsm/hooks';
import type { Vendor } from '@/lib/itsm/types';

export default function VendorsPage() {
  const can = useCan();
  return (
    <>
      <AssetNav />
      <CrudPage<Vendor>
        title="Vendors"
        subtitle="Suppliers of hardware, software and services."
        singular="Vendor"
        listPath="/vendors"
        queryKey={['lookup', 'vendors']}
        canEdit={can('contracts.manage')}
        searchable={(r, q) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)}
        columns={[
          { label: 'Vendor', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
          { label: 'Contact', render: (r) => r.contact_name || '—' },
          { label: 'Email', render: (r) => r.email || '—' },
          { label: 'Phone', render: (r) => r.phone || '—' },
          { label: 'Website', render: (r) => (r.website ? <a href={r.website.startsWith('http') ? r.website : `https://${r.website}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{r.website}</a> : '—') },
        ]}
        fields={[
          { name: 'name', label: 'Name', required: true },
          { name: 'contact_name', label: 'Contact person', span: 1 },
          { name: 'email', label: 'Email', type: 'email', span: 1 },
          { name: 'phone', label: 'Phone', span: 1 },
          { name: 'mobile', label: 'Mobile', span: 1 },
          { name: 'website', label: 'Website' },
          { name: 'address', label: 'Address', type: 'textarea', rows: 2 },
          { name: 'description', label: 'Notes', type: 'textarea', rows: 3 },
        ]}
        defaults={{ name: '', contact_name: '', email: '', phone: '', mobile: '', website: '', address: '', description: '' }}
      />
    </>
  );
}
