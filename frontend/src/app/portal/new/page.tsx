'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Btn, Card, Field, SelectBox, TextArea, TextInput } from '@/components/desk/kit';
import { AttachmentInput, CategoryPicker, CustomFields } from '@/components/desk/forms';
import { useDebounced } from '@/components/desk/pickers';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useTicketFields } from '@/lib/itsm/hooks';
import type { Article, Ticket } from '@/lib/itsm/types';
import { celebrate } from '@/lib/theme';

export default function ReportIssuePage() {
  const router = useRouter();
  const fields = useTicketFields();
  const [subject, setSubject] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [priority, setPriority] = React.useState('2');
  const [category, setCategory] = React.useState({ category: '', sub_category: '', item_category: '' });
  const [custom, setCustom] = React.useState<Record<string, unknown>>({});
  const [files, setFiles] = React.useState<{ id: string; name: string; size: number }[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const term = useDebounced(subject, 400);
  const suggestions = useQuery({ queryKey: ['kb-suggest', term], queryFn: () => v2.items<Article>('/solutions/suggest', { q: term }), enabled: term.length >= 4 });

  const create = useMutation({
    mutationFn: () =>
      v2.post<Ticket>('/tickets', { subject, description, priority: Number(priority), custom_fields: custom, attachment_ids: files.map((f) => f.id), ...category }),
    onSuccess: (t) => {
      toast.success(`Ticket ${t.display_id} submitted`);
      celebrate();
      router.push(`/portal/tickets/${t.id}`);
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      toast.error(err.message);
    },
  });

  const requiredMissing = () => {
    const errs: Record<string, string> = {};
    if (!subject.trim()) errs.subject = 'Please add a short summary';
    if (!description.trim()) errs.description = 'Please describe the problem';
    (fields.data ?? [])
      .filter((f) => !f.is_default && f.active && f.displayed_to_requester && f.required_for_requesters)
      .forEach((f) => {
        const v = custom[f.name];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) errs[f.name] = `${f.label_for_requester || f.label} is required`;
      });
    return errs;
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Report an issue</h1>
      <p className="mt-1 text-sm text-slate-500">Tell us what&apos;s wrong. The more detail you share, the faster we can help.</p>
      <form
        className="mt-6 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          const errs = requiredMissing();
          setErrors(errs);
          if (!Object.keys(errs).length) create.mutate();
        }}
      >
        <Card>
          <div className="space-y-4">
            <Field label="Subject" required error={errors.subject}>
              <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={255} placeholder="e.g. Cannot connect to VPN from home" invalid={!!errors.subject} />
            </Field>
            {(suggestions.data ?? []).length > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-900">
                  <BookOpen className="h-4 w-4" /> These articles might solve it right away
                </div>
                <ul className="space-y-1">
                  {suggestions.data!.map((a) => (
                    <li key={a.id}>
                      <Link href={`/portal/solutions/${a.id}`} target="_blank" className="text-sm text-blue-700 hover:underline">
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Field label="Description" required error={errors.description}>
              <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={7} placeholder="What happened? What did you expect? Any error messages?" invalid={!!errors.description} />
            </Field>
            <CategoryPicker fields={fields.data} value={category} onChange={setCategory} labels={['What is this about?', 'Area', 'Item']} />
            <Field label="How urgent is it?">
              <SelectBox
                value={priority}
                onChange={setPriority}
                options={[
                  { value: '1', label: 'Low – it can wait' },
                  { value: '2', label: 'Medium – it affects my work' },
                  { value: '3', label: 'High – I cannot work' },
                ]}
              />
            </Field>
            <CustomFields fields={fields.data ?? []} values={custom} onChange={setCustom} requester errors={errors} />
            <AttachmentInput value={files} onChange={setFiles} />
          </div>
        </Card>
        <div className="flex justify-end gap-2">
          <Btn onClick={() => router.back()}>Cancel</Btn>
          <Btn type="submit" variant="primary" loading={create.isPending}>
            Submit
          </Btn>
        </div>
      </form>
    </div>
  );
}
