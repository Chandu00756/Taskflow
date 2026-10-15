'use client';

import * as React from 'react';
import { CrudPage } from '@/components/desk/crud';
import { Badge, SelectBox, TextArea } from '@/components/desk/kit';
import { labelize } from '@/lib/itsm/format';
import type { FormField } from '@/lib/itsm/types';

type Choice = { value: string; children?: Choice[] };

function toText(choices: Choice[], depth = 0): string {
  return (choices ?? []).map((c) => '  '.repeat(depth) + c.value + (c.children?.length ? '\n' + toText(c.children, depth + 1) : '')).join('\n');
}

function fromText(text: string, nested: boolean): Choice[] {
  const root: Choice[] = [];
  const stack: { depth: number; list: Choice[] }[] = [{ depth: -1, list: root }];
  text.split('\n').forEach((line) => {
    if (!line.trim()) return;
    const depth = nested ? Math.min(2, Math.floor((line.length - line.trimStart().length) / 2)) : 0;
    const node: Choice = { value: line.trim() };
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    parent.list.push(node);
    node.children = [];
    stack.push({ depth, list: node.children });
  });
  const clean = (l: Choice[]): Choice[] => l.map((c) => (c.children && c.children.length ? { value: c.value, children: clean(c.children) } : { value: c.value }));
  return clean(root);
}

function ChoicesEditor({ value, onChange, nested }: { value: Choice[]; onChange: (v: Choice[]) => void; nested: boolean }) {
  const [text, setText] = React.useState(() => toText(value));
  return (
    <div>
      <TextArea
        rows={10}
        className="font-mono text-xs"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(fromText(e.target.value, nested));
        }}
        placeholder={nested ? 'Hardware\n  Laptop\n    Battery\nSoftware' : 'One choice per line'}
      />
      <p className="mt-1 text-xs text-slate-500">{nested ? 'One choice per line. Indent with two spaces for sub-categories and four for items.' : 'One choice per line.'}</p>
    </div>
  );
}

const TYPES = ['text', 'paragraph', 'number', 'decimal', 'dropdown', 'multi_select', 'checkbox', 'date', 'nested'].map((v) => ({ value: v, label: labelize(v) }));

export default function FieldsPage() {
  const [entity, setEntity] = React.useState('ticket');
  return (
    <CrudPage<FormField>
      title="Form fields"
      subtitle="Customize the ticket form for agents and the portal. The category field drives the category / sub-category / item pickers."
      singular="Field"
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Form fields' }]}
      listPath={`/form-fields?entity=${entity}`}
      createPath="/form-fields"
      updatePath={(r) => `/form-fields/${r.id}`}
      deletePath={(r) => (r.is_default ? null : `/form-fields/${r.id}`)}
      queryKey={['lookup', 'form-fields', entity]}
      headerActions={<SelectBox aria-label="Form" value={entity} onChange={setEntity} className="w-40" options={['ticket', 'problem', 'change', 'release', 'asset', 'requester'].map((v) => ({ value: v, label: `${labelize(v)} form` }))} />}
      columns={[
        { label: 'Field', render: (r) => <div><div className="font-medium text-slate-900">{r.label} {r.is_default && <Badge className="ml-1 bg-slate-100 text-slate-600 ring-slate-500/20">System</Badge>}</div><div className="font-mono text-xs text-slate-500">{r.name}</div></div> },
        { label: 'Type', render: (r) => labelize(r.field_type) },
        { label: 'Portal', render: (r) => (r.displayed_to_requester ? (r.editable_by_requester ? 'Editable' : 'Visible') : 'Hidden') },
        { label: 'Required', render: (r) => [r.required_for_agents && 'agents', r.required_for_requesters && 'requesters', r.required_for_closure && 'on close'].filter(Boolean).join(', ') || '—' },
        { label: 'Active', render: (r) => (r.active ? 'Yes' : 'No') },
      ]}
      fields={(row) => [
        { name: 'label', label: 'Label for agents', required: true, span: 1 },
        { name: 'label_for_requester', label: 'Label for requesters', span: 1 },
        ...(row?.is_default ? [] : [
          { name: 'name', label: 'Key', required: true, span: 1 as const, hint: 'letters, numbers, underscores' },
          { name: 'field_type', label: 'Type', type: 'select' as const, required: true, span: 1 as const, options: TYPES },
        ]),
        { name: 'choices', label: 'Choices', type: 'custom', show: (v) => ['dropdown', 'multi_select', 'nested'].includes(String(v.field_type)), render: (v, onChange, values) => <ChoicesEditor key={String(values.field_type)} value={(v as Choice[]) ?? []} onChange={onChange} nested={values.field_type === 'nested'} /> },
        { name: 'position', label: 'Position', type: 'number', span: 1 },
        { name: 'active', label: 'Active', type: 'toggle' },
        { name: 'displayed_to_requester', label: 'Show in the portal', type: 'checkbox' },
        { name: 'editable_by_requester', label: 'Requesters can fill it in', type: 'checkbox' },
        { name: 'required_for_agents', label: 'Required for agents', type: 'checkbox' },
        { name: 'required_for_requesters', label: 'Required for requesters', type: 'checkbox' },
        { name: 'required_for_closure', label: 'Required to resolve or close', type: 'checkbox' },
      ]}
      defaults={{ entity, name: '', label: '', label_for_requester: '', field_type: 'text', choices: [], position: 10, active: true, displayed_to_requester: true, editable_by_requester: true, required_for_agents: false, required_for_requesters: false, required_for_closure: false }}
      toForm={(r) => ({ ...r })}
      toPayload={(v) => ({ ...v, entity, position: Number(v.position || 0) })}
      drawerWidth="max-w-2xl"
    />
  );
}
