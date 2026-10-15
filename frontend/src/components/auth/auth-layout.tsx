import * as React from 'react';
import { BookOpen, LifeBuoy, ShieldCheck, Workflow } from 'lucide-react';

/** Two-column layout shared by sign-in and account recovery pages; styled per theme. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  const features = [
    { icon: Workflow, text: 'Incidents, service requests, problems, changes and releases in one place' },
    { icon: ShieldCheck, text: 'SLA policies, approvals and automation built in' },
    { icon: BookOpen, text: 'Self-service portal and knowledge base for your employees' },
  ];
  return (
    <div className="app-shell flex min-h-screen bg-white">
      <div className="auth-hero relative hidden w-[44%] flex-col justify-between overflow-hidden p-10 lg:flex">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)', backgroundSize: '24px 24px' }} />
        <div className="relative flex items-center gap-2.5">
          <span className="brand-mark flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
            <LifeBuoy className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold">TaskFlow Service Desk</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">IT service management that keeps every request moving.</h2>
          <ul className="auth-hero-text mt-8 space-y-3 text-sm">
            {features.map(({ icon: Icon, text }) => (
              <li key={text} className="auth-hero-chip flex items-start gap-3 rounded-2xl p-3.5">
                <Icon className="auth-hero-accent h-5 w-5 shrink-0" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="auth-hero-text relative text-xs opacity-70">© {new Date().getFullYear()} TaskFlow</p>
      </div>
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="auth-card page-enter w-full max-w-[26rem]">
          <h1 className="page-title text-2xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-center text-sm text-slate-500">{footer}</div>}
        </div>
      </div>
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
