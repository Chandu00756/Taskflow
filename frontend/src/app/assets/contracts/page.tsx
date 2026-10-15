'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { AssetNav } from '@/components/desk/assets';
import { CrudPage } from '@/components/desk/crud';
import { LoadingBlock, StatusBadge } from '@/components/desk/kit';
import { v2 } from '@/lib/itsm/api';
import { useCan, useVendors } from '@/lib/itsm/hooks';
import { fmtDate, fmtMoney, labelize, toDateInput } from '@/lib/itsm/format';
import type { Contract } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';

type Row = Contract & { display_id: string; vendor_name: string; days_to_expiry: number | null };

function ContractsContent() {
  const can = useCan();
  const vendors = useVendors();
  const sp = useSearchParams();
  const expiring = sp.get('expiring') === 'true';
  return (
    <>
      <AssetNav />
      <CrudPage<Row>
        title={expiring ? 'Contracts expiring soon' : 'Contracts'}
        subtitle="Leases, maintenance, warranties and software licenses with renewal reminders."
        singular="Contract"
        listPath="/contracts"
        queryKey={['contracts', expiring]}
        fetcher={async () =>
          (await v2.items<{ contract: Contract; display_id: string; vendor_name: string; days_to_expiry: number | null }>('/contracts', { expiring: expiring ? 'true' : undefined })).map((x) => ({
            ...x.contract,
            display_id: x.display_id,
            vendor_name: x.vendor_name,
            days_to_expiry: x.days_to_expiry,
          }))
        }
        canEdit={can('contracts.manage')}
        searchable={(r, q) => r.name.toLowerCase().includes(q) || r.vendor_name.toLowerCase().includes(q)}
        columns={[
          { label: 'Contract', render: (r) => <div><div className="font-medium text-slate-900">{r.name}</div><div className="font-mono text-xs text-slate-500">{r.display_id}</div></div> },
          { label: 'Type', render: (r) => labelize(r.contract_type) },
          { label: 'Vendor', render: (r) => r.vendor_name || '—' },
          { label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { label: 'Cost', render: (r) => fmtMoney(r.cost) },
          {
            label: 'Ends',
            render: (r) => (
              <div>
                <div>{fmtDate(r.end_date)}</div>
                {r.days_to_expiry !== null && r.status === 'active' && (
                  <div className={cn('text-xs', r.days_to_expiry < 0 ? 'text-rose-600' : r.days_to_expiry <= r.renewal_notice_days ? 'text-amber-700' : 'text-slate-500')}>
                    {r.days_to_expiry < 0 ? 'Expired' : `${r.days_to_expiry} days left`}
                    {r.auto_renew && ' · auto-renews'}
                  </div>
                )}
              </div>
            ),
          },
        ]}
        fields={[
          { name: 'name', label: 'Name', required: true },
          { name: 'contract_type', label: 'Type', type: 'select', required: true, span: 1, options: ['lease', 'maintenance', 'software_license', 'warranty'].map((v) => ({ value: v, label: labelize(v) })) },
          { name: 'status', label: 'Status', type: 'select', required: true, span: 1, options: ['draft', 'pending_approval', 'active', 'expired', 'terminated', 'rejected'].map((v) => ({ value: v, label: labelize(v) })) },
          { name: 'vendor_id', label: 'Vendor', type: 'select', span: 1, options: (vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })) },
          { name: 'cost', label: 'Cost', type: 'number', span: 1 },
          { name: 'start_date', label: 'Start date', type: 'date', span: 1 },
          { name: 'end_date', label: 'End date', type: 'date', span: 1 },
          { name: 'billing_cycle', label: 'Billing cycle', type: 'select', span: 1, options: ['monthly', 'quarterly', 'annual', 'one_time'].map((v) => ({ value: v, label: labelize(v) })) },
          { name: 'renewal_notice_days', label: 'Remind days before expiry', type: 'number', span: 1 },
          { name: 'license_type', label: 'License type', span: 1, show: (v) => v.contract_type === 'software_license' },
          { name: 'license_count', label: 'Licenses purchased', type: 'number', span: 1, show: (v) => v.contract_type === 'software_license' },
          { name: 'auto_renew', label: 'Auto-renew', type: 'toggle', description: 'Extend automatically for the same term when it ends' },
          { name: 'approver_id', label: 'Approver / owner', type: 'agent' },
          { name: 'description', label: 'Description', type: 'textarea', rows: 3 },
        ]}
        defaults={{ name: '', contract_type: 'maintenance', status: 'draft', vendor_id: '', cost: 0, start_date: '', end_date: '', billing_cycle: 'annual', renewal_notice_days: 30, auto_renew: false, approver_id: '', description: '', license_type: '', license_count: 0 }}
        toForm={(r) => ({ ...r, start_date: toDateInput(r.start_date), end_date: toDateInput(r.end_date), vendor_id: r.vendor_id ?? '', approver_id: r.approver_id ?? '' })}
        toPayload={(v) => {
          const { display_id, vendor_name, days_to_expiry, id, number, ...rest } = v as Record<string, unknown>;
          void display_id; void vendor_name; void days_to_expiry; void id; void number;
          return { ...rest, cost: Number(rest.cost ?? 0), license_count: Number(rest.license_count ?? 0), renewal_notice_days: Number(rest.renewal_notice_days ?? 30) };
        }}
        drawerWidth="max-w-2xl"
      />
    </>
  );
}

export default function ContractsPage() {
  return (
    <React.Suspense fallback={<LoadingBlock />}>
      <ContractsContent />
    </React.Suspense>
  );
}
