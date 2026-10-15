'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Btn, SelectBox, TextInput } from './kit';

export type FieldDef = { name: string; label: string; type: string; choices?: string[]; required?: boolean };

/** Editor for a list of form field definitions (asset types, catalog items). */
export function FieldDefsEditor({ value, onChange, types, withRequired = false }: { value: FieldDef[]; onChange: (v: FieldDef[]) => void; types: { value: string; label: string }[]; withRequired?: boolean }) {
  const rows = value ?? [];
  const update = (i: number, patch: Partial<FieldDef>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="rounded-md border border-slate-200 p-2">
          <div className="grid grid-cols-12 gap-2">
            <TextInput className="col-span-4" value={r.label} placeholder="Label" onChange={(e) => update(i, { label: e.target.value, name: r.name || slug(e.target.value) })} />
            <TextInput className="col-span-3 font-mono text-xs" value={r.name} placeholder="key" onChange={(e) => update(i, { name: slug(e.target.value) })} />
            <SelectBox className="col-span-4" value={r.type} onChange={(v) => update(i, { type: v })} options={types} />
            <button type="button" aria-label="Remove field" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="col-span-1 flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-rose-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {(r.type === 'dropdown' || r.type === 'multi_select') && (
            <TextInput className="mt-2" value={(r.choices ?? []).join(', ')} placeholder="Choices, separated by commas" onChange={(e) => update(i, { choices: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
          )}
          {withRequired && (
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={!!r.required} onChange={(e) => update(i, { required: e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300" /> Required
            </label>
          )}
        </div>
      ))}
      <Btn size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...rows, { name: '', label: '', type: types[0]?.value ?? 'text' }])}>
        Add field
      </Btn>
    </div>
  );
}

function slug(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}
