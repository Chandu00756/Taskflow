'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useCan } from '@/lib/itsm/hooks';
import { Btn, Card, EmptyState, ErrorBlock, LinkBtn, LoadingBlock, PageHeader, Pagination, SearchInput, SelectBox, Table, Td, Th, Tabs, useConfirm, Option } from './kit';
import { FieldSpec, SchemaForm } from './crud';
import { Markdown } from './markdown';
import { ActivityPanel, AssociationsPanel, Composer, ConversationThread, Module, TasksPanel, TimePanel } from './record-panels';
import { useDebounced } from './pickers';

export interface ListColumn<T> {
  label: string;
  render: (row: T) => React.ReactNode;
  sortKey?: string;
  className?: string;
}

export function RecordList<T extends { id: string }>({ module, title, subtitle, singular, columns, filters, newHref, managePriv, extraParams, headerExtra }: {
  module: Module;
  title: string;
  subtitle?: string;
  singular: string;
  columns: ListColumn<T>[];
  filters: { name: string; label: string; options: Option[] }[];
  newHref: string;
  managePriv: string;
  extraParams?: Record<string, string>;
  headerExtra?: React.ReactNode;
}) {
  const can = useCan();
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [sort, setSort] = React.useState({ key: 'created_at', order: 'desc' });
  const [trash, setTrash] = React.useState(false);
  const term = useDebounced(q, 300);
  React.useEffect(() => setPage(1), [term, values, trash]);
  const params = { q: term, page, per_page: 30, sort: sort.key, order: sort.order, view: trash ? 'trash' : undefined, ...values, ...extraParams };
  const { data, isLoading, error } = useQuery({
    queryKey: [module, 'list', params],
    queryFn: () => v2.list<T>(`/${module}`, params),
    placeholderData: (p) => p,
  });
  const rowHref = (row: T) => `/${module}/${row.id}`;
  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {headerExtra}
            {can(managePriv) && (
              <LinkBtn href={newHref} variant="primary" size="sm" icon={<Plus className="h-4 w-4" />}>
                New {singular.toLowerCase()}
              </LinkBtn>
            )}
          </>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <SearchInput value={q} onChange={setQ} placeholder={`Search ${title.toLowerCase()}`} className="w-full sm:w-72" />
          {filters.map((f) => (
            <SelectBox key={f.name} aria-label={f.label} value={values[f.name] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} placeholder={`Any ${f.label.toLowerCase()}`} options={f.options} className="w-44" />
          ))}
          {can(managePriv) && (
            <Btn size="sm" variant={trash ? 'subtle' : 'ghost'} className="ml-auto" icon={<Trash2 className="h-4 w-4" />} onClick={() => setTrash((v) => !v)}>
              {trash ? 'Viewing trash' : 'Trash'}
            </Btn>
          )}
        </div>
        {isLoading ? (
          <LoadingBlock />
        ) : error ? (
          <div className="p-6 text-center text-sm text-rose-600">{parseApiError(error).message}</div>
        ) : (data?.items ?? []).length === 0 ? (
          <EmptyState title={`No ${title.toLowerCase()} found`} action={can(managePriv) && !trash ? <LinkBtn href={newHref} variant="primary" size="sm">Create {singular.toLowerCase()}</LinkBtn> : undefined} />
        ) : (
          <Table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <Th
                    key={c.label}
                    className={c.className}
                    onClick={c.sortKey ? () => setSort((s) => ({ key: c.sortKey!, order: s.key === c.sortKey && s.order === 'desc' ? 'asc' : 'desc' })) : undefined}
                    sorted={c.sortKey && sort.key === c.sortKey ? (sort.order as 'asc' | 'desc') : null}
                  >
                    {c.label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data!.items.map((row) => (
                <tr key={row.id} className="cursor-pointer hover:bg-slate-50">
                  {columns.map((c, i) => (
                    <Td key={c.label} className={c.className}>
                      {i === 0 ? <Link href={rowHref(row)} className="block">{c.render(row)}</Link> : c.render(row)}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {data && <Pagination page={data.page} perPage={data.per_page} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}

export function RecordCreate({ module, title, singular, sections, defaults, toPayload, managePriv }: {
  module: Module;
  title: string;
  singular: string;
  sections: { title: string; fields: FieldSpec[] }[];
  defaults: Record<string, unknown>;
  toPayload: (v: Record<string, unknown>) => Record<string, unknown>;
  managePriv: string;
}) {
  const router = useRouter();
  const can = useCan();
  const [values, setValues] = React.useState<Record<string, unknown>>(defaults);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => v2.post<{ id: string; display_id: string }>(`/${module}`, toPayload(values)),
    onSuccess: (r) => {
      toast.success(`${r.display_id} created`);
      router.push(`/${module}/${r.id}`);
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      toast.error(err.message);
    },
  });
  if (!can(managePriv)) return <ErrorBlock message={`You do not have permission to create ${singular.toLowerCase()}s.`} />;
  return (
    <>
      <PageHeader title={title} breadcrumbs={[{ label: singular + 's', href: `/${module}` }, { label: 'New' }]} />
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        {sections.map((s) => (
          <Card key={s.title} title={s.title}>
            <SchemaForm fields={s.fields} values={values} onChange={setValues} errors={errors} />
          </Card>
        ))}
        <div className="flex justify-end gap-2">
          <Btn onClick={() => router.back()}>Cancel</Btn>
          <Btn type="submit" variant="primary" loading={create.isPending}>
            Create {singular.toLowerCase()}
          </Btn>
        </div>
      </form>
    </>
  );
}

export interface DetailConfig<R> {
  module: Module;
  singular: string;
  managePriv: string;
  fetchPath: (id: string) => string;
  extract: (data: unknown) => R;
  title: (r: R) => string;
  displayId: (r: R) => string;
  badges: (r: R) => React.ReactNode;
  propertyFields: FieldSpec[];
  sections: { title: string; fields: FieldSpec[] }[];
  toForm: (r: R) => Record<string, unknown>;
  toPayload: (v: Record<string, unknown>) => Record<string, unknown>;
  headerActions?: (r: R, data: unknown, refresh: () => void) => React.ReactNode;
  topContent?: (r: R, data: unknown, refresh: () => void) => React.ReactNode;
  extraTabs?: { value: string; label: string; render: (r: R, data: unknown) => React.ReactNode }[];
  associationTypes?: string[];
  isDeleted: (r: R) => boolean;
}

export function RecordDetail<R extends { id: string; description: string }>({ id, cfg }: { id: string; cfg: DetailConfig<R> }) {
  const qc = useQueryClient();
  const can = useCan();
  const confirm = useConfirm();
  const router = useRouter();
  const [tab, setTab] = React.useState('details');
  const key = [cfg.module.slice(0, -1), id];
  const { data, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => v2.get<unknown>(cfg.fetchPath(id)) });
  const record = data ? cfg.extract(data) : null;
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  // Recompute only when the server data changes; cfg is recreated each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = React.useMemo(() => (record ? cfg.toForm(record) : {}), [data]);
  React.useEffect(() => setValues(initial), [initial]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['activities', cfg.module, id] });
    qc.invalidateQueries({ queryKey: [cfg.module, 'list'] });
  };
  const save = useMutation({
    mutationFn: () => v2.put(`/${cfg.module}/${id}`, cfg.toPayload(values)),
    onSuccess: () => {
      setErrors({});
      toast.success(`${cfg.singular} updated`);
      refresh();
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      toast.error(err.message);
    },
  });
  const trash = useMutation({
    mutationFn: (deleted: boolean) => (deleted ? v2.del(`/${cfg.module}/${id}`) : v2.post(`/${cfg.module}/${id}/restore`)),
    onSuccess: (_d, deleted) => {
      toast.success(deleted ? 'Moved to trash' : 'Restored');
      if (deleted) router.push(`/${cfg.module}`);
      else refresh();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  if (isLoading) return <LoadingBlock />;
  if (error || !record) return <ErrorBlock message={parseApiError(error).message} onRetry={() => refetch()} />;
  const manage = can(cfg.managePriv);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const deleted = cfg.isDeleted(record);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: cfg.singular + 's', href: `/${cfg.module}` }, { label: cfg.displayId(record) }]}
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono text-base text-slate-400">{cfg.displayId(record)}</span>
            {cfg.title(record)}
          </span>
        }
        subtitle={<span className="flex flex-wrap items-center gap-2">{cfg.badges(record)}</span>}
        actions={
          <>
            {cfg.headerActions?.(record, data, refresh)}
            {manage &&
              (deleted ? (
                <Btn size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => trash.mutate(false)}>Restore</Btn>
              ) : (
                <Btn size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={async () => (await confirm({ title: `Move this ${cfg.singular.toLowerCase()} to trash?`, danger: true, confirmLabel: 'Move to trash' })) && trash.mutate(true)}>
                  Delete
                </Btn>
              ))}
          </>
        }
      />
      {cfg.topContent?.(record, data, refresh)}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'details', label: 'Details' },
              { value: 'notes', label: 'Notes' },
              { value: 'tasks', label: 'Tasks' },
              { value: 'time', label: 'Time' },
              { value: 'associations', label: 'Associations' },
              ...(cfg.extraTabs ?? []).map((t) => ({ value: t.value, label: t.label })),
              { value: 'activity', label: 'Activity' },
            ]}
          />
          {tab === 'details' && (
            <div className="space-y-5">
              {cfg.sections.map((s) => (
                <Card key={s.title} title={s.title}>
                  {manage ? (
                    <SchemaForm fields={s.fields} values={values} onChange={setValues} errors={errors} />
                  ) : (
                    <div className="space-y-4">
                      {s.fields.map((f) => (
                        <div key={f.name}>
                          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{f.label}</div>
                          <Markdown text={String(values[f.name] ?? '')} />
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
              {manage && (
                <div className="flex justify-end">
                  <Btn variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                    Save changes
                  </Btn>
                </div>
              )}
            </div>
          )}
          {tab === 'notes' && (
            <div className="space-y-5">
              <ConversationThread module={cfg.module} id={id} />
              <Composer module={cfg.module} id={id} modes={['note']} />
            </div>
          )}
          {tab === 'tasks' && <TasksPanel module={cfg.module} id={id} canManage={manage} />}
          {tab === 'time' && <TimePanel module={cfg.module} id={id} />}
          {tab === 'associations' && <AssociationsPanel module={cfg.module} id={id} canManage={manage} allowed={cfg.associationTypes} />}
          {tab === 'activity' && <ActivityPanel module={cfg.module} id={id} />}
          {(cfg.extraTabs ?? []).filter((t) => t.value === tab).map((t) => (
            <React.Fragment key={t.value}>{t.render(record, data)}</React.Fragment>
          ))}
        </div>
        <Card title="Properties">
          <div className="[&_.grid]:grid-cols-1">
            <SchemaForm fields={cfg.propertyFields.map((f) => ({ ...f, span: 2 }))} values={values} onChange={manage ? setValues : () => undefined} errors={errors} />
          </div>
          {manage && (
            <Btn variant="primary" className="mt-4 w-full" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              Update
            </Btn>
          )}
        </Card>
      </div>
    </>
  );
}
