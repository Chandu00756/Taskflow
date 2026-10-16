'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Lock, Plus, Trash2 } from 'lucide-react';
import { Badge, Btn, TextInput, Toggle } from '@/components/desk/kit';
import type { ClassificationChoice } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';

const LEVELS = ['Category', 'Sub-category', 'Item'];

type Path = number[];

function update(list: ClassificationChoice[], path: Path, fn: (siblings: ClassificationChoice[], index: number) => ClassificationChoice[]): ClassificationChoice[] {
  if (path.length === 1) return fn(list, path[0]);
  return list.map((c, i) => (i === path[0] ? { ...c, children: update(c.children ?? [], path.slice(1), fn) } : c));
}

function insertChild(list: ClassificationChoice[], path: Path, child: ClassificationChoice): ClassificationChoice[] {
  if (path.length === 0) return [...list, child];
  return list.map((c, i) => (i === path[0] ? { ...c, children: insertChild(c.children ?? [], path.slice(1), child) } : c));
}

function countAll(list: ClassificationChoice[]): number {
  return list.reduce((n, c) => n + 1 + countAll(c.children ?? []), 0);
}

/** Editable category → sub-category → item tree. */
export function CategoryTreeEditor({ value, onChange }: { value: ClassificationChoice[]; onChange: (v: ClassificationChoice[]) => void }) {
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [focus, setFocus] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState('');
  const q = filter.trim().toLowerCase();
  const matches = React.useCallback((c: ClassificationChoice): boolean => !q || c.value.toLowerCase().includes(q) || (c.children ?? []).some(matches), [q]);

  const add = (path: Path, depth: number) => {
    const siblings = path.reduce<ClassificationChoice[]>((l, i) => l[i].children ?? [], value);
    let name = `New ${LEVELS[depth].toLowerCase()}`;
    for (let n = 2; siblings.some((s) => s.value.toLowerCase() === name.toLowerCase()); n++) name = `New ${LEVELS[depth].toLowerCase()} ${n}`;
    onChange(insertChild(value, path, { value: name }));
    setOpen((o) => ({ ...o, [path.join('.')]: true }));
    setFocus([...path, siblings.length].join('.'));
  };

  const rows = (list: ClassificationChoice[], parent: Path, depth: number): React.ReactNode =>
    list.map((c, i) => {
      if (!matches(c)) return null;
      const path = [...parent, i];
      const key = path.join('.');
      const kids = c.children ?? [];
      const expanded = q ? true : open[key];
      const dupe = list.some((o, j) => j !== i && o.value.trim().toLowerCase() === c.value.trim().toLowerCase());
      return (
        <li key={key}>
          <div className={cn('group flex items-center gap-1.5 rounded-md py-1 pr-1 hover:bg-slate-50', depth === 0 && 'font-medium')} style={{ paddingLeft: depth * 22 + 4 }}>
            <button
              type="button"
              aria-label={expanded ? `Collapse ${c.value}` : `Expand ${c.value}`}
              onClick={() => setOpen((o) => ({ ...o, [key]: !expanded }))}
              className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100', (depth === 2 || !kids.length) && 'invisible')}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <input
              aria-label={`${LEVELS[depth]} name`}
              value={c.value}
              autoFocus={focus === key}
              onFocus={(e) => focus === key && e.currentTarget.select()}
              onChange={(e) => onChange(update(value, path, (s, idx) => s.map((x, j) => (j === idx ? { ...x, value: e.target.value } : x))))}
              className={cn('h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 text-sm text-slate-800 hover:border-slate-200 focus:border-blue-400 focus:bg-white focus:outline-none', (dupe || !c.value.trim()) && 'border-rose-300 bg-rose-50')}
            />
            {kids.length > 0 && <span className="shrink-0 text-xs text-slate-400">{kids.length}</span>}
            <span className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
              {depth < 2 && (
                <button type="button" title={`Add ${LEVELS[depth + 1].toLowerCase()}`} aria-label={`Add ${LEVELS[depth + 1].toLowerCase()} to ${c.value}`} onClick={() => add(path, depth + 1)} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-600">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
              <button type="button" title="Move up" aria-label={`Move ${c.value} up`} disabled={i === 0} onClick={() => onChange(update(value, path, (s, idx) => { const n = [...s]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; return n; }))} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" title="Move down" aria-label={`Move ${c.value} down`} disabled={i === list.length - 1} onClick={() => onChange(update(value, path, (s, idx) => { const n = [...s]; [n[idx + 1], n[idx]] = [n[idx], n[idx + 1]]; return n; }))} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Remove"
                aria-label={`Remove ${c.value}`}
                onClick={() => {
                  if (kids.length && !window.confirm(`Remove ${c.value} and its ${countAll(kids)} entries?`)) return;
                  onChange(update(value, path, (s, idx) => s.filter((_, j) => j !== idx)));
                }}
                className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          {expanded && kids.length > 0 && <ul>{rows(kids, path, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <TextInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter categories…" className="h-8 max-w-xs" aria-label="Filter categories" />
        <Btn size="sm" variant="ghost" onClick={() => setOpen(Object.fromEntries(value.map((_, i) => [String(i), true])))}>Expand all</Btn>
        <Btn size="sm" variant="ghost" onClick={() => setOpen({})}>Collapse all</Btn>
        <span className="text-xs text-slate-500">{value.length} categories · {countAll(value)} entries</span>
      </div>
      <ul className="max-h-[32rem] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1">
        {value.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No categories yet.</li>}
        {rows(value, [], 0)}
      </ul>
      <Btn size="sm" className="mt-3" icon={<Plus className="h-4 w-4" />} onClick={() => add([], 0)}>Add category</Btn>
      <p className="mt-2 text-xs text-slate-500">Hover a row to add a sub-category or item, reorder or remove it. Click a name to rename it.</p>
    </div>
  );
}

/** Editable flat list, e.g. business impact. */
export function ChoiceListEditor({ value, onChange, noun = 'option' }: { value: ClassificationChoice[]; onChange: (v: ClassificationChoice[]) => void; noun?: string }) {
  const [focus, setFocus] = React.useState<number | null>(null);
  return (
    <div>
      <ul className="space-y-1.5">
        {value.map((c, i) => {
          const dupe = value.some((o, j) => j !== i && o.value.trim().toLowerCase() === c.value.trim().toLowerCase());
          return (
            <li key={i} className="flex items-center gap-1.5">
              <TextInput aria-label={`${noun} ${i + 1}`} autoFocus={focus === i} value={c.value} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className={cn('h-8', (dupe || !c.value.trim()) && 'border-rose-300 bg-rose-50')} />
              <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => { const n = [...value]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" aria-label="Move down" disabled={i === value.length - 1} onClick={() => { const n = [...value]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; onChange(n); }} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
              <button type="button" aria-label={`Remove ${c.value}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          );
        })}
      </ul>
      <Btn size="sm" className="mt-3" icon={<Plus className="h-4 w-4" />} onClick={() => { onChange([...value, { value: '' }]); setFocus(value.length); }}>Add {noun}</Btn>
    </div>
  );
}

/** Change types with their approval rule; built-in types can be renamed but not removed. */
export function ChangeTypesEditor({ value, onChange }: { value: ClassificationChoice[]; onChange: (v: ClassificationChoice[]) => void }) {
  const set = (i: number, patch: Partial<ClassificationChoice>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-3">
      {value.map((t, i) => (
        <div key={t.value || i} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <TextInput aria-label="Change type name" value={t.label ?? ''} onChange={(e) => set(i, { label: e.target.value })} placeholder="Name, e.g. Cloud migration" className="h-8 max-w-xs font-medium" />
            {t.system ? (
              <Badge className="bg-slate-100 text-slate-600 ring-slate-500/20"><Lock className="mr-1 h-3 w-3" />Built-in</Badge>
            ) : (
              <Badge className="bg-blue-50 text-blue-700 ring-blue-600/20">Custom</Badge>
            )}
            <div className="ml-auto flex items-center gap-3">
              <Toggle checked={!!t.requires_approval} disabled={t.system} onChange={(v) => set(i, { requires_approval: v })} label="Needs CAB approval" />
              {!t.system && (
                <button type="button" aria-label={`Remove ${t.label || 'change type'}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <TextInput aria-label="Change type description" value={t.description ?? ''} onChange={(e) => set(i, { description: e.target.value })} placeholder="When to use this type" className="mt-2 h-8" />
        </div>
      ))}
      <Btn size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...value, { value: '', label: '', requires_approval: false }])}>Add change type</Btn>
      <p className="text-xs text-slate-500">Changes whose type needs CAB approval cannot move past planning until they are approved.</p>
    </div>
  );
}
