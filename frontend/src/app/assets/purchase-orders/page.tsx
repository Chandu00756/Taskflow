'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { AssetNav } from '@/components/desk/assets';
import { Card, EmptyState, LinkBtn, LoadingBlock, PageHeader, StatusBadge, Table, Td, Th } from '@/components/desk/kit';
import { v2 } from '@/lib/itsm/api';
import { useVendors } from '@/lib/itsm/hooks';
import { fmtDate, fmtMoney } from '@/lib/itsm/format';
import type { PurchaseOrder } from '@/lib/itsm/types';

export default function PurchaseOrdersPage() {
  const vendors = useVendors();
  const { data, isLoading } = useQuery({ queryKey: ['purchase-orders'], queryFn: () => v2.items<{ purchase_order: PurchaseOrder; display_id: string }>('/purchase-orders') });
  const vendorName = (id: string | null) => vendors.data?.find((v) => v.id === id)?.name ?? '—';
  return (
    <>
      <PageHeader title="Purchase orders" subtitle="Order from vendors and receive items straight into the CMDB." actions={<LinkBtn href="/assets/purchase-orders/new" variant="primary" size="sm" icon={<Plus className="h-4 w-4" />}>New purchase order</LinkBtn>} />
      <AssetNav />
      <Card padded={false}>
        {isLoading ? <LoadingBlock /> : (data ?? []).length === 0 ? (
          <EmptyState title="No purchase orders yet" action={<LinkBtn href="/assets/purchase-orders/new" variant="primary" size="sm">Create purchase order</LinkBtn>} />
        ) : (
          <Table>
            <thead><tr><Th>Purchase order</Th><Th>Vendor</Th><Th>Status</Th><Th>Expected</Th><Th className="text-right">Total</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data!.map(({ purchase_order: po, display_id }) => (
                <tr key={po.id} className="hover:bg-slate-50">
                  <Td><Link href={`/assets/purchase-orders/${po.id}`} className="block"><div className="font-medium text-slate-900 hover:text-blue-700">{po.name}</div><div className="font-mono text-xs text-slate-500">{po.po_number || display_id}</div></Link></Td>
                  <Td>{vendorName(po.vendor_id)}</Td>
                  <Td><StatusBadge status={po.status} /></Td>
                  <Td>{fmtDate(po.expected_delivery)}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(po.total, po.currency || 'USD')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
