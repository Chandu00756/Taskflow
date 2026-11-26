'use client';

import * as React from 'react';

export interface SignupDay {
  day: string;
  verified: number;
  unverified: number;
}

// Categorical slots 1 and 2 of the validated reference palette (blue, orange),
// with their dark-surface steps.
const SERIES = [
  { key: 'verified' as const, label: 'Verified', fill: 'fill-[#257de0] dark:fill-[#338ced]', swatch: 'bg-[#257de0] dark:bg-[#338ced]' },
  { key: 'unverified' as const, label: 'Never verified', fill: 'fill-[#f47230] dark:fill-[#e76624]', swatch: 'bg-[#f47230] dark:bg-[#e76624]' },
];

const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Stacked daily sign-ups for the last 30 days: verified vs never verified. */
export function SignupsChart({ days }: { days: SignupDay[] }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const [table, setTable] = React.useState(false);
  const W = 720;
  const H = 200;
  const padL = 32;
  const padB = 22;
  const plotH = H - padB - 8;
  const max = Math.max(4, ...days.map((d) => d.verified + d.unverified));
  const nice = Math.ceil(max / 4) * 4;
  const slot = (W - padL) / Math.max(days.length, 1);
  const bw = Math.max(4, slot - 6);
  const y = (v: number) => (v / nice) * plotH;
  const ticks = [0, nice / 2, nice];
  const totals = days.reduce((a, d) => ({ v: a.v + d.verified, u: a.u + d.unverified }), { v: 0, u: 0 });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
        <div className="flex items-center gap-4">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-sm ${s.swatch}`} />
              {s.label} ({s.key === 'verified' ? totals.v : totals.u})
            </span>
          ))}
        </div>
        <button type="button" onClick={() => setTable((t) => !t)} className="font-medium text-blue-600 hover:text-blue-700">
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <div className="max-h-64 overflow-auto rounded border border-slate-200">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
              <tr><th className="px-2 py-1">Day</th><th className="px-2 py-1 text-right">Verified</th><th className="px-2 py-1 text-right">Never verified</th></tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.day} className="border-t border-slate-100">
                  <td className="px-2 py-1">{fmtDay(d.day)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{d.verified}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{d.unverified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Daily sign-ups for the last 30 days, verified and never verified">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W} y1={8 + plotH - y(t)} y2={8 + plotH - y(t)} className="stroke-slate-200" strokeWidth={1} />
                <text x={padL - 6} y={8 + plotH - y(t) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{t}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const x = padL + i * slot + (slot - bw) / 2;
              const hv = y(d.verified);
              const hu = y(d.unverified);
              const base = 8 + plotH;
              const gap = hv > 0 && hu > 0 ? 2 : 0;
              return (
                <g key={d.day} opacity={hover === null || hover === i ? 1 : 0.45}>
                  {hv > 0 && <rect x={x} y={base - hv} width={bw} height={hv} rx={Math.min(4, bw / 2)} className={SERIES[0].fill} />}
                  {hu > 0 && <rect x={x} y={base - hv - gap - hu} width={bw} height={hu} rx={Math.min(4, bw / 2)} className={SERIES[1].fill} />}
                  <rect x={padL + i * slot} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
                  {(i % 7 === 0 || i === days.length - 1) && (
                    <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="fill-slate-400 text-[10px]">{fmtDay(d.day)}</text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover !== null && days[hover] && (
            <div
              className="pointer-events-none absolute top-0 z-10 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-lg"
              style={{ left: `${Math.min(80, ((padL + hover * slot) / W) * 100)}%` }}
            >
              <div className="mb-0.5 font-semibold text-slate-900">{fmtDay(days[hover].day)}</div>
              {SERIES.map((s) => (
                <div key={s.key} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-sm ${s.swatch}`} />
                  {s.label}: <span className="tabular-nums">{days[hover][s.key]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
