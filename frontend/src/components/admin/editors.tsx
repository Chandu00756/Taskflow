'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Btn, Checkbox, SelectBox, TextArea, TextInput, Toggle } from '@/components/desk/kit';
import { useAgentOptions, useDepartmentOptions, useGroupOptions } from '@/components/desk/pickers';
import { PRIORITIES, TICKET_SOURCES, TICKET_STATUSES, LEVELS, labelize } from '@/lib/itsm/format';
import type { AutomationAction, DaySpec, RuleCondition, SLATarget } from '@/lib/itsm/types';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function WeekEditor({ value, onChange }: { value: Record<string, DaySpec[]>; onChange: (v: Record<string, DaySpec[]>) => void }) {
  const v = value ?? {};
  return (
    <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
      {DAYS.map((d) => {
        const win = v[d]?.[0];
        return (
          <div key={d} className="flex items-center gap-3 px-3 py-2">
            <div className="w-32">
              <Checkbox
                checked={!!win}
                onChange={(on) => {
                  const next = { ...v };
                  if (on) next[d] = [{ start: '09:00', end: '18:00' }];
                  else delete next[d];
                  onChange(next);
                }}
                label={labelize(d)}
              />
            </div>
            {win ? (
              <div className="flex items-center gap-2">
                <TextInput type="time" className="w-32" value={win.start} onChange={(e) => onChange({ ...v, [d]: [{ ...win, start: e.target.value }] })} />
                <span className="text-sm text-slate-500">to</span>
                <TextInput type="time" className="w-32" value={win.end === '24:00' ? '23:59' : win.end} onChange={(e) => onChange({ ...v, [d]: [{ ...win, end: e.target.value }] })} />
              </div>
            ) : (
              <span className="text-sm text-slate-400">Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function HolidaysEditor({ value, onChange }: { value: { date: string; name: string }[]; onChange: (v: { date: string; name: string }[]) => void }) {
  const rows = value ?? [];
  return (
    <div className="space-y-2">
      {rows.map((h, i) => (
        <div key={i} className="flex gap-2">
          <TextInput type="date" className="w-44" value={h.date} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
          <TextInput value={h.name} placeholder="Holiday name" onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <button type="button" aria-label="Remove holiday" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="rounded px-2 text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <Btn size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...rows, { date: '', name: '' }])}>Add holiday</Btn>
    </div>
  );
}

function DurationInput({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const set = (dd: number, hh: number, mm: number) => onChange(Math.max(1, dd * 1440 + hh * 60 + mm));
  return (
    <div className="flex items-center gap-1 text-xs text-slate-500">
      <TextInput type="number" min={0} className="w-14 px-2" value={d} onChange={(e) => set(Number(e.target.value), h, m)} aria-label="Days" />d
      <TextInput type="number" min={0} max={23} className="w-14 px-2" value={h} onChange={(e) => set(d, Number(e.target.value), m)} aria-label="Hours" />h
      <TextInput type="number" min={0} max={59} className="w-14 px-2" value={m} onChange={(e) => set(d, h, Number(e.target.value))} aria-label="Minutes" />m
    </div>
  );
}

export function SLATargetsEditor({ value, onChange }: { value: SLATarget[]; onChange: (v: SLATarget[]) => void }) {
  const rows = [4, 3, 2, 1].map(
    (p) => value?.find((t) => t.priority === p) ?? { priority: p, respond_within_minutes: 60, resolve_within_minutes: 480, business_hours: true, escalation_enabled: true }
  );
  const update = (p: number, patch: Partial<SLATarget>) => onChange(rows.map((r) => (r.priority === p ? { ...r, ...patch } : r)));
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Priority</th>
            <th className="px-3 py-2 text-left">Respond within</th>
            <th className="px-3 py-2 text-left">Resolve within</th>
            <th className="px-3 py-2 text-left">Business hours</th>
            <th className="px-3 py-2 text-left">Escalate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.priority}>
              <td className="px-3 py-2 font-medium">{PRIORITIES.find((p) => p.value === r.priority)?.label}</td>
              <td className="px-3 py-2"><DurationInput minutes={r.respond_within_minutes} onChange={(m) => update(r.priority, { respond_within_minutes: m })} /></td>
              <td className="px-3 py-2"><DurationInput minutes={r.resolve_within_minutes} onChange={(m) => update(r.priority, { resolve_within_minutes: m })} /></td>
              <td className="px-3 py-2"><Toggle checked={r.business_hours} onChange={(v) => update(r.priority, { business_hours: v })} /></td>
              <td className="px-3 py-2"><Toggle checked={r.escalation_enabled} onChange={(v) => update(r.priority, { escalation_enabled: v })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workflow conditions & actions
// ---------------------------------------------------------------------------

const RULE_FIELDS = [
  { value: 'subject', label: 'Subject' },
  { value: 'description', label: 'Description' },
  { value: 'type', label: 'Type' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'urgency', label: 'Urgency' },
  { value: 'impact', label: 'Impact' },
  { value: 'source', label: 'Source' },
  { value: 'group_id', label: 'Group' },
  { value: 'responder_id', label: 'Agent' },
  { value: 'department_id', label: 'Department' },
  { value: 'requester_email', label: 'Requester email' },
  { value: 'category', label: 'Category' },
  { value: 'sub_category', label: 'Sub-category' },
  { value: 'tags', label: 'Tags' },
];

const OPERATORS: Record<string, string> = {
  is: 'is', is_not: 'is not', contains: 'contains', not_contains: 'does not contain', starts_with: 'starts with', ends_with: 'ends with',
  in: 'is any of', not_in: 'is none of', is_empty: 'is empty', is_not_empty: 'is not empty', greater_than: 'is greater than', less_than: 'is less than',
  changed: 'changed', changed_to: 'changed to', changed_from: 'changed from',
};

function useValueOptions() {
  const groups = useGroupOptions();
  const agents = useAgentOptions();
  const depts = useDepartmentOptions();
  return (field: string): { value: string | number; label: string }[] | null => {
    switch (field) {
      case 'type':
        return [{ value: 'incident', label: 'Incident' }, { value: 'service_request', label: 'Service request' }];
      case 'status':
        return TICKET_STATUSES;
      case 'priority':
        return PRIORITIES.map((p) => ({ value: p.value, label: p.label }));
      case 'urgency':
      case 'impact':
        return LEVELS;
      case 'source':
        return TICKET_SOURCES;
      case 'group_id':
        return groups;
      case 'responder_id':
        return agents;
      case 'department_id':
        return depts;
    }
    return null;
  };
}

export function ConditionsEditor({ value, onChange, event }: { value: { match: 'all' | 'any'; rules: RuleCondition[] }; onChange: (v: { match: 'all' | 'any'; rules: RuleCondition[] }) => void; event?: string }) {
  const v = value ?? { match: 'all', rules: [] };
  const valueOptions = useValueOptions();
  const ops = Object.entries(OPERATORS).filter(([k]) => event === 'ticket_updated' || !k.startsWith('changed')).map(([value, label]) => ({ value, label }));
  const update = (i: number, patch: Partial<RuleCondition>) => onChange({ ...v, rules: v.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-slate-600">
        Match
        <SelectBox className="w-28" value={v.match} onChange={(m) => onChange({ ...v, match: m as 'all' | 'any' })} options={[{ value: 'all', label: 'ALL' }, { value: 'any', label: 'ANY' }]} />
        of the following conditions {v.rules.length === 0 && <span className="text-slate-400">(no conditions — runs on every ticket)</span>}
      </div>
      {v.rules.map((r, i) => {
        const opts = valueOptions(r.field);
        const needsValue = !['is_empty', 'is_not_empty', 'changed'].includes(r.operator);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50/60 p-2">
            <SelectBox className="w-40" value={r.field} onChange={(f) => update(i, { field: f, value: '' })} options={RULE_FIELDS} />
            <SelectBox className="w-44" value={r.operator} onChange={(o) => update(i, { operator: o })} options={ops} />
            {needsValue &&
              (opts && ['is', 'is_not', 'changed_to', 'changed_from'].includes(r.operator) ? (
                <SelectBox className="min-w-[160px] flex-1" value={String(r.value ?? '')} onChange={(x) => update(i, { value: x })} placeholder="Select…" options={opts} />
              ) : (
                <TextInput className="min-w-[160px] flex-1" value={String(r.value ?? '')} onChange={(e) => update(i, { value: e.target.value })} placeholder={['in', 'not_in'].includes(r.operator) ? 'value1, value2' : 'Value'} />
              ))}
            <button type="button" aria-label="Remove condition" onClick={() => onChange({ ...v, rules: v.rules.filter((_, j) => j !== i) })} className="rounded p-1 text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        );
      })}
      <Btn size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => onChange({ ...v, rules: [...v.rules, { field: 'subject', operator: 'contains', value: '' }] })}>Add condition</Btn>
    </div>
  );
}

const ACTION_TYPES: Record<string, string> = {
  set_status: 'Set status', set_priority: 'Set priority', set_urgency: 'Set urgency', set_impact: 'Set impact', set_type: 'Set type',
  set_group: 'Assign to group', set_agent: 'Assign to agent', set_department: 'Set department', set_category: 'Set category',
  set_sub_category: 'Set sub-category', add_tag: 'Add tag', remove_tag: 'Remove tag', add_note: 'Add private note',
  notify_agent: 'Notify agent (in-app)', add_watcher: 'Add watcher', send_email: 'Send email',
};

export function ActionsEditor({ value, onChange, allowEmail = true }: { value: AutomationAction[]; onChange: (v: AutomationAction[]) => void; allowEmail?: boolean }) {
  const rows = value ?? [];
  const valueOptions = useValueOptions();
  const fieldFor: Record<string, string> = { set_status: 'status', set_priority: 'priority', set_urgency: 'urgency', set_impact: 'impact', set_type: 'type', set_group: 'group_id', set_agent: 'responder_id', set_department: 'department_id', notify_agent: 'responder_id', add_watcher: 'responder_id' };
  const update = (i: number, patch: Partial<AutomationAction>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const types = Object.entries(ACTION_TYPES).filter(([k]) => allowEmail || k !== 'send_email').map(([value, label]) => ({ value, label }));
  return (
    <div className="space-y-2">
      {rows.map((a, i) => {
        const opts = fieldFor[a.type] ? valueOptions(fieldFor[a.type]) : null;
        return (
          <div key={i} className="space-y-2 rounded-md border border-slate-200 bg-slate-50/60 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <SelectBox className="w-52" value={a.type} onChange={(t) => update(i, { type: t, value: '' })} options={types} />
              {a.type === 'send_email' ? (
                <SelectBox className="w-48" value={a.to ?? 'requester'} onChange={(t) => update(i, { to: t })} options={[{ value: 'requester', label: 'To requester' }, { value: 'agent', label: 'To assigned agent' }]} />
              ) : a.type === 'add_note' ? null : opts ? (
                <SelectBox className="min-w-[180px] flex-1" value={String(a.value ?? '')} onChange={(x) => update(i, { value: ['set_priority', 'set_urgency', 'set_impact'].includes(a.type) ? Number(x) : x })} placeholder="Select…" options={opts} />
              ) : (
                <TextInput className="min-w-[180px] flex-1" value={String(a.value ?? '')} onChange={(e) => update(i, { value: e.target.value })} placeholder="Value" />
              )}
              <button type="button" aria-label="Remove action" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="ml-auto rounded p-1 text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
            </div>
            {a.type === 'add_note' && <TextArea rows={2} value={String(a.value ?? '')} onChange={(e) => update(i, { value: e.target.value })} placeholder="Note text" />}
            {a.type === 'send_email' && (
              <>
                <TextInput value={a.subject ?? ''} onChange={(e) => update(i, { subject: e.target.value })} placeholder="Subject — placeholders like {{ticket.id}} work" />
                <TextArea rows={3} value={a.body ?? ''} onChange={(e) => update(i, { body: e.target.value })} placeholder="Body — {{ticket.requester_name}}, {{ticket.subject}}, {{ticket.url}}" />
              </>
            )}
          </div>
        );
      })}
      <Btn size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...rows, { type: 'set_group', value: '' }])}>Add action</Btn>
    </div>
  );
}

export function describeActions(actions: AutomationAction[]) {
  return (actions ?? []).map((a) => ACTION_TYPES[a.type] ?? a.type).join(', ');
}

export const PLACEHOLDER_HELP = '{{ticket.id}}, {{ticket.subject}}, {{ticket.status}}, {{ticket.priority}}, {{ticket.requester_name}}, {{ticket.group}}, {{ticket.url}}, {{ticket.portal_url}}, {{agent.name}}, {{helpdesk.name}}';
