'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, LifeBuoy, LogOut, Menu as MenuIcon, UserRound, X, FolderKanban } from 'lucide-react';
import { ThemeSwatches } from '@/components/theme/theme-picker';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { useMe } from '@/lib/itsm/hooks';
import { v2, parseApiError } from '@/lib/itsm/api';
import { Avatar, ConfirmProvider, Menu, MenuItem } from '@/components/desk/kit';
import { FullPageSpinner, GlobalSearch, NotificationBell } from '@/components/desk/shell';
import { signOutState, useHydrated, useIdleLogout, useSignOut } from '@/components/desk/session';

export function PortalShell({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  const me = useMe();
  const signOut = useSignOut();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const approvals = useQuery({
    queryKey: ['approvals', 'mine', 'requested'],
    queryFn: () => v2.items<{ id: string }>('/approvals', { status: 'requested' }),
    enabled: !!me.data,
    refetchInterval: 60_000,
  });

  React.useEffect(() => {
    if (!hydrated) return;
    if (!isAuthenticated) {
      if (!signOutState.active) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
    else if (isSuperAdmin) router.replace('/admin/global');
    else if (me.data?.user.must_change_password) router.replace('/change-password');
  }, [hydrated, isAuthenticated, isSuperAdmin, me.data, router, pathname]);
  React.useEffect(() => setMobileOpen(false), [pathname]);
  useIdleLogout(me.data?.settings.session_timeout_minutes);

  if (!hydrated || !isAuthenticated || isSuperAdmin) return <FullPageSpinner />;
  if (me.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-slate-600">
        <div>
          <p>{parseApiError(me.error).message}</p>
          <button onClick={() => signOut()} className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white">Sign in again</button>
        </div>
      </div>
    );
  }
  if (!me.data) return <FullPageSpinner />;
  const s = me.data.settings;
  const color = s.primary_color || '#2563eb';
  const pending = approvals.data?.length ?? 0;
  const nav = [
    { href: '/portal', label: 'Home', exact: true },
    { href: '/portal/new', label: 'Report an issue' },
    { href: '/portal/catalog', label: 'Request a service' },
    { href: '/portal/solutions', label: 'Knowledge base' },
    { href: '/portal/tickets', label: 'My tickets' },
    ...(pending > 0 || pathname.startsWith('/portal/approvals') ? [{ href: '/portal/approvals', label: `Approvals${pending ? ` (${pending})` : ''}` }] : []),
  ];
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(href + '/'));

  return (
    <ConfirmProvider>
      <div className="app-shell flex min-h-screen flex-col bg-slate-50">
        <header className="app-topbar sticky top-0 z-30 border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
            <Link href="/portal" className="flex shrink-0 items-center gap-2.5">
              {s.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.logo_url} alt="" className="h-8 w-8 rounded-md object-contain" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-md text-white" style={{ background: color }}>
                  <LifeBuoy className="h-4 w-4" />
                </span>
              )}
              <span className="hidden text-base font-semibold text-slate-900 sm:block">{s.portal_name}</span>
            </Link>
            <nav className="hidden flex-1 items-center gap-1 lg:flex">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn('rounded-md px-3 py-2 text-sm font-medium', isActive(n.href, n.exact) ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:text-slate-900')}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-1">
              <NotificationBell portal />
              <Menu
                className="w-72"
                trigger={() => (
                  <button className="flex items-center gap-2 rounded-md p-1 hover:bg-slate-100" aria-label="Account menu">
                    <Avatar name={me.data.user.name} src={me.data.user.avatar_url} size="sm" />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <div className="border-b border-slate-100 px-3 py-2.5">
                      <div className="text-sm font-semibold text-slate-900">{me.data.user.name}</div>
                      <div className="text-xs text-slate-500">{me.data.user.email}</div>
                    </div>
                    <div className="border-b border-slate-100 px-3 py-2.5">
                      <div className="mb-1.5 text-xs font-medium text-slate-500">Theme</div>
                      <ThemeSwatches />
                    </div>
                    <MenuItem href="/profile" onClick={close} icon={<UserRound className="h-4 w-4" />}>Profile & security</MenuItem>
                    {me.data.is_agent && (
                      <>
                        <MenuItem href="/dashboard" onClick={close} icon={<LayoutDashboard className="h-4 w-4" />}>Agent workspace</MenuItem>
                        <MenuItem href="/projects" onClick={close} icon={<FolderKanban className="h-4 w-4" />}>Projects</MenuItem>
                      </>
                    )}
                    <div className="my-1 border-t border-slate-100" />
                    <MenuItem danger onClick={() => { close(); signOut(); }} icon={<LogOut className="h-4 w-4" />}>Sign out</MenuItem>
                  </>
                )}
              </Menu>
              <button className="rounded-md p-2 text-slate-600 lg:hidden" onClick={() => setMobileOpen((v) => !v)} aria-label="Toggle menu">
                {mobileOpen ? <X className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
              </button>
            </div>
          </div>
          {mobileOpen && (
            <nav className="border-t border-slate-100 px-4 py-2 lg:hidden">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className={cn('block rounded-md px-3 py-2 text-sm', isActive(n.href, n.exact) ? 'bg-slate-100 font-medium' : 'text-slate-600')}>
                  {n.label}
                </Link>
              ))}
            </nav>
          )}
        </header>
        <main key={pathname} className="page-enter mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
          {s.helpdesk_name} · Powered by TaskFlow Service Desk
        </footer>
      </div>
    </ConfirmProvider>
  );
}

export function PortalSearch() {
  return <GlobalSearch portal />;
}
