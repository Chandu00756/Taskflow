'use client';

import Link from 'next/link';
import { AssetNav } from '@/components/desk/assets';
import { CrudPage } from '@/components/desk/crud';
import { Badge } from '@/components/desk/kit';
import { v2 } from '@/lib/itsm/api';
import { useCan } from '@/lib/itsm/hooks';
import { labelize } from '@/lib/itsm/format';
import type { Software } from '@/lib/itsm/types';

type Row = Software & { installations: number; licenses: number; compliance: string };

export default function SoftwarePage() {
  const can = useCan();
  return (
    <>
      <AssetNav />
      <CrudPage<Row>
        title="Software"
        subtitle="Track installations against purchased licenses to stay compliant."
        singular="Software"
        listPath="/software"
        queryKey={['software']}
        fetcher={async () => (await v2.items<{ software: Software; installations: number; licenses: number; compliance: string }>('/software')).map((x) => ({ ...x.software, installations: x.installations, licenses: x.licenses, compliance: x.compliance }))}
        canEdit={can('contracts.manage')}
        searchable={(r, q) => r.name.toLowerCase().includes(q) || r.publisher.toLowerCase().includes(q)}
        columns={[
          { label: 'Software', render: (r) => <Link href={`/assets/software/${r.id}`} className="font-medium text-slate-900 hover:text-blue-700">{r.name}</Link> },
          { label: 'Publisher', render: (r) => r.publisher || '—' },
          { label: 'Category', render: (r) => r.category || '—' },
          { label: 'Status', render: (r) => labelize(r.status) },
          { label: 'Installs / licenses', render: (r) => `${r.installations} / ${r.licenses || '—'}` },
          { label: 'Compliance', render: (r) => (r.compliance === 'compliant' ? <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">Compliant</Badge> : <Badge className="bg-rose-50 text-rose-700 ring-rose-600/20">Over-deployed</Badge>) },
        ]}
        fields={[
          { name: 'name', label: 'Name', required: true },
          { name: 'publisher', label: 'Publisher', span: 1 },
          { name: 'category', label: 'Category', span: 1 },
          { name: 'status', label: 'Status', type: 'select', required: true, span: 1, options: ['managed', 'restricted', 'ignored', 'disabled'].map((v) => ({ value: v, label: labelize(v) })) },
          { name: 'license_type', label: 'License model', span: 1, placeholder: 'Per user, per device, site…' },
          { name: 'managed_by_id', label: 'Managed by', type: 'agent' },
          { name: 'description', label: 'Description', type: 'textarea', rows: 3 },
        ]}
        defaults={{ name: '', publisher: '', category: '', status: 'managed', license_type: '', managed_by_id: '', description: '' }}
        toForm={(r) => ({ name: r.name, publisher: r.publisher, category: r.category, status: r.status, license_type: r.license_type, managed_by_id: r.managed_by_id ?? '', description: r.description })}
        toPayload={(v) => ({ ...v, managed_by_id: v.managed_by_id || null })}
      />
    </>
  );
}
