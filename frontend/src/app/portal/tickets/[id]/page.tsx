'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { Btn, Card, DefList, ErrorBlock, LoadingBlock, StatusBadge, TextArea, useConfirm } from '@/components/desk/kit';
import { Markdown } from '@/components/desk/markdown';
import { AttachmentList } from '@/components/desk/forms';
import { Composer, ConversationThread } from '@/components/desk/record-panels';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useMe } from '@/lib/itsm/hooks';
import { fmtDateTime, labelize, priorityMeta } from '@/lib/itsm/format';
import type { Attachment, Ticket } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';

interface Detail {
  ticket: Ticket;
  requested_items?: { id: string; name: string; quantity: number; stage: string }[];
  satisfaction?: { rating: number; feedback: string };
}

function PortalTicketContent() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: me } = useMe();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['ticket', id], queryFn: () => v2.get<Detail>(`/tickets/${id}`) });
  const attachments = useQuery({ queryKey: ['ticket-attachments', id], queryFn: () => v2.items<Attachment>(`/tickets/${id}/attachments`) });
  const setStatus = useMutation({
    mutationFn: (status: string) => v2.put(`/tickets/${id}`, { status }),
    onSuccess: (_d, status) => {
      toast.success(status === 'closed' ? 'Ticket closed' : 'Ticket reopened');
      qc.invalidateQueries({ queryKey: ['ticket', id] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock message={parseApiError(error).message} onRetry={() => refetch()} />;
  const t = data.ticket;
  const mine = t.requester_id === me?.user.id;
  const active = t.status !== 'resolved' && t.status !== 'closed';
  const customLabel = me?.settings.custom_statuses.find((c) => c.key === t.status)?.customer_label;
  const showRating = mine && !active && me?.settings.csat_enabled;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-5">
        <div>
          <Link href="/portal/tickets" className="text-sm text-blue-600 hover:underline">
            ← My tickets
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">{t.subject}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="font-mono">{t.display_id}</span>
            <StatusBadge status={t.status} label={customLabel} />
            <span>Raised {fmtDateTime(t.created_at)}</span>
          </div>
        </div>
        {showRating && <RatingCard ticketId={id} existing={data.satisfaction} highlight={sp.get('rate') === '1'} />}
        <Card>
          <Markdown text={t.description} />
          <AttachmentList items={attachments.data ?? []} />
        </Card>
        {data.requested_items && data.requested_items.length > 0 && (
          <Card title="Requested items">
            <ul className="space-y-2">
              {data.requested_items.map((it) => (
                <li key={it.id} className="flex items-center justify-between text-sm">
                  <span>
                    {it.name} × {it.quantity}
                  </span>
                  <StatusBadge status={it.stage} label={it.stage === 'requested' ? 'Awaiting approval' : labelize(it.stage)} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Conversation</h2>
          <ConversationThread module="tickets" id={id} portal />
        </div>
        {mine && t.status !== 'closed' && <Composer module="tickets" id={id} modes={['reply']} onSent={() => qc.invalidateQueries({ queryKey: ['ticket', id] })} />}
        {t.status === 'closed' && <p className="text-sm text-slate-500">This ticket is closed. Reopen it to continue the conversation.</p>}
      </div>
      <aside className="space-y-5">
        <Card title="Details">
          <DefList
            items={[
              { label: 'Status', value: <StatusBadge status={t.status} label={customLabel} /> },
              { label: 'Priority', value: priorityMeta(t.priority).label },
              { label: 'Type', value: t.type === 'incident' ? 'Incident' : 'Service request' },
              { label: 'Assigned to', value: t.responder?.name ?? 'Not yet assigned' },
              { label: 'Group', value: t.group?.name ?? '—' },
              { label: 'Category', value: [t.category, t.sub_category, t.item_category].filter(Boolean).join(' › ') || '—' },
              { label: 'Expected by', value: t.due_by ? fmtDateTime(t.due_by) : '—' },
            ]}
          />
        </Card>
        {mine && (
          <div className="space-y-2">
            {active && me?.settings.requester_can_close && (
              <Btn
                className="w-full"
                onClick={async () => (await confirm({ title: 'Close this ticket?', message: 'Close it if your issue is resolved. You can reopen it later.', confirmLabel: 'Close ticket' })) && setStatus.mutate('closed')}
                loading={setStatus.isPending}
              >
                My issue is resolved — close ticket
              </Btn>
            )}
            {!active && me?.settings.requester_can_reopen && (
              <Btn className="w-full" onClick={() => setStatus.mutate('open')} loading={setStatus.isPending}>
                Reopen ticket
              </Btn>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function RatingCard({ ticketId, existing, highlight }: { ticketId: string; existing?: { rating: number; feedback: string }; highlight: boolean }) {
  const qc = useQueryClient();
  const [rating, setRating] = React.useState(existing?.rating ?? 0);
  const [hover, setHover] = React.useState(0);
  const [feedback, setFeedback] = React.useState(existing?.feedback ?? '');
  const submit = useMutation({
    mutationFn: () => v2.post(`/tickets/${ticketId}/rating`, { rating, feedback }),
    onSuccess: () => {
      toast.success('Thank you for your feedback!');
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const labels = ['', 'Very poor', 'Poor', 'Okay', 'Good', 'Excellent'];
  return (
    <Card className={cn(highlight && !existing && 'ring-2 ring-blue-500')}>
      <div className="text-sm font-semibold text-slate-900">{existing ? 'Your rating' : 'How would you rate the support you received?'}</div>
      <div className="mt-2 flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-label={`${n} star${n > 1 ? 's' : ''}`} onMouseEnter={() => setHover(n)} onClick={() => setRating(n)}>
            <Star className={cn('h-7 w-7 transition', n <= (hover || rating) ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
          </button>
        ))}
        <span className="ml-2 text-sm text-slate-500">{labels[hover || rating]}</span>
      </div>
      {rating > 0 && (
        <div className="mt-3 space-y-2">
          <TextArea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} placeholder="Anything you'd like to add? (optional)" />
          <Btn variant="primary" size="sm" loading={submit.isPending} onClick={() => submit.mutate()}>
            {existing ? 'Update rating' : 'Submit rating'}
          </Btn>
        </div>
      )}
    </Card>
  );
}

export default function PortalTicketPage() {
  return (
    <React.Suspense fallback={<LoadingBlock />}>
      <PortalTicketContent />
    </React.Suspense>
  );
}
