'use client';

import * as React from 'react';
import { FieldSpec } from './crud';
import { CategoryPicker } from './forms';
import { useAgentOptions, useDepartmentOptions, useGroupOptions } from './pickers';
import { useChangeTypes, useChoiceOptions, useFormFields } from '@/lib/itsm/hooks';
import { CHANGE_STATUSES, CHANGE_TYPES, LEVELS, PRIORITIES, PROBLEM_STATUSES, RELEASE_STATUSES, RISKS, toLocalInput, fromLocalInput } from '@/lib/itsm/format';

const priorityOptions = PRIORITIES.map((p) => ({ value: String(p.value), label: p.label }));
const levelOptions = LEVELS.map((l) => ({ value: String(l.value), label: l.label }));
const riskOptions = RISKS.map((l) => ({ value: String(l.value), label: l.label }));

export function useOwnershipFields(): FieldSpec[] {
  const agents = useAgentOptions();
  const groups = useGroupOptions();
  const depts = useDepartmentOptions();
  return React.useMemo(
    () => [
      { name: 'group_id', label: 'Group', type: 'select', options: groups, span: 1 },
      { name: 'agent_id', label: 'Agent', type: 'select', options: agents, span: 1 },
      { name: 'department_id', label: 'Department', type: 'select', options: depts, span: 1 },
    ],
    [agents, groups, depts]
  );
}

const num = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : Number(v));
const iso = (v: unknown) => (v ? fromLocalInput(String(v)) : '');

type CategoryPath = { category: string; sub_category: string; item_category: string };
const emptyPath: CategoryPath = { category: '', sub_category: '', item_category: '' };

/** Category → sub-category → item and business impact, from Admin → Categories. */
function useClassificationFields(entity: 'problem' | 'change'): FieldSpec[] {
  const fields = useFormFields(entity);
  const impact = useChoiceOptions(entity, 'business_impact');
  return React.useMemo(
    () => [
      {
        name: 'category_path',
        label: 'Category',
        type: 'custom',
        render: (value, onChange) => (
          <CategoryPicker fields={fields.data} value={(value as CategoryPath) ?? emptyPath} onChange={(v) => onChange(v)} labels={['Category', 'Sub-category', 'Item']} />
        ),
      },
      ...(impact.length ? [{ name: 'business_impact', label: 'Business impact', type: 'select' as const, options: impact }] : []),
    ],
    [fields.data, impact]
  );
}

const pathOf = (r: Record<string, unknown>): CategoryPath => ({
  category: (r.category as string) ?? '',
  sub_category: (r.sub_category as string) ?? '',
  item_category: (r.item_category as string) ?? '',
});

/** Turns the category picker's value back into the API's three fields. */
function withPath(v: Record<string, unknown>): Record<string, unknown> {
  const { category_path, ...rest } = v;
  return category_path ? { ...rest, ...(category_path as CategoryPath) } : rest;
}

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

export function useProblemFields() {
  const own = useOwnershipFields();
  const classification = useClassificationFields('problem');
  const properties: FieldSpec[] = [
    { name: 'status', label: 'Status', type: 'select', options: PROBLEM_STATUSES, required: true },
    { name: 'priority', label: 'Priority', type: 'select', options: priorityOptions, required: true },
    { name: 'impact', label: 'Impact', type: 'select', options: levelOptions, required: true },
    ...own,
    ...classification,
    { name: 'due_by', label: 'Due by', type: 'datetime' },
    { name: 'known_error', label: 'Known error', type: 'toggle', description: 'Root cause identified and a workaround exists' },
    { name: 'tags', label: 'Tags', type: 'tags' },
  ];
  const sections = [
    { title: 'Problem', fields: [{ name: 'subject', label: 'Subject', required: true }, { name: 'description', label: 'Description', type: 'textarea', rows: 5 }] as FieldSpec[] },
    {
      title: 'Analysis',
      fields: [
        { name: 'root_cause', label: 'Root cause', type: 'textarea', rows: 3 },
        { name: 'impact_analysis', label: 'Impact', type: 'textarea', rows: 3 },
        { name: 'symptoms', label: 'Symptoms', type: 'textarea', rows: 3 },
        { name: 'workaround', label: 'Workaround', type: 'textarea', rows: 3 },
      ] as FieldSpec[],
    },
  ];
  return { properties, sections };
}

export function problemToForm(p: Record<string, unknown>): Record<string, unknown> {
  return {
    subject: p.subject, description: p.description, status: p.status, priority: String(p.priority), impact: String(p.impact),
    group_id: p.group_id ?? '', agent_id: p.agent_id ?? '', department_id: p.department_id ?? '', category_path: pathOf(p),
    business_impact: p.business_impact ?? '', due_by: toLocalInput(p.due_by as string), known_error: p.known_error, tags: p.tags ?? [], root_cause: p.root_cause ?? '',
    impact_analysis: p.impact_analysis ?? '', symptoms: p.symptoms ?? '', workaround: p.workaround ?? '',
  };
}

export function problemPayload(v: Record<string, unknown>) {
  return { ...withPath(v), priority: num(v.priority), impact: num(v.impact), due_by: iso(v.due_by) };
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

export function useChangeFields() {
  const own = useOwnershipFields();
  const classification = useClassificationFields('change');
  const changeTypes = useChangeTypes();
  const properties: FieldSpec[] = [
    { name: 'status', label: 'Status', type: 'select', options: CHANGE_STATUSES, required: true },
    { name: 'change_type', label: 'Change type', type: 'select', options: changeTypes.options, required: true },
    { name: 'priority', label: 'Priority', type: 'select', options: priorityOptions, required: true },
    { name: 'impact', label: 'Impact', type: 'select', options: levelOptions, required: true },
    { name: 'risk', label: 'Risk', type: 'select', options: riskOptions, required: true },
    ...own,
    ...classification,
    { name: 'planned_start', label: 'Planned start', type: 'datetime' },
    { name: 'planned_end', label: 'Planned end', type: 'datetime' },
    { name: 'tags', label: 'Tags', type: 'tags' },
  ];
  const sections = [
    { title: 'Change', fields: [{ name: 'subject', label: 'Subject', required: true }, { name: 'description', label: 'Description', type: 'textarea', rows: 5 }] as FieldSpec[] },
    {
      title: 'Planning',
      fields: [
        { name: 'reason', label: 'Reason for change', type: 'textarea', rows: 3 },
        { name: 'impact_plan', label: 'Impact', type: 'textarea', rows: 3 },
        { name: 'rollout_plan', label: 'Rollout plan', type: 'textarea', rows: 3 },
        { name: 'backout_plan', label: 'Backout plan', type: 'textarea', rows: 3 },
      ] as FieldSpec[],
    },
  ];
  return { properties, sections };
}

export function changeToForm(c: Record<string, unknown>): Record<string, unknown> {
  return {
    subject: c.subject, description: c.description, status: c.status, change_type: c.change_type, priority: String(c.priority),
    impact: String(c.impact), risk: String(c.risk), group_id: c.group_id ?? '', agent_id: c.agent_id ?? '', department_id: c.department_id ?? '',
    category_path: pathOf(c), business_impact: c.business_impact ?? '', planned_start: toLocalInput(c.planned_start as string), planned_end: toLocalInput(c.planned_end as string),
    tags: c.tags ?? [], reason: c.reason ?? '', impact_plan: c.impact_plan ?? '', rollout_plan: c.rollout_plan ?? '', backout_plan: c.backout_plan ?? '',
  };
}

export function changePayload(v: Record<string, unknown>) {
  return { ...withPath(v), priority: num(v.priority), impact: num(v.impact), risk: num(v.risk), planned_start: iso(v.planned_start), planned_end: iso(v.planned_end) };
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

export function useReleaseFields() {
  const own = useOwnershipFields();
  const properties: FieldSpec[] = [
    { name: 'status', label: 'Status', type: 'select', options: RELEASE_STATUSES, required: true },
    { name: 'release_type', label: 'Release type', type: 'select', options: CHANGE_TYPES, required: true },
    { name: 'priority', label: 'Priority', type: 'select', options: priorityOptions, required: true },
    ...own,
    { name: 'category', label: 'Category', type: 'text' },
    { name: 'planned_start', label: 'Planned start', type: 'datetime' },
    { name: 'planned_end', label: 'Planned end', type: 'datetime' },
    { name: 'work_start', label: 'Work start', type: 'datetime' },
    { name: 'work_end', label: 'Work end', type: 'datetime' },
    { name: 'tags', label: 'Tags', type: 'tags' },
  ];
  const sections = [
    { title: 'Release', fields: [{ name: 'subject', label: 'Subject', required: true }, { name: 'description', label: 'Description', type: 'textarea', rows: 5 }] as FieldSpec[] },
    {
      title: 'Planning',
      fields: [
        { name: 'build_plan', label: 'Build plan', type: 'textarea', rows: 4 },
        { name: 'test_plan', label: 'Test plan', type: 'textarea', rows: 4 },
      ] as FieldSpec[],
    },
  ];
  return { properties, sections };
}

export function releaseToForm(r: Record<string, unknown>): Record<string, unknown> {
  return {
    subject: r.subject, description: r.description, status: r.status, release_type: r.release_type, priority: String(r.priority),
    group_id: r.group_id ?? '', agent_id: r.agent_id ?? '', department_id: r.department_id ?? '', category: r.category ?? '',
    planned_start: toLocalInput(r.planned_start as string), planned_end: toLocalInput(r.planned_end as string),
    work_start: toLocalInput(r.work_start as string), work_end: toLocalInput(r.work_end as string), tags: r.tags ?? [],
    build_plan: r.build_plan ?? '', test_plan: r.test_plan ?? '',
  };
}

export function releasePayload(v: Record<string, unknown>) {
  return { ...v, priority: num(v.priority), planned_start: iso(v.planned_start), planned_end: iso(v.planned_end), work_start: iso(v.work_start), work_end: iso(v.work_end) };
}
