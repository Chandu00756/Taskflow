'use client';

import * as React from 'react';
import { Paperclip, X, Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { uploadAttachment, parseApiError, downloadFile } from '@/lib/itsm/api';
import type { Attachment, FormField } from '@/lib/itsm/types';
import { fmtBytes } from '@/lib/itsm/format';
import { Checkbox, Field, SelectBox, TextArea, TextInput, MultiSelect } from './kit';
import { AttachmentThumb, isPreviewable, Lightbox } from './lightbox';

type NestedChoice = { value: string; children?: NestedChoice[] };

/** Three-level category picker driven by the "category" form field. */
export function CategoryPicker({ fields, value, onChange, labels = ['Category', 'Sub-category', 'Item'] }: {
  fields?: FormField[];
  value: { category: string; sub_category: string; item_category: string };
  onChange: (v: { category: string; sub_category: string; item_category: string }) => void;
  labels?: [string, string, string] | string[];
}) {
  const root = (fields?.find((f) => f.name === 'category')?.choices ?? []) as NestedChoice[];
  const level1 = root.find((c) => c.value === value.category);
  const level2 = level1?.children?.find((c) => c.value === value.sub_category);
  const opts = (list?: NestedChoice[]) => (list ?? []).map((c) => ({ value: c.value, label: c.value }));
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label={labels[0]}>
        <SelectBox value={value.category} onChange={(v) => onChange({ category: v, sub_category: '', item_category: '' })} placeholder="—" options={opts(root)} />
      </Field>
      <Field label={labels[1]}>
        <SelectBox value={value.sub_category} onChange={(v) => onChange({ ...value, sub_category: v, item_category: '' })} placeholder="—" options={opts(level1?.children)} disabled={!level1?.children?.length} />
      </Field>
      <Field label={labels[2]}>
        <SelectBox value={value.item_category} onChange={(v) => onChange({ ...value, item_category: v })} placeholder="—" options={opts(level2?.children)} disabled={!level2?.children?.length} />
      </Field>
    </div>
  );
}

/** Renders editable custom fields (all non-default active fields). */
export function CustomFields({ fields, values, onChange, requester = false, errors = {} }: {
  fields: FormField[];
  values: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  requester?: boolean;
  errors?: Record<string, string>;
}) {
  const visible = fields.filter((f) => !f.is_default && f.active && (!requester || (f.displayed_to_requester && f.editable_by_requester)));
  if (visible.length === 0) return null;
  const set = (name: string, v: unknown) => onChange({ ...values, [name]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {visible.map((f) => {
        const label = requester && f.label_for_requester ? f.label_for_requester : f.label;
        const required = requester ? f.required_for_requesters : f.required_for_agents;
        const v = values[f.name];
        const choices = (f.choices ?? []).map((c) => ({ value: c.value, label: c.value }));
        const err = errors[f.name];
        switch (f.field_type) {
          case 'paragraph':
            return (
              <Field key={f.id} label={label} required={required} error={err} className="sm:col-span-2">
                <TextArea value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)} rows={3} />
              </Field>
            );
          case 'dropdown':
            return (
              <Field key={f.id} label={label} required={required} error={err}>
                <SelectBox value={String(v ?? '')} onChange={(x) => set(f.name, x)} placeholder="—" options={choices} />
              </Field>
            );
          case 'multi_select':
            return (
              <Field key={f.id} label={label} required={required} error={err}>
                <MultiSelect value={Array.isArray(v) ? (v as string[]) : []} onChange={(x) => set(f.name, x)} options={choices} />
              </Field>
            );
          case 'checkbox':
            return (
              <div key={f.id} className="flex items-end pb-2">
                <Checkbox checked={Boolean(v)} onChange={(x) => set(f.name, x)} label={label} />
              </div>
            );
          case 'number':
          case 'decimal':
            return (
              <Field key={f.id} label={label} required={required} error={err}>
                <TextInput type="number" step={f.field_type === 'decimal' ? '0.01' : '1'} value={v === undefined || v === null ? '' : String(v)} onChange={(e) => set(f.name, e.target.value === '' ? null : Number(e.target.value))} />
              </Field>
            );
          case 'date':
            return (
              <Field key={f.id} label={label} required={required} error={err}>
                <TextInput type="date" value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)} />
              </Field>
            );
          default:
            return (
              <Field key={f.id} label={label} required={required} error={err}>
                <TextInput value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)} />
              </Field>
            );
        }
      })}
    </div>
  );
}

interface Uploaded {
  id: string;
  name: string;
  size: number;
}

/** Uploads files immediately and reports the resulting attachment ids. */
export function AttachmentInput({ value, onChange, compact = false }: { value: Uploaded[]; onChange: (v: Uploaded[]) => void; compact?: boolean }) {
  const [busy, setBusy] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files);
    setBusy((b) => b + list.length);
    const done: Uploaded[] = [];
    for (const file of list) {
      if (file.size > 15 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 15 MB`);
        setBusy((b) => b - 1);
        continue;
      }
      try {
        const res = await uploadAttachment(file);
        done.push({ id: res.id, name: res.name, size: res.size });
      } catch (e) {
        toast.error(`${file.name}: ${parseApiError(e).message}`);
      } finally {
        setBusy((b) => b - 1);
      }
    }
    onChange([...value, ...done]);
    if (inputRef.current) inputRef.current.value = '';
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          {busy > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          {compact ? '' : 'Attach files'}
        </button>
        {value.map((f) => (
          <span key={f.id} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
            <FileText className="h-3.5 w-3.5 text-slate-400" />
            {f.name} <span className="text-slate-400">{fmtBytes(f.size)}</span>
            <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onChange(value.filter((x) => x.id !== f.id))} className="text-slate-400 hover:text-slate-700">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
    </div>
  );
}

export function AttachmentList({ items }: { items: Attachment[] }) {
  const [open, setOpen] = React.useState<number | null>(null);
  if (!items?.length) return null;
  // Images and PDFs show as thumbnails that open in the viewer; other files download.
  const previews = items.filter(isPreviewable);
  const files = items.filter((a) => !isPreviewable(a));
  return (
    <div className="mt-2 space-y-2">
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {previews.map((a, i) => (
            <AttachmentThumb key={a.id} a={a} onOpen={() => setOpen(i)} />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => downloadFile(`/attachments/${a.id}`, a.name).catch((e) => toast.error(parseApiError(e).message))}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-blue-300 hover:text-blue-700"
            >
              <Paperclip className="h-3.5 w-3.5" />
              {a.name}
              <span className="text-slate-400">{fmtBytes(a.size)}</span>
            </button>
          ))}
        </div>
      )}
      {open !== null && <Lightbox items={previews} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
