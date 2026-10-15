'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { SchemaForm } from '@/components/desk/crud';
import { Btn, Card, EmptyState, LoadingBlock, PageHeader, Stat } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useCan } from '@/lib/itsm/hooks';
import { timeAgo } from '@/lib/itsm/format';
import type { UserBrief } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';

type SurveyData = {
  survey: Record<string, unknown>;
  stats: { responses: number; average: number; positive: number };
  recent: { id: string; ticket_id: string; rating: number; feedback: string; requester: UserBrief | null; agent: UserBrief | null; created_at: string }[];
};

export default function SurveyPage() {
  const qc = useQueryClient();
  const can = useCan();
  const { data, isLoading } = useQuery({ queryKey: ['survey'], queryFn: () => v2.get<SurveyData>('/survey') });
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  React.useEffect(() => { if (data) setValues(data.survey); }, [data]);
  const save = useMutation({
    mutationFn: () => v2.put('/survey', { ...values, scale_type: Number(values.scale_type) }),
    onSuccess: () => { toast.success('Survey saved'); qc.invalidateQueries({ queryKey: ['survey'] }); },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  if (isLoading || !data) return <LoadingBlock />;
  return (
    <>
      <PageHeader title="Customer satisfaction" subtitle="Requesters rate their experience when a ticket is resolved." breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Survey' }]} />
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Responses" value={data.stats.responses} />
        <Stat label="Average rating" value={data.stats.responses ? data.stats.average.toFixed(2) : '—'} tone="amber" />
        <Stat label="Positive (4–5)" value={data.stats.responses ? `${Math.round((data.stats.positive * 100) / data.stats.responses)}%` : '—'} tone="emerald" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Recent feedback" padded={false}>
          {data.recent.length === 0 ? <EmptyState title="No ratings yet" /> : (
            <ul className="divide-y divide-slate-100">
              {data.recent.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex">{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cn('h-4 w-4', n <= r.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200')} />)}</span>
                    <span className="text-xs text-slate-400">{timeAgo(r.created_at)}</span>
                  </div>
                  {r.feedback && <p className="mt-1 text-sm text-slate-700">“{r.feedback}”</p>}
                  <div className="mt-1 text-xs text-slate-500">{r.requester?.name} → {r.agent?.name ?? 'unassigned'} · <Link href={`/tickets/${r.ticket_id}`} className="text-blue-600 hover:underline">View ticket</Link></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Survey settings">
          <SchemaForm
            values={values}
            onChange={setValues}
            fields={[
              { name: 'active', label: 'Collect satisfaction ratings', type: 'toggle' },
              { name: 'question', label: 'Question', required: true },
              { name: 'scale_type', label: 'Scale', type: 'select', span: 1, options: [{ value: '5', label: '5 stars' }, { value: '3', label: '3 points' }] },
              { name: 'send_on', label: 'Ask when ticket is', type: 'select', span: 1, options: [{ value: 'resolved', label: 'Resolved' }, { value: 'closed', label: 'Closed' }] },
              { name: 'thank_you_message', label: 'Thank-you message' },
            ]}
          />
          {can('settings.manage') && <Btn className="mt-4" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Btn>}
        </Card>
      </div>
    </>
  );
}
