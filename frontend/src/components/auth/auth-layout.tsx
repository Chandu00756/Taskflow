'use client';

import * as React from 'react';
import { GradientWord } from '@/components/brand/logo';
import { AnimatedBrand, FlowLines, LivePreview, RotatingHeadline } from './auth-hero';

const HIGHLIGHTS = ['SLA timers', 'CAB approvals', 'Project boards', 'Self-service portal', 'Email notifications'];

/** Sign-in and account recovery layout: a live product hero beside the form; styled per theme. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  // The preview tilts toward the pointer (CSS ignores it when motion is reduced).
  const onMove = (e: React.MouseEvent) => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--tf-mx', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    el.style.setProperty('--tf-my', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  };
  return (
    <div ref={rootRef} onMouseMove={onMove} className="app-shell relative flex min-h-screen overflow-hidden bg-white">
      <div className="tf-aurora pointer-events-none absolute inset-0" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <section className="auth-hero relative hidden w-[54%] flex-col overflow-hidden px-12 py-10 lg:flex xl:px-16">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)', backgroundSize: '24px 24px' }} />
        <div className="relative z-[2]">
          <AnimatedBrand />
        </div>
        <div className="relative z-[2] mt-12 max-w-xl">
          <RotatingHeadline />
          <p className="auth-hero-text mt-4 max-w-lg text-base leading-relaxed">
            Incidents, requests, problems, changes and projects in one place, with SLAs, approvals and automation that keep work flowing.
          </p>
        </div>
        <div className="relative z-[2] mt-10 max-w-xl flex-1" style={{ perspective: '1200px' }}>
          <LivePreview />
        </div>
        <div className="relative z-[2] mt-12 flex flex-wrap gap-2">
          {HIGHLIGHTS.map((h) => (
            <span key={h} className="auth-hero-chip auth-hero-text rounded-full px-3 py-1 text-xs font-medium">
              {h}
            </span>
          ))}
        </div>
        <p className="auth-hero-text relative z-[2] mt-6 text-xs opacity-70">© {new Date().getFullYear()} TaskFlow</p>
      </section>
      {/* Work flowing through the page: over the hero background, under the content. */}
      <div className="pointer-events-none absolute inset-0 z-[1] hidden lg:block">
        <FlowLines />
      </div>
      <main className="relative z-[2] flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[27rem]">
          <div className="mb-8 flex justify-center lg:hidden">
            <AnimatedBrand size="md" variant="card" />
          </div>
          <div className="auth-card page-enter">
            <h1 className="page-title text-2xl font-semibold text-slate-900">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-8 text-center text-sm text-slate-500">{footer}</div>}
          </div>
          <p className="mt-7 text-center text-sm font-medium text-slate-500">
            From the first ticket to the final fix, <GradientWord shine>in one flow.</GradientWord>
          </p>
        </div>
      </main>
    </div>
  );
}

export function PasswordRules({ password, minLength = 8, upper, number, special }: { password: string; minLength?: number; upper?: boolean; number?: boolean; special?: boolean }) {
  const rules = [
    { ok: password.length >= minLength, label: `At least ${minLength} characters` },
    ...(upper ? [{ ok: /[A-Z]/.test(password), label: 'An uppercase letter' }] : []),
    ...(number ? [{ ok: /\d/.test(password), label: 'A number' }] : []),
    ...(special ? [{ ok: /[^A-Za-z0-9\s]/.test(password), label: 'A special character' }] : []),
  ];
  return (
    <ul className="mt-2 space-y-0.5 text-xs">
      {rules.map((r) => (
        <li key={r.label} className={r.ok ? 'text-emerald-600' : 'text-slate-500'}>
          {r.ok ? '✓' : '•'} {r.label}
        </li>
      ))}
    </ul>
  );
}

export function passwordValid(password: string, opts: { minLength?: number; upper?: boolean; number?: boolean; special?: boolean }) {
  return (
    password.length >= (opts.minLength ?? 8) &&
    (!opts.upper || /[A-Z]/.test(password)) &&
    (!opts.number || /\d/.test(password)) &&
    (!opts.special || /[^A-Za-z0-9\s]/.test(password))
  );
}
