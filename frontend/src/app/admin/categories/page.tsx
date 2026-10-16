'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { RotateCcw, Save, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { Btn, Card, ErrorBlock, LoadingBlock, PageHeader, Tabs, useConfirm } from '@/components/desk/kit';
import { CategoryTreeEditor, ChangeTypesEditor, ChoiceListEditor } from '@/components/admin/classifications';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useInvalidateLookups } from '@/lib/itsm/hooks';
import type { Classification, ClassificationChoice } from '@/lib/itsm/types';

type Entity = 'ticket' | 'problem' | 'change';

const MODULES: { value: Entity; label: string; intro: string }[] = [
  { value: 'ticket', label: 'Tickets', intro: 'Used on incidents and service requests, in the portal and in automation rules.' },
  { value: 'problem', label: 'Problems', intro: 'Classify problems for root-cause analysis and trend reporting.' },
  { value: 'change', label: 'Changes', intro: 'Change types decide which changes need CAB approval; categories group changes on the calendar and in reports.' },
];

const SECTION_TEXT: Record<string, { title: string; text: string }> = {
  category: { title: 'Categories', text: 'Three levels: category, sub-category and item. Records keep the values they were saved with if you rename or remove an entry later.' },
  impact_on_business: { title: 'Business impact', text: 'Requesters pick one of these in the portal ("How is this affecting your work?").' },
  business_impact: { title: 'Business impact', text: 'How much the business is affected.' },
  change_type: { title: 'Change types', text: 'Built-in types keep their approval rule. Add your own types and decide whether they need CAB approval.' },
};

function stripEmpty(list: ClassificationChoice[]): ClassificationChoice[] {
  return list.map((c) => ({ ...c, children: c.children?.length ? stripEmpty(c.children) : undefined }));
}

function ListSection({ item, onSaved }: { item: Classification; onSaved: (items: Classification[]) => void }) {
  const confirm = useConfirm();
  const invalidate = useInvalidateLookups();
  const [draft, setDraft] = React.useState<ClassificationChoice[]>(item.choices);
  const [saved, setSaved] = React.useState(JSON.stringify(item.choices));
  React.useEffect(() => {
    setDraft(item.choices);
    setSaved(JSON.stringify(item.choices));
  }, [item.choices]);
  const dirty = JSON.stringify(draft) !== saved;
  const done = (items: Classification[], msg: string) => {
    toast.success(msg);
    invalidate();
    onSaved(items);
  };
  const save = useMutation({
    mutationFn: () => v2.put<{ items: Classification[] }>(`/classifications/${item.entity}/${item.name}`, { choices: stripEmpty(draft) }),
    onSuccess: (r) => done(r.items, `${SECTION_TEXT[item.name]?.title ?? item.label} saved`),
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const reset = useMutation({
    mutationFn: () => v2.post<{ items: Classification[] }>(`/classifications/${item.entity}/${item.name}/reset`),
    onSuccess: (r) => done(r.items, 'Defaults restored'),
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const meta = SECTION_TEXT[item.name] ?? { title: item.label, text: '' };
  return (
    <Card
      title={meta.title}
      actions={
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs font-medium text-amber-600">Unsaved changes</span>}
          <Btn
            size="sm"
            variant="ghost"
            icon={<RotateCcw className="h-4 w-4" />}
            loading={reset.isPending}
            onClick={async () => {
              if (await confirm({ title: `Restore default ${meta.title.toLowerCase()}?`, message: 'Your current list is replaced by the TaskFlow defaults. Existing records keep their values.', confirmLabel: 'Restore defaults' })) reset.mutate();
            }}
          >
            Restore defaults
          </Btn>
          {dirty && <Btn size="sm" variant="ghost" onClick={() => setDraft(JSON.parse(saved))}>Discard</Btn>}
          <Btn size="sm" variant="primary" icon={<Save className="h-4 w-4" />} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Btn>
        </div>
      }
    >
      <p className="mb-4 text-sm text-slate-500">{meta.text}</p>
      {item.name === 'change_type' ? (
        <ChangeTypesEditor value={draft} onChange={setDraft} />
      ) : item.field_type === 'nested' ? (
        <CategoryTreeEditor value={draft} onChange={setDraft} />
      ) : (
        <ChoiceListEditor value={draft} onChange={setDraft} noun="option" />
      )}
      {!item.field_id && <p className="mt-3 text-xs text-amber-700">This list was removed from the form. Saving or restoring defaults adds it back.</p>}
    </Card>
  );
}

export default function CategoriesPage() {
  const [entity, setEntity] = React.useState<Entity>(() => {
    if (typeof window === 'undefined') return 'ticket';
    const h = window.location.hash.slice(1);
    return (MODULES.some((m) => m.value === h) ? h : 'ticket') as Entity;
  });
  const q = useQuery({ queryKey: ['classifications', entity], queryFn: () => v2.items<Classification>('/classifications', { entity }) });
  const [items, setItems] = React.useState<Classification[] | null>(null);
  React.useEffect(() => setItems(q.data ?? null), [q.data]);
  const mod = MODULES.find((m) => m.value === entity)!;
  return (
    <>
      <PageHeader
        title="Categories & classifications"
        subtitle="Categories, sub-categories, items, business impact and change types for each module."
        icon={<Tags className="h-5 w-5" />}
        breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Categories' }]}
      />
      <Tabs
        className="mb-2"
        value={entity}
        onChange={(v) => {
          setEntity(v as Entity);
          window.history.replaceState(null, '', `#${v}`);
        }}
        tabs={MODULES.map((m) => ({ value: m.value, label: m.label }))}
      />
      <p className="mb-5 text-sm text-slate-500">{mod.intro}</p>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock message={parseApiError(q.error).message} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-5">
          {(items ?? []).map((it) => (
            <ListSection key={`${it.entity}-${it.name}`} item={it} onSaved={setItems} />
          ))}
        </div>
      )}
    </>
  );
}
