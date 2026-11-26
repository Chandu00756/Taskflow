'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, Building2, Gauge, KeyRound, LogOut, Mail, Menu, ShieldCheck, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth';
import { signOutState, useHydrated, useIdleLogout, useSignOut } from '@/components/desk/session';
import { Card, ConfirmProvider } from '@/components/desk/kit';
import { FullPageSpinner } from '@/components/desk/shell';
import { AccountsSection, HealthSection, OrganizationsSection, OverviewSection, SecuritySection } from '@/components/platform/console';
import { EmailDeliveryPanel } from '@/components/admin/email-delivery';
import { PasskeysCard, useAccountSecurity } from '@/components/profile/passkeys';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: Gauge, title: 'Platform overview', subtitle: 'Everything running on TaskFlow, measured live.' },
  { id: 'accounts', label: 'Account review', icon: Users, title: 'Account review', subtitle: 'Find and remove fake sign-ups; manage any account.' },
  { id: 'organizations', label: 'Organizations', icon: Building2, title: 'Organizations', subtitle: 'Every workspace on the platform.' },
  { id: 'security', label: 'Security', icon: ShieldCheck, title: 'Security', subtitle: 'Protection settings and what happened, platform-wide.' },
  { id: 'email', label: 'Email delivery', icon: Mail, title: 'Email delivery', subtitle: 'Outgoing mail settings, test sends and failures.' },
  { id: 'health', label: 'Health', icon: Activity, title: 'Health', subtitle: 'Live measurements of the service and its database.' },
  { id: 'me', label: 'My passkeys', icon: KeyRound, title: 'My sign-in security', subtitle: 'Passkeys and recovery codes for your super admin account.' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

function Console() {
  const router = useRouter();
  const sp = useSearchParams();
  const hydrated = useHydrated();
  const signOut = useSignOut();
  // Super admin sessions end sooner when left alone.
  useIdleLogout(15);
  const { user, isAuthenticated, isSuperAdmin, actualRole } = useAuthStore();
  const allowed = hydrated && isAuthenticated && (isSuperAdmin || actualRole === 'super_admin');
  const initial = (sp.get('s') as SectionId) || 'overview';
  const [section, setSectionState] = React.useState<SectionId>(SECTIONS.some((s) => s.id === initial) ? initial : 'overview');
  const [filter, setFilter] = React.useState(sp.get('filter') ?? 'suspicious');
  const [orgFilter, setOrgFilter] = React.useState<{ id: string; name: string } | null>(null);
  const [navOpen, setNavOpen] = React.useState(false);
  const security = useAccountSecurity();

  React.useEffect(() => {
    if (!hydrated) return;
    if (!isAuthenticated) {
      if (!signOutState.active) router.replace('/login?next=%2Fadmin%2Fglobal');
      return;
    }
    if (!isSuperAdmin && actualRole !== 'super_admin') {
      toast.error('This console is for platform administrators.');
      router.replace('/dashboard');
    }
  }, [hydrated, isAuthenticated, isSuperAdmin, actualRole, router]);

  const go = React.useCallback((id: string, f?: string) => {
    setSectionState(id as SectionId);
    if (f !== undefined) setFilter(f);
    setNavOpen(false);
    const params = new URLSearchParams({ s: id });
    if (id === 'accounts' && f) params.set('filter', f);
    window.history.replaceState(null, '', `/admin/global?${params}`);
  }, []);

  if (!allowed) return <FullPageSpinner />;
  const meta = SECTIONS.find((s) => s.id === section)!;
  const noPasskey = security.data && security.data.passkeys.length === 0;

  const nav = (
    <nav className="space-y-0.5">
      {SECTIONS.map((s) => (
        <button key={s.id} type="button" onClick={() => go(s.id)}
          className={cn('flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition',
            section === s.id ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
          <s.icon className="h-4 w-4" /> {s.label}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-slate-900 px-3 py-4 transition-transform lg:static lg:translate-x-0', navOpen ? 'translate-x-0' : '-translate-x-full')}>
        <div className="mb-6 flex items-center justify-between px-3">
          <div>
            <div className="text-sm font-semibold text-white">TaskFlow</div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Platform console</div>
          </div>
          <button type="button" className="text-slate-400 lg:hidden" onClick={() => setNavOpen(false)} aria-label="Close menu"><X className="h-4 w-4" /></button>
        </div>
        {nav}
        <div className="mt-auto border-t border-white/10 px-3 pt-4">
          <div className="truncate text-xs text-slate-300">{user?.email}</div>
          <div className="mb-3 text-[11px] text-slate-500">Super admin</div>
          <button type="button" onClick={() => signOut()} className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setNavOpen(false)} />}
      <main className="min-w-0 flex-1">
        <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button type="button" className="text-slate-500 lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">{meta.title}</h1>
              <p className="text-sm text-slate-500">{meta.subtitle}</p>
            </div>
          </div>
        </header>
        <div className="space-y-5 px-4 py-5 sm:px-6">
          {noPasskey && section !== 'me' && (
            <div className="flex flex-col gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 sm:flex-row sm:items-center sm:justify-between">
              <span><b>Your super admin account has no passkey.</b> Add one now so a stolen password can never open this console.</span>
              <button type="button" onClick={() => go('me')} className="font-semibold underline">Add a passkey</button>
            </div>
          )}
          {section === 'overview' && <OverviewSection go={go} />}
          {section === 'accounts' && <AccountsSection filter={filter} setFilter={(f) => go('accounts', f)} orgFilter={orgFilter} clearOrg={() => setOrgFilter(null)} />}
          {section === 'organizations' && <OrganizationsSection showMembers={(o) => { setOrgFilter(o); go('accounts', ''); }} />}
          {section === 'security' && <SecuritySection />}
          {section === 'email' && <EmailDeliveryPanel defaultTo={user?.email} />}
          {section === 'health' && <HealthSection />}
          {section === 'me' && (
            <div className="max-w-2xl">
              <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-slate-400" />Passkeys</span>}>
                <PasskeysCard />
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function GlobalAdminPage() {
  return (
    <ConfirmProvider>
      <React.Suspense fallback={<FullPageSpinner />}>
        <Console />
      </React.Suspense>
    </ConfirmProvider>
  );
}
