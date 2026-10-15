'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, Btn, Card, EmptyState, LoadingBlock, Modal, StatusBadge, Tabs, TextArea } from './kit';
import { v2, parseApiError } from '@/lib/itsm/api';
import { fmtDateTime, timeAgo } from '@/lib/itsm/format';
import type { Approval } from '@/lib/itsm/types';

const ROUTES: Record<string, { agent: string; portal: string }> = {
  ticket: { agent: '/tickets/', portal: '/portal/tickets/' },
  change: { agent: '/changes/', portal: '/changes/' },
};

/** Approval inbox shared by the agent workspace and the portal. */
export function ApprovalInbox({ portal = false }: { portal?: boolean }) {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState('requested');
  const [responding, setResponding] = React.useState<{ approval: Approval; decision: 'approved' | 'rejected' } | null>(null);
  const [remark, setRemark] = React.useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['approvals', 'inbox', tab],
    queryFn: () => v2.items<Approval>('/approvals', { status: tab === 'all' ? undefined : tab }),
  });
  const respond = useMutation({
    mutationFn: () => v2.put(`/approvals/${responding!.approval.id}`, { status: responding!.decision, remark }),
    onSuccess: () => {
      toast.success(responding?.decision === 'approved' ? 'Approved' : 'Rejected');
      setResponding(null);
      setRemark('');
      qc.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const items = data ?? [];
  return (
    <Card padded={false}>
      <div className="px-4 pt-2">
        <Tabs value={tab} onChange={setTab} className="border-0" tabs={[{ value: 'requested', label: 'Waiting on me' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }]} />
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <EmptyState title={tab === 'requested' ? 'No approvals waiting on you' : 'Nothing here'} description="Requests that need your sign-off will appear here." />
      ) : (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {items.map((a) => {
            const route = ROUTES[a.entity_type];
            const href = route ? (portal ? route.portal : route.agent) + a.entity_id : '#';
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-4 px-4 py-4">
                <Avatar name={a.requested_by?.name} src={a.requested_by?.avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-900">
                    <span className="font-medium">{a.requested_by?.name ?? 'Someone'}</span> requested approval for{' '}
                    {portal && a.entity_type === 'change' ? (
                      <span className="font-medium">{a.record?.display_id} {a.record?.title}</span>
                    ) : (
                      <Link href={href} className="font-medium text-blue-700 hover:underline">
                        {a.record?.display_id} {a.record?.title}
                      </Link>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500" title={fmtDateTime(a.created_at)}>
                    {timeAgo(a.created_at)}
                    {a.remark && ` · “${a.remark}”`}
                    {a.responded_at && ` · responded ${timeAgo(a.responded_at)}`}
                  </div>
                </div>
                {a.status === 'requested' ? (
                  <div className="flex gap-2">
                    <Btn size="sm" variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setResponding({ approval: a, decision: 'approved' })}>
                      Approve
                    </Btn>
                    <Btn size="sm" variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => setResponding({ approval: a, decision: 'rejected' })}>
                      Reject
                    </Btn>
                  </div>
                ) : (
                  <StatusBadge status={a.status} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Modal
        open={!!responding}
        onClose={() => setResponding(null)}
        title={responding?.decision === 'approved' ? 'Approve request' : 'Reject request'}
        size="sm"
        footer={
          <>
            <Btn onClick={() => setResponding(null)}>Cancel</Btn>
            <Btn variant={responding?.decision === 'approved' ? 'success' : 'danger'} loading={respond.isPending} onClick={() => respond.mutate()}>
              {responding?.decision === 'approved' ? 'Approve' : 'Reject'}
            </Btn>
          </>
        }
      >
        <p className="mb-2 text-sm text-slate-600">{responding?.approval.record?.title}</p>
        <TextArea value={remark} onChange={(e) => setRemark(e.target.value)} rows={3} placeholder={responding?.decision === 'rejected' ? 'Let the requester know why (recommended)' : 'Add a comment (optional)'} />
      </Modal>
    </Card>
  );
}
