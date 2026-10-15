'use client';

import * as React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from 'recharts';
import { useTheme } from '@/lib/theme';

// Validated reference palette (see dataviz skill): categorical slots 1 and 2.
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];

/** Grid, axis and tooltip colors that suit the active theme (data colors stay fixed). */
function useChartChrome() {
  const [theme] = useTheme();
  if (theme === 'dark') {
    return {
      grid: '#1e293b',
      axis: '#94a3b8',
      cursor: '#475569',
      dot: '#0f172a',
      tooltip: { borderRadius: 8, border: '1px solid #273449', background: '#0f172a', color: '#e2e8f0', fontSize: 12 },
    };
  }
  const warm = theme === 'crimson';
  return {
    grid: warm ? '#e7e5e4' : '#e2e8f0',
    axis: warm ? '#78716c' : '#64748b',
    cursor: '#94a3b8',
    dot: '#fff',
    tooltip: { borderRadius: 8, border: `1px solid ${warm ? '#e7e5e4' : '#e2e8f0'}`, background: '#fff', fontSize: 12, boxShadow: '0 4px 12px rgba(15,23,42,0.08)' },
  };
}

function fmtDay(d: string) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Created vs resolved trend: two series, legend + crosshair tooltip. */
export function TrendChart({ data, height = 240 }: { data: { day: string; created: number; resolved: number }[]; height?: number }) {
  const c = useChartChrome();
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-slate-600" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: SERIES[0] }} /> Created
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: SERIES[1] }} /> Resolved
        </span>
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="g-created" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.18} />
                <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fill: c.axis, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis allowDecimals={false} tick={{ fill: c.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
            <Tooltip labelFormatter={(l) => fmtDay(String(l))} contentStyle={c.tooltip} cursor={{ stroke: c.cursor, strokeWidth: 1 }} />
            <Area isAnimationActive={false} type="monotone" dataKey="created" name="Created" stroke={SERIES[0]} strokeWidth={2} fill="url(#g-created)" activeDot={{ r: 4, strokeWidth: 2, stroke: c.dot }} />
            <Area isAnimationActive={false} type="monotone" dataKey="resolved" name="Resolved" stroke={SERIES[1]} strokeWidth={2} fill="transparent" activeDot={{ r: 4, strokeWidth: 2, stroke: c.dot }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Horizontal magnitude bars with direct labels (single hue). */
export function BarList({ items, onSelect, empty = 'No data in this period' }: { items: { key: string; label: string; value: number }[]; onSelect?: (key: string) => void; empty?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="py-6 text-center text-sm text-slate-400">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.key}>
          <button
            type="button"
            disabled={!onSelect}
            onClick={() => onSelect?.(it.key)}
            title={`${it.label}: ${it.value}`}
            className="group w-full text-left disabled:cursor-default"
          >
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="truncate text-slate-700 group-hover:text-blue-700">{it.label || '—'}</span>
              <span className="font-medium tabular-nums text-slate-900">{it.value}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full transition-all" style={{ width: `${(it.value / max) * 100}%`, background: SERIES[0] }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars for a single series over time. */
export function ColumnChart({ data, xKey, yKey, label, height = 220, format }: { data: Record<string, unknown>[]; xKey: string; yKey: string; label: string; height?: number; format?: (v: string) => string }) {
  const c = useChartChrome();
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={format} tick={{ fill: c.axis, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis allowDecimals={false} tick={{ fill: c.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip labelFormatter={(l) => (format ? format(String(l)) : String(l))} contentStyle={c.tooltip} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
          <Bar isAnimationActive={false} dataKey={yKey} name={label} fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export { fmtDay };
