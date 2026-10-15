'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Btn, Card, Checkbox, ErrorBlock, Field, LoadingBlock, MultiSelect, SelectBox, TextArea, TextInput } from '@/components/desk/kit';
import { AttachmentInput } from '@/components/desk/forms';
import { CatalogIcon } from '@/components/desk/catalog-icon';
import { Markdown } from '@/components/desk/markdown';
import { PersonPicker } from '@/components/desk/pickers';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useMe } from '@/lib/itsm/hooks';
import { fmtMoney } from '@/lib/itsm/format';
import type { CatalogField, CatalogItem, Ticket } from '@/lib/itsm/types';
import { celebrate } from '@/lib/theme';

export default function CatalogItemPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: me } = useMe();
  const { data: item, isLoading, error } = useQuery({ queryKey: ['catalog-item', id], queryFn: () => v2.get<CatalogItem>(`/catalog/items/${id}`) });
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [quantity, setQuantity] = React.useState(1);
  const [notes, setNotes] = React.useState('');
  const [requestedFor, setRequestedFor] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<{ id: string; name: string; size: number }[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const place = useMutation({
    mutationFn: () => v2.post<Ticket>(`/catalog/items/${id}/request`, { fields: values, quantity, notes, requested_for_id: requestedFor ?? undefined, attachment_ids: files.map((f) => f.id) }),
    onSuccess: (t) => {
      toast.success(`Request ${t.display_id} submitted`);
      celebrate();
      router.push(me?.is_agent && requestedFor ? `/tickets/${t.id}` : `/portal/tickets/${t.id}`);
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^fields\./, ''), v])));
      toast.error(err.message);
    },
  });
  if (isLoading) return <LoadingBlock />;
  if (error || !item) return <ErrorBlock message={parseApiError(error).message} />;

  const validate = () => {
    const errs: Record<string, string> = {};
    item.fields.forEach((f) => {
      const v = values[f.name];
      if (f.required && (v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0))) errs[f.name] = `${f.label} is required`;
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };
  const set = (name: string, v: unknown) => setValues((s) => ({ ...s, [name]: v }));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-5">
        <Link href="/portal/catalog" className="text-sm text-blue-600 hover:underline">
          ← Service catalog
        </Link>
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
            <CatalogIcon name={item.icon} className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{item.name}</h1>
            <p className="mt-1 text-sm text-slate-500">{item.short_description}</p>
          </div>
        </div>
        {item.description && (
          <Card>
            <Markdown text={item.description} />
          </Card>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (validate()) place.mutate();
          }}
        >
          <Card title="Request details">
            <div className="space-y-4">
              {me?.is_agent && (
                <Field label="Requested for" hint="Leave empty to request for yourself">
                  <PersonPicker value={requestedFor} onChange={(v) => setRequestedFor(v)} />
                </Field>
              )}
              {item.quantity_enabled && (
                <Field label="Quantity">
                  <TextInput type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="w-28" />
                </Field>
              )}
              {item.fields.map((f) => (
                <CatalogFieldInput key={f.name} field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} error={errors[f.name]} />
              ))}
              <Field label="Additional notes">
                <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </Field>
              {item.allow_attachments && <AttachmentInput value={files} onChange={setFiles} />}
              <div className="flex justify-end">
                <Btn type="submit" variant="primary" loading={place.isPending}>
                  Place request
                </Btn>
              </div>
            </div>
          </Card>
        </form>
      </div>
      <aside className="space-y-4">
        <Card>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Cost</span>
              <span className="font-semibold text-slate-900">{item.cost > 0 ? fmtMoney(item.cost * quantity) : 'No charge'}</span>
            </div>
            {item.delivery_hours > 0 && (
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-slate-500"><Clock className="h-4 w-4" />Delivery</span>
                <span className="text-slate-900">{item.delivery_hours >= 24 ? `${Math.round(item.delivery_hours / 24)} business day(s)` : `${item.delivery_hours} hours`}</span>
              </div>
            )}
            {item.approval_required ? (
              <div className="flex gap-2 rounded-md bg-amber-50 p-2 text-amber-900">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Needs approval from {item.approver_type === 'reporting_manager' ? 'your manager' : item.approver_type === 'department_head' ? 'your department head' : 'an approver'} before fulfilment.
              </div>
            ) : (
              <div className="flex gap-2 rounded-md bg-emerald-50 p-2 text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                No approval needed.
              </div>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}

function CatalogFieldInput({ field, value, onChange, error }: { field: CatalogField; value: unknown; onChange: (v: unknown) => void; error?: string }) {
  const opts = (field.choices ?? []).map((c) => ({ value: c, label: c }));
  switch (field.type) {
    case 'paragraph':
      return (
        <Field label={field.label} required={field.required} error={error}>
          <TextArea value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={field.placeholder} />
        </Field>
      );
    case 'dropdown':
      return (
        <Field label={field.label} required={field.required} error={error}>
          <SelectBox value={String(value ?? '')} onChange={onChange} placeholder="Select…" options={opts} />
        </Field>
      );
    case 'multi_select':
      return (
        <Field label={field.label} required={field.required} error={error}>
          <MultiSelect value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} options={opts} />
        </Field>
      );
    case 'checkbox':
      return (
        <div>
          <Checkbox checked={Boolean(value)} onChange={onChange} label={field.label + (field.required ? ' *' : '')} />
          {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        </div>
      );
    case 'number':
      return (
        <Field label={field.label} required={field.required} error={error}>
          <TextInput type="number" value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case 'date':
      return (
        <Field label={field.label} required={field.required} error={error}>
          <TextInput type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    default:
      return (
        <Field label={field.label} required={field.required} error={error}>
          <TextInput value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
        </Field>
      );
  }
}
