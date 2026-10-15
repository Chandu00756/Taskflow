'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { v2, parseApiError } from '@/lib/itsm/api';
import { Btn, Card, Checkbox, Drawer, EmptyState, Field, LoadingBlock, MultiSelect, PageHeader, SearchInput, SelectBox, Table, Td, TagInput, TextArea, TextInput, Th, Toggle, useConfirm, Option } from './kit';
import { PersonPicker } from './pickers';

export type FieldSpec = {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'textarea' | 'number' | 'select' | 'multiselect' | 'checkbox' | 'toggle' | 'date' | 'datetime' | 'person' | 'agent' | 'tags' | 'color' | 'custom';
  render?: (value: unknown, onChange: (v: unknown) => void, values: Record<string, unknown>) => React.ReactNode;
  options?: Option[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  span?: 1 | 2;
  rows?: number;
  description?: string;
  show?: (values: Record<string, unknown>) => boolean;
};

export function SchemaForm({ fields, values, onChange, errors = {} }: { fields: FieldSpec[]; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; errors?: Record<string, string> }) {
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields
        .filter((f) => !f.show || f.show(values))
        .map((f) => {
          const v = values[f.name];
          const err = errors[f.name];
          const span = f.span === 1 ? '' : 'sm:col-span-2';
          switch (f.type) {
            case 'custom':
              // Rendered in a div (not a <label>) because editors contain several controls.
              return (
                <div key={f.name} className={span}>
                  <div className="mb-1 text-[13px] font-medium text-slate-700">{f.label}</div>
                  {f.render?.(v, (x) => set(f.name, x), values)}
                  {err ? <div className="mt-1 text-xs text-rose-600">{err}</div> : f.hint ? <div className="mt-1 text-xs text-slate-500">{f.hint}</div> : null}
                </div>
              );
            case 'textarea':
              return (
                <Field key={f.name} label={f.label} required={f.required} hint={f.hint} error={err} className={span}>
                  <TextArea value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)} rows={f.rows ?? 4} placeholder={f.placeholder} />
                </Field>
              );
            case 'select':
              return (
                <Field key={f.name} label={f.label} required={f.required} hint={f.hint} error={err} className={span}>
                  <SelectBox value={String(v ?? '')} onChange={(x) => set(f.name, x)} placeholder={f.required ? undefined : '—'} options={f.options ?? []} />
                </Field>
              );
            case 'multiselect':
              return (
                <Field key={f.name} label={f.label} hint={f.hint} error={err} className={span}>
                  <MultiSelect value={(v as string[]) ?? []} onChange={(x) => set(f.name, x)} options={f.options ?? []} />
                </Field>
              );
            case 'checkbox':
              return (
                <div key={f.name} className={span}>
                  <Checkbox checked={Boolean(v)} onChange={(x) => set(f.name, x)} label={f.label} description={f.description} />
                </div>
              );
            case 'toggle':
              return (
                <div key={f.name} className={span}>
                  <Toggle checked={Boolean(v)} onChange={(x) => set(f.name, x)} label={f.label} description={f.description} />
                </div>
              );
            case 'number':
              return (
                <Field key={f.name} label={f.label} required={f.required} hint={f.hint} error={err} className={span}>
                  <TextInput type="number" value={v === undefined || v === null ? '' : String(v)} onChange={(e) => set(f.name, e.target.value === '' ? null : Number(e.target.value))} />
                </Field>
              );
            case 'date':
            case 'datetime':
              return (
                <Field key={f.name} label={f.label} required={f.required} hint={f.hint} error={err} className={span}>
                  <TextInput type={f.type === 'date' ? 'date' : 'datetime-local'} value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)} />
                </Field>
              );
            case 'person':
            case 'agent':
              return (
                <Field key={f.name} label={f.label} required={f.required} hint={f.hint} error={err} className={span}>
                  <PersonPicker kind={f.type === 'agent' ? 'agents' : 'all'} value={(v as string) || null} onChange={(id) => set(f.name, id ?? '')} initialLabel={(values[`${f.name}__label`] as string) ?? undefined} />
                </Field>
              );
            case 'tags':
              return (
                <Field key={f.name} label={f.label} hint={f.hint} error={err} className={span}>
                  <TagInput value={(v as string[]) ?? []} onChange={(x) => set(f.name, x)} placeholder={f.placeholder} />
                </Field>
              );
            case 'color':
              return (
                <Field key={f.name} label={f.label} hint={f.hint} error={err} className={span}>
                  <div className="flex gap-2">
                    <input type="color" aria-label={f.label} value={String(v || '#2563eb')} onChange={(e) => set(f.name, e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-300" />
                    <TextInput value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)} />
                  </div>
                </Field>
              );
            default:
              return (
                <Field key={f.name} label={f.label} required={f.required} hint={f.hint} error={err} className={span}>
                  <TextInput type={f.type === 'email' ? 'email' : 'text'} value={String(v ?? '')} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} />
                </Field>
              );
          }
        })}
    </div>
  );
}

export interface CrudColumn<T> {
  label: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

export interface CrudConfig<T extends { id: string }> {
  title: string;
  subtitle?: string;
  singular: string;
  listPath: string;
  queryKey: unknown[];
  paginated?: boolean;
  /** Custom loader when the list endpoint does not return the rows directly. */
  fetcher?: () => Promise<T[]>;
  columns: CrudColumn<T>[];
  fields: FieldSpec[] | ((row: T | null) => FieldSpec[]);
  defaults: Record<string, unknown>;
  toForm?: (row: T) => Record<string, unknown>;
  toPayload?: (values: Record<string, unknown>) => Record<string, unknown>;
  createPath?: string;
  updatePath?: (row: T) => string;
  deletePath?: (row: T) => string | null;
  canEdit?: boolean;
  /** Set false for configuration that can be edited but not created. */
  canCreate?: boolean;
  searchable?: (row: T, q: string) => boolean;
  rowActions?: (row: T) => React.ReactNode;
  headerActions?: React.ReactNode;
  emptyText?: string;
  onSaved?: () => void;
  drawerWidth?: string;
  breadcrumbs?: { label: string; href?: string }[];
  hideHeader?: boolean;
  /** Rendered between the page header and the table (e.g. tabs). */
  beforeTable?: React.ReactNode;
}

export function CrudPage<T extends { id: string }>(cfg: CrudConfig<T>) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState<{ row: T | null; values: Record<string, unknown> } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [q, setQ] = React.useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: cfg.queryKey,
    queryFn: async () => {
      if (cfg.fetcher) return cfg.fetcher();
      if (cfg.paginated) return (await v2.list<T>(cfg.listPath, { per_page: 100 })).items;
      return v2.items<T>(cfg.listPath);
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      const payload = cfg.toPayload ? cfg.toPayload(editing!.values) : editing!.values;
      if (editing!.row) return v2.put((cfg.updatePath ?? ((r: T) => `${cfg.listPath}/${r.id}`))(editing!.row), payload);
      return v2.post(cfg.createPath ?? cfg.listPath, payload);
    },
    onSuccess: () => {
      toast.success(`${cfg.singular} saved`);
      setEditing(null);
      setErrors({});
      qc.invalidateQueries({ queryKey: cfg.queryKey });
      qc.invalidateQueries({ queryKey: ['lookup'] });
      cfg.onSaved?.();
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      toast.error(err.message);
    },
  });
  const remove = useMutation({
    mutationFn: (row: T) => v2.del((cfg.deletePath ?? ((r: T) => `${cfg.listPath}/${r.id}`))(row) as string),
    onSuccess: () => {
      toast.success(`${cfg.singular} deleted`);
      qc.invalidateQueries({ queryKey: cfg.queryKey });
      qc.invalidateQueries({ queryKey: ['lookup'] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const rows = (data ?? []).filter((r) => !q || !cfg.searchable || cfg.searchable(r, q.toLowerCase()));
  const fields = typeof cfg.fields === 'function' ? cfg.fields(editing?.row ?? null) : cfg.fields;
  const canEdit = cfg.canEdit !== false;
  const open = (row: T | null) => {
    setErrors({});
    setEditing({ row, values: row ? (cfg.toForm ? cfg.toForm(row) : { ...(row as unknown as Record<string, unknown>) }) : { ...cfg.defaults } });
  };
  return (
    <>
      {!cfg.hideHeader && (
        <PageHeader
          title={cfg.title}
          subtitle={cfg.subtitle}
          breadcrumbs={cfg.breadcrumbs}
          actions={
            <>
              {cfg.headerActions}
              {canEdit && cfg.canCreate !== false && (
                <Btn variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => open(null)}>
                  New {cfg.singular.toLowerCase()}
                </Btn>
              )}
            </>
          }
        />
      )}
      {cfg.beforeTable}
      <Card padded={false}>
        {cfg.searchable && (
          <div className="border-b border-slate-100 p-3">
            <SearchInput value={q} onChange={setQ} placeholder={`Search ${cfg.title.toLowerCase()}`} className="max-w-sm" />
          </div>
        )}
        {isLoading ? (
          <LoadingBlock />
        ) : error ? (
          <div className="p-6 text-center text-sm text-rose-600">{parseApiError(error).message}</div>
        ) : rows.length === 0 ? (
          <EmptyState title={cfg.emptyText ?? `No ${cfg.title.toLowerCase()} yet`} action={canEdit && cfg.canCreate !== false ? <Btn size="sm" variant="primary" onClick={() => open(null)}>Add {cfg.singular.toLowerCase()}</Btn> : undefined} />
        ) : (
          <Table>
            <thead>
              <tr>
                {cfg.columns.map((c) => (
                  <Th key={c.label} className={c.className}>{c.label}</Th>
                ))}
                {(canEdit || cfg.rowActions) && <Th className="w-28 text-right">Actions</Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  {cfg.columns.map((c) => (
                    <Td key={c.label} className={c.className}>{c.render(row)}</Td>
                  ))}
                  {(canEdit || cfg.rowActions) && (
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        {cfg.rowActions?.(row)}
                        {canEdit && (
                          <button aria-label="Edit" onClick={() => open(row)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {canEdit && (cfg.deletePath ? cfg.deletePath(row) : true) && (
                          <button
                            aria-label="Delete"
                            onClick={async () => (await confirm({ title: `Delete this ${cfg.singular.toLowerCase()}?`, danger: true, confirmLabel: 'Delete' })) && remove.mutate(row)}
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.row ? `Edit ${cfg.singular.toLowerCase()}` : `New ${cfg.singular.toLowerCase()}`}
        width={cfg.drawerWidth}
        footer={
          <>
            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Btn>
          </>
        }
      >
        {editing && <SchemaForm fields={fields} values={editing.values} onChange={(values) => setEditing({ ...editing, values })} errors={errors} />}
        {Object.keys(errors).filter((k) => !fields.some((f) => f.name === k)).map((k) => (
          <p key={k} className="mt-3 text-sm text-rose-600">
            {k.replace(/_/g, ' ')}: {errors[k]}
          </p>
        ))}
      </Drawer>
    </>
  );
}
