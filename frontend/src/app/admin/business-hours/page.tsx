'use client';

import { CrudPage } from '@/components/desk/crud';
import { Badge } from '@/components/desk/kit';
import { HolidaysEditor, WeekEditor } from '@/components/admin/editors';
import { TIME_ZONES, labelize } from '@/lib/itsm/format';
import type { BusinessHours, DaySpec } from '@/lib/itsm/types';

export default function BusinessHoursPage() {
  return (
    <CrudPage<BusinessHours>
      title="Business hours"
      subtitle="SLA timers only run during business hours when a target uses them. Assign calendars to groups."
      singular="Business hours"
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Business hours' }]}
      listPath="/business-hours"
      queryKey={['lookup', 'business-hours']}
      deletePath={(r) => (r.is_default ? null : `/business-hours/${r.id}`)}
      columns={[
        { label: 'Calendar', render: (r) => <div><div className="font-medium text-slate-900">{r.name} {r.is_default && <Badge className="ml-1 bg-blue-50 text-blue-700 ring-blue-600/20">Default</Badge>}</div><div className="text-xs text-slate-500">{r.description}</div></div> },
        { label: 'Time zone', render: (r) => r.time_zone },
        { label: 'Hours', render: (r) => (r.always_open ? '24 × 7' : Object.keys(r.working_hours ?? {}).map((d) => labelize(d).slice(0, 3)).join(', ') || '—') },
        { label: 'Holidays', render: (r) => (r.holidays ?? []).length },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true, span: 1 },
        { name: 'time_zone', label: 'Time zone', type: 'select', required: true, span: 1, options: TIME_ZONES.map((t) => ({ value: t, label: t })) },
        { name: 'description', label: 'Description' },
        { name: 'is_default', label: 'Default calendar', type: 'toggle', description: 'Used for groups without their own calendar' },
        { name: 'always_open', label: 'Open 24 hours, 7 days a week', type: 'toggle' },
        { name: 'working_hours', label: 'Working hours', type: 'custom', show: (v) => !v.always_open, render: (v, onChange) => <WeekEditor value={(v as Record<string, DaySpec[]>) ?? {}} onChange={onChange} /> },
        { name: 'holidays', label: 'Holidays', type: 'custom', render: (v, onChange) => <HolidaysEditor value={(v as { date: string; name: string }[]) ?? []} onChange={onChange} /> },
      ]}
      defaults={{ name: '', time_zone: 'UTC', description: '', is_default: false, always_open: false, working_hours: { monday: [{ start: '09:00', end: '18:00' }], tuesday: [{ start: '09:00', end: '18:00' }], wednesday: [{ start: '09:00', end: '18:00' }], thursday: [{ start: '09:00', end: '18:00' }], friday: [{ start: '09:00', end: '18:00' }] }, holidays: [] }}
      toForm={(r) => ({ name: r.name, time_zone: r.time_zone, description: r.description, is_default: r.is_default, always_open: r.always_open, working_hours: r.working_hours ?? {}, holidays: r.holidays ?? [] })}
      toPayload={(v) => ({ ...v, holidays: ((v.holidays as { date: string }[]) ?? []).filter((h) => h.date) })}
      drawerWidth="max-w-2xl"
    />
  );
}
