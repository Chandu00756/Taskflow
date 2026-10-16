'use client';

import * as React from 'react';
import { CheckCircle2, CircleDot, Clock3, ShieldCheck, Sparkles, Timer } from 'lucide-react';
import { GradientWord, LogoMark } from '@/components/brand/logo';
import { cn } from '@/lib/utils';

/** True when the visitor asked the system for less motion. */
export function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Runs fn every ms while the tab is visible and motion is allowed. */
function useTicker(fn: () => void, ms: number, enabled: boolean) {
  const saved = React.useRef(fn);
  saved.current = fn;
  React.useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') saved.current();
    }, ms);
    return () => window.clearInterval(id);
  }, [ms, enabled]);
}

export const TAGLINE = 'Every request, in flow.';

/** Live logo (continuous loop), wordmark with a moving shine, and the tagline. */
export function AnimatedBrand({ size = 'lg', variant = 'hero' }: { size?: 'md' | 'lg'; variant?: 'hero' | 'card' }) {
  const hero = variant === 'hero';
  const reduced = useReducedMotion();
  return (
    <span className="tf-brand inline-flex items-center gap-3.5">
      <span className="relative">
        <span className="tf-brand-glow absolute -inset-2.5 rounded-[24px]" aria-hidden />
        <LogoMark size={size === 'lg' ? 52 : 42} animated={!reduced} title="TaskFlow" className="relative" />
      </span>
      <span className="leading-none">
        <span className="flex items-center gap-2">
          <span className={cn('font-bold tracking-tight', size === 'lg' ? 'text-[1.8rem]' : 'text-2xl', hero ? 'auth-hero-title' : 'text-slate-900')}>
            Task<GradientWord shine>Flow</GradientWord>
          </span>
          <span className={cn('rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.2em]', hero ? 'auth-hero-chip auth-hero-text' : 'bg-slate-100 text-slate-500')}>Service desk</span>
        </span>
        <span className={cn('mt-1.5 block text-sm font-medium italic', hero ? 'auth-hero-text' : 'text-slate-500')}>{TAGLINE}</span>
      </span>
    </span>
  );
}

const WORDS = ['moving.', 'on time.', 'approved.', 'resolved.'];

/** Headline whose last word rotates. */
export function RotatingHeadline() {
  const reduced = useReducedMotion();
  const [i, setI] = React.useState(0);
  useTicker(() => setI((x) => (x + 1) % WORDS.length), 2600, !reduced);
  return (
    <h2 className="text-4xl font-semibold leading-[1.1] tracking-tight xl:text-5xl">
      IT service management that keeps every request{' '}
      <span className="relative inline-block whitespace-nowrap align-bottom">
        <span key={i} className="tf-word auth-hero-accent inline-block">{WORDS[i]}</span>
      </span>
    </h2>
  );
}

type Status = 'open' | 'in_progress' | 'resolved';
type Row = { key: string; id: string; subject: string; priority: 'Urgent' | 'High' | 'Medium' | 'Low'; who: string; status: Status; fresh: boolean };

const POOL: Omit<Row, 'key' | 'status' | 'fresh'>[] = [
  { id: 'INC-1042', subject: 'VPN drops every 10 minutes', priority: 'High', who: 'MR' },
  { id: 'SR-311', subject: 'Laptop for new hire Ana', priority: 'Medium', who: 'AL' },
  { id: 'INC-1043', subject: 'Wi-Fi slow in Building B', priority: 'Urgent', who: 'JK' },
  { id: 'SR-312', subject: 'Access to Finance shared drive', priority: 'Low', who: 'PS' },
  { id: 'INC-1044', subject: 'Outlook keeps asking for password', priority: 'Medium', who: 'DN' },
  { id: 'SR-313', subject: 'Second monitor for home office', priority: 'Low', who: 'RT' },
  { id: 'INC-1045', subject: 'Printer on floor 3 jams', priority: 'High', who: 'EV' },
  { id: 'SR-314', subject: 'Adobe Acrobat licence', priority: 'Low', who: 'GH' },
];

const TOASTS = [
  { icon: CheckCircle2, tone: 'text-emerald-500', text: 'INC-1042 resolved · rated 5★' },
  { icon: ShieldCheck, tone: 'text-indigo-500', text: 'CHN-27 approved by the CAB' },
  { icon: Sparkles, tone: 'text-amber-500', text: 'KAIRV-12 moved to Done' },
  { icon: Timer, tone: 'text-sky-500', text: 'SR-311 delivered 2h ahead of SLA' },
];

const PRIORITY: Record<Row['priority'], string> = {
  Urgent: 'bg-rose-500',
  High: 'bg-orange-400',
  Medium: 'bg-sky-400',
  Low: 'bg-slate-300',
};

const STATUS: Record<Status, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-blue-50 text-blue-700 ring-blue-600/20' },
  in_progress: { label: 'In progress', cls: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  resolved: { label: 'Resolved', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
};

/** A small, self-running service desk: tickets arrive and move to resolved. */
export function LivePreview() {
  const reduced = useReducedMotion();
  const next = React.useRef(4);
  const seq = React.useRef(0);
  const [rows, setRows] = React.useState<Row[]>(() =>
    POOL.slice(0, 4).map((t, i) => ({ ...t, key: `${t.id}-0`, status: (['in_progress', 'open', 'open', 'resolved'] as Status[])[i], fresh: false }))
  );
  const [kpi, setKpi] = React.useState({ open: 24, sla: 98.6, frt: 11 });
  const [toast, setToast] = React.useState(0);
  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;
  const tick = React.useRef(0);

  useTicker(() => {
    const cur = rowsRef.current.map((r) => ({ ...r, fresh: false }));
    tick.current += 1;
    if (tick.current % 2 === 1) {
      // A new ticket arrives at the top.
      const t = POOL[next.current % POOL.length];
      next.current += 1;
      seq.current += 1;
      setRows([{ ...t, key: `${t.id}-${seq.current}`, status: 'open' as Status, fresh: true }, ...cur].slice(0, 4));
      setKpi((k) => ({ ...k, open: k.open + 1 }));
      return;
    }
    // Someone moves the oldest open ticket forward.
    let idx = -1;
    for (let i = cur.length - 1; i >= 0; i--) {
      if (cur[i].status !== 'resolved') {
        idx = i;
        break;
      }
    }
    if (idx < 0) return setRows(cur);
    const r = cur[idx];
    cur[idx] = { ...r, status: r.status === 'open' ? 'in_progress' : 'resolved' };
    setRows(cur);
    if (r.status === 'in_progress') {
      setKpi((k) => ({ open: Math.max(12, k.open - 1), sla: Math.min(99.4, +(k.sla + 0.1).toFixed(1)), frt: Math.max(8, k.frt - 1) }));
    }
  }, 2400, !reduced);
  useTicker(() => setToast((x) => (x + 1) % TOASTS.length), 3600, !reduced);

  const T = TOASTS[toast];
  return (
    <div className="tf-tilt relative" aria-hidden>
      <div className="auth-preview tf-float relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_30px_80px_-30px_rgba(15,23,42,0.45)] backdrop-blur">
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="ml-3 text-xs font-medium text-slate-500">Service desk · Today</span>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
            <span className="tf-live h-2 w-2 rounded-full bg-emerald-500" /> Live
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 px-4 pt-3">
          {[
            { label: 'Open tickets', value: String(kpi.open), icon: CircleDot },
            { label: 'SLA met', value: `${kpi.sla.toFixed(1)}%`, icon: ShieldCheck },
            { label: 'First response', value: `${kpi.frt}m`, icon: Clock3 },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
              <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                <k.icon className="h-3 w-3" /> {k.label}
              </div>
              <div key={k.value} className="tf-number mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{k.value}</div>
            </div>
          ))}
        </div>
        <ul className="space-y-1.5 px-4 py-3">
          {rows.map((r) => (
            <li key={r.key} className={cn('flex items-center gap-2.5 rounded-xl border border-slate-100 bg-white px-3 py-2', r.fresh && 'tf-row-in')}>
              <span className={cn('h-2 w-2 shrink-0 rounded-full', PRIORITY[r.priority])} title={r.priority} />
              <span className="w-[4.6rem] shrink-0 font-mono text-[11px] text-slate-500">{r.id}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">{r.subject}</span>
              <span key={r.status} className={cn('tf-pop shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ring-1 ring-inset', STATUS[r.status].cls)}>
                {r.status === 'resolved' && '✓ '}
                {STATUS[r.status].label}
              </span>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-sky-500 text-[10px] font-semibold text-white">{r.who}</span>
            </li>
          ))}
        </ul>
      </div>
      <div key={toast} className="tf-toast absolute -bottom-5 -right-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xl sm:-right-6">
        <T.icon className={cn('h-4 w-4', T.tone)} />
        {T.text}
      </div>
    </div>
  );
}

// Page coordinates (1440x900): curves run through the gap between the live
// preview and the sign-in card, and behind the card.
const STREAMS = [
  'M560 940 C 640 760, 650 600, 770 470 S 1000 250, 1500 190',
  'M610 -40 C 650 130, 710 260, 830 360 S 1110 520, 1500 560',
  'M470 940 C 620 840, 760 770, 900 710 S 1200 650, 1500 710',
  'M720 -40 C 730 160, 810 300, 910 330 S 1160 300, 1500 360',
  'M-60 900 C 260 930, 520 880, 700 760 S 960 600, 1500 470',
];

const CHIPS = [
  { label: 'INC-1046', color: '#f43f5e', path: 0, dur: 5.2, begin: 0 },
  { label: 'SR-315', color: '#0ea5e9', path: 1, dur: 5.8, begin: 1.6 },
  { label: 'CHN-28', color: '#8b5cf6', path: 4, dur: 6.2, begin: 3.1 },
  { label: 'PRB-9', color: '#f59e0b', path: 3, dur: 5.5, begin: 4.3 },
  { label: 'KAIRV-13', color: '#10b981', path: 2, dur: 6, begin: 2.2 },
];

/** Work flowing in: glowing streams, particles and ticket chips riding curves behind the preview. */
export function FlowLines() {
  const reduced = useReducedMotion();
  const uid = React.useId().replace(/:/g, '');
  const id = (n: string) => `tf-${n}-${uid}`;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={id('stroke')} x1="400" y1="0" x2="1440" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="0.5" stopColor="#0ea5e9" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
        <filter id={id('glow')} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {STREAMS.map((d, i) => (
          <path key={i} id={id(`p${i}`)} d={d} />
        ))}
      </defs>
      {STREAMS.map((d, i) => (
        <g key={i}>
          <path d={d} fill="none" stroke={`url(#${id('stroke')})`} strokeOpacity="0.35" strokeWidth="1.75" />
          {!reduced && (
            <>
              <path d={d} pathLength={100} fill="none" stroke={`url(#${id('stroke')})`} strokeWidth="3.5" strokeLinecap="round" filter={`url(#${id('glow')})`} className="tf-stream" style={{ animationDelay: `${i * 0.4}s`, animationDuration: `${1.8 + (i % 3) * 0.4}s` }} />
              {[0, 1].map((k) => (
                <circle key={k} r={k ? 2.5 : 3.5} fill="#fff" filter={`url(#${id('glow')})`} opacity="0.9">
                  <animateMotion dur={`${2.4 + i * 0.3 + k * 0.8}s`} begin={`${i * 0.5 + k * 1.1}s`} repeatCount="indefinite" rotate="auto">
                    <mpath href={`#${id(`p${i}`)}`} />
                  </animateMotion>
                </circle>
              ))}
            </>
          )}
        </g>
      ))}
      {!reduced &&
        CHIPS.map((c) => (
          <g key={c.label} opacity="0">
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.82;1" dur={`${c.dur}s`} begin={`${c.begin}s`} repeatCount="indefinite" />
            <animateMotion dur={`${c.dur}s`} begin={`${c.begin}s`} repeatCount="indefinite">
              <mpath href={`#${id(`p${c.path}`)}`} />
            </animateMotion>
            <rect x="-34" y="-12" width="68" height="24" rx="12" fill="#fff" stroke={c.color} strokeOpacity="0.35" filter={`url(#${id('glow')})`} />
            <circle cx="-22" cy="0" r="4" fill={c.color} />
            <text x="-14" y="4" fontSize="11" fontWeight="600" fill="#334155" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {c.label}
            </text>
          </g>
        ))}
    </svg>
  );
}
