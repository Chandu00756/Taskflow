'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { RecordDetail } from '@/components/desk/itil';
import { changePayload, changeToForm, useChangeFields } from '@/components/desk/itil-config';
import { Avatar, Btn, Card, Field, Modal, MultiSelect, PriorityBadge, SelectBox, StatusBadge, Badge } from '@/components/desk/kit';
import { useAgentOptions, useGroupOptions } from '@/components/desk/pickers';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useCan } from '@/lib/itsm/hooks';
import { fmtDateTime, labelize, timeAgo } from '@/lib/itsm/format';
import type { Approval, Change } from '@/lib/itsm/types';

type ChangeData = { change: Change; approvals: Approval[]; conflicts: { id: string; display_id: string; subject: string; planned_start: string; shared_assets: number }[] };

export default function ChangePage() {
  const { id } = useParams<{ id: string }>();
  const { properties, sections } = useChangeFields();
  const can = useCan();
  const [approvalOpen, setApprovalOpen] = React.useState(false);
  return (
    <RecordDetail<Change>
      id={id}
      cfg={{
        module: 'changes',
        singular: 'Change',
        managePriv: 'changes.manage',
        fetchPath: (x) => `/changes/${x}`,
        extract: (d) => (d as ChangeData).change,
        title: (c) => c.subject,
        displayId: (c) => c.display_id,
        badges: (c) => (
          <>
            <StatusBadge status={c.status} />
            <Badge className="bg-slate-100 text-slate-700 ring-slate-500/20">{labelize(c.change_type)}</Badge>
            <PriorityBadge priority={c.priority} />
            <StatusBadge status={c.approval_status} label={`Approval: ${labelize(c.approval_status)}`} />
            {c.release && <Link href={`/releases/${c.release.id}`} className="text-xs text-blue-600 hover:underline">{c.release.name}</Link>}
          </>
        ),
        headerActions: (c, _d, refresh) =>
          can('changes.manage') && c.status !== 'closed' ? (
            <>
              <Btn size="sm" variant="primary" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => setApprovalOpen(true)}>
                Request approval
              </Btn>
              <ApprovalRequest open={approvalOpen} onClose={() => setApprovalOpen(false)} changeId={c.id} onDone={refresh} />
            </>
          ) : null,
        topContent: (_c, d) => {
          const data = d as ChangeData;
          return (
            <div className="mb-5 space-y-3">
              {data.conflicts.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                    <AlertTriangle className="h-4 w-4" /> Schedule conflicts
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-amber-900">
                    {data.conflicts.map((x) => (
                      <li key={x.id}>
                        <Link href={`/changes/${x.id}`} className="font-medium underline">{x.display_id}</Link> {x.subject} — {fmtDateTime(x.planned_start)}
                        {x.shared_assets > 0 && <span className="ml-1 font-semibold">({x.shared_assets} shared asset{x.shared_assets > 1 ? 's' : ''})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.approvals.length > 0 && (
                <Card title="Approvals">
                  <ul className="divide-y divide-slate-100">
                    {data.approvals.map((a) => (
                      <li key={a.id} className="flex items-center gap-3 py-2">
                        <Avatar name={a.approver?.name} src={a.approver?.avatar_url} size="sm" />
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="text-slate-900">{a.approver?.name}</div>
                          <div className="text-xs text-slate-500">
                            Requested {timeAgo(a.created_at)}
                            {a.remark && ` · “${a.remark}”`}
                          </div>
                        </div>
                        <StatusBadge status={a.status} />
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          );
        },
        propertyFields: properties,
        sections,
        toForm: (c) => changeToForm(c as unknown as Record<string, unknown>),
        toPayload: changePayload,
        associationTypes: ['ticket', 'problem', 'release', 'asset'],
        isDeleted: (c) => c.is_deleted,
      }}
    />
  );
}

function ApprovalRequest({ open, onClose, changeId, onDone }: { open: boolean; onClose: () => void; changeId: string; onDone: () => void }) {
  const agents = useAgentOptions();
  const groups = useGroupOptions();
  const [ids, setIds] = React.useState<string[]>([]);
  const [group, setGroup] = React.useState('');
  const send = useMutation({
    mutationFn: () => v2.post(`/changes/${changeId}/approvals`, { approver_ids: ids, group_id: group || undefined }),
    onSuccess: () => {
      toast.success('Approval requested');
      setIds([]);
      setGroup('');
      onClose();
      onDone();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request approval"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={!ids.length && !group} loading={send.isPending} onClick={() => send.mutate()}>
            Send request
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Approvers are notified and can approve or reject from their approvals inbox. Any rejection sends the change back to planning.</p>
        <Field label="Approvers">
          <MultiSelect value={ids} onChange={setIds} options={agents} placeholder="Select people…" />
        </Field>
        <Field label="Or an entire group (e.g. Change Advisory Board)">
          <SelectBox value={group} onChange={setGroup} placeholder="—" options={groups} />
        </Field>
      </div>
    </Modal>
  );
}
