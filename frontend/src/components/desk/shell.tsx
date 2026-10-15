'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon, Bell, BookOpen, Boxes, CheckSquare, ChevronsLeft, ChevronsRight, ClipboardCheck, FolderKanban, GitBranch,
  HelpCircle, LayoutDashboard, LifeBuoy, LogOut, PieChart, Plus, Rocket, Search, Settings, Ticket, UserRound, Inbox, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { useMe } from '@/lib/itsm/hooks';
import { v2, parseApiError } from '@/lib/itsm/api';
import { ThemeSwatches } from '@/components/theme/theme-picker';
import type { AppNotification, SearchResult } from '@/lib/itsm/types';
import { timeAgo } from '@/lib/itsm/format';
import { Avatar, ConfirmProvider, LoadingBlock, Menu, MenuItem, Toggle, useClickOutside } from './kit';
import { useDebounced } from './pickers';
import { signOutState, useHydrated, useIdleLogout, useSignOut } from './session';

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  privilege?: string;
  agentOnly?: boolean;
  match?: string[];
  badge?: number;
}

export function DeskShell({ children, requireAgent = true }: { children: React.ReactNode; requireAgent?: boolean }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  const me = useMe();

  React.useEffect(() => {
    if (!hydrated) return;
    if (!isAuthenticated) {
      if (!signOutState.active) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (isSuperAdmin) {
      router.replace('/admin/global');
    } else if (me.data && !me.data.is_agent && requireAgent) {
      router.replace('/portal');
    } else if (me.data?.user.must_change_password && pathname !== '/change-password') {
      router.replace('/change-password');
    }
  }, [hydrated, isAuthenticated, isSuperAdmin, me.data, requireAgent, router, pathname]);

  useIdleLogout(me.data?.settings.session_timeout_minutes);

  if (!hydrated || !isAuthenticated || isSuperAdmin) return <FullPageSpinner />;
  if (me.isError) {
    const err = parseApiError(me.error);
    return <AccountProblem message={err.message} />;
  }
  if (!me.data || (requireAgent && !me.data.is_agent)) return <FullPageSpinner />;

  return (
    <ConfirmProvider>
      <ShellFrame>{children}</ShellFrame>
    </ConfirmProvider>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <LoadingBlock label="Loading your workspace…" />
    </div>
  );
}

function AccountProblem({ message }: { message: string }) {
  const signOut = useSignOut();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <AlertOctagon className="mx-auto h-10 w-10 text-amber-500" />
        <h1 className="mt-3 text-lg font-semibold text-slate-900">We couldn&apos;t open your workspace</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <button onClick={() => signOut()} className="mt-5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          Sign in again
        </button>
      </div>
    </div>
  );
}

function ShellFrame({ children }: { children: React.ReactNode }) {
  const { data: me } = useMe();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    setCollapsed(localStorage.getItem('desk-nav-collapsed') === '1');
  }, []);
  const toggle = () => {
    setCollapsed((v) => {
      localStorage.setItem('desk-nav-collapsed', v ? '0' : '1');
      return !v;
    });
  };
  const approvals = useQuery({
    queryKey: ['approvals', 'mine', 'requested'],
    queryFn: () => v2.items<{ id: string }>('/approvals', { status: 'requested' }),
    refetchInterval: 60_000,
    enabled: !!me,
  });
  if (!me) return null;
  const can = (p?: string) => !p || me.is_account_admin || me.privileges.includes(p);
  const isAgent = me.is_agent;
  const admin = me.is_account_admin || ['users.manage', 'settings.manage', 'catalog.manage', 'announcements.manage'].some((p) => me.privileges.includes(p));

  const nav: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, agentOnly: true },
    { href: '/tickets', label: 'Tickets', icon: Ticket, agentOnly: true },
    { href: '/problems', label: 'Problems', icon: AlertOctagon, privilege: 'problems.view' },
    { href: '/changes', label: 'Changes', icon: GitBranch, privilege: 'changes.view' },
    { href: '/releases', label: 'Releases', icon: Rocket, privilege: 'releases.view' },
    { href: '/assets', label: 'Assets', icon: Boxes, privilege: 'assets.view' },
    { href: '/solutions', label: 'Solutions', icon: BookOpen, agentOnly: true },
    { href: '/approvals', label: 'Approvals', icon: ClipboardCheck, badge: approvals.data?.length },
    { href: '/projects', label: 'Projects', icon: FolderKanban, agentOnly: true, match: ['/projects', '/tasks'] },
    { href: '/reports', label: 'Analytics', icon: PieChart, privilege: 'reports.view' },
  ];
  const visible = nav.filter((n) => (!n.agentOnly || isAgent) && (!n.privilege || (isAgent && can(n.privilege))));

  return (
    <div className="app-shell flex min-h-screen bg-slate-50">
      <aside className={cn('app-sidebar sticky top-0 z-30 flex h-screen shrink-0 flex-col transition-all', collapsed ? 'w-16' : 'w-60')}>
        <div className="app-sidebar-divider flex h-14 items-center gap-2.5 border-b px-3.5">
          {me.settings.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={me.settings.logo_url} alt="" className="h-8 w-8 rounded-md bg-white object-contain" />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white" style={{ background: me.settings.primary_color || '#2563eb' }}>
              <LifeBuoy className="h-4 w-4" />
            </span>
          )}
          {!collapsed && (
            <div className="min-w-0">
              <div className="app-sidebar-title truncate text-sm font-semibold">{me.settings.helpdesk_name}</div>
              <div className="app-sidebar-muted truncate text-[11px]">{me.organization.name}</div>
            </div>
          )}
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {visible.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} pathname={pathname} />
          ))}
          {admin && (
            <>
              <div className="app-sidebar-divider my-3 border-t" />
              <NavLink item={{ href: '/admin', label: 'Admin', icon: Settings, match: ['/admin'] }} collapsed={collapsed} pathname={pathname} excludes={['/admin/org', '/admin/global']} />
            </>
          )}
        </nav>
        <div className="app-sidebar-divider border-t p-2">
          <Link href="/portal" className="app-nav-link flex items-center gap-3 rounded-md px-2.5 py-2 text-sm" title="Support portal">
            <HelpCircle className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && 'Support portal'}
          </Link>
          <button onClick={toggle} className="app-nav-link mt-1 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm" aria-label="Toggle navigation">
            {collapsed ? <ChevronsRight className="h-[18px] w-[18px]" /> : <ChevronsLeft className="h-[18px] w-[18px]" />}
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main key={pathname} className="page-enter mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

function NavLink({ item, collapsed, pathname, excludes = [] }: { item: NavItem; collapsed: boolean; pathname: string; excludes?: string[] }) {
  const prefixes = item.match ?? [item.href];
  const active = prefixes.some((p) => pathname === p || pathname.startsWith(p + '/')) && !excludes.some((e) => pathname.startsWith(e));
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      data-active={active}
      aria-current={active ? 'page' : undefined}
      className="app-nav-link group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-all"
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && !!item.badge && <span className="app-nav-badge rounded-full px-1.5 text-[11px] font-semibold">{item.badge}</span>}
    </Link>
  );
}

function TopBar() {
  const { data: me } = useMe();
  const router = useRouter();
  const signOut = useSignOut();
  const qc = useQueryClient();
  const can = (p: string) => !!me && (me.is_account_admin || me.privileges.includes(p));
  const availability = useMutation({
    mutationFn: (available: boolean) => v2.put('/me/availability', { available }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
    onError: (e) => toast.error(parseApiError(e).message),
  });
  if (!me) return null;
  return (
    <header className="app-topbar sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-2">
        {me.is_agent && (
          <Menu
            trigger={() => (
              <button className="btn-primary inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
                <Plus className="h-4 w-4" /> New
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem icon={<Ticket className="h-4 w-4" />} onClick={() => { close(); router.push('/tickets/new'); }}>Incident</MenuItem>
                <MenuItem icon={<Inbox className="h-4 w-4" />} onClick={() => { close(); router.push('/tickets/new?type=service_request'); }}>Service request</MenuItem>
                {can('problems.manage') && <MenuItem icon={<AlertOctagon className="h-4 w-4" />} onClick={() => { close(); router.push('/problems/new'); }}>Problem</MenuItem>}
                {can('changes.manage') && <MenuItem icon={<GitBranch className="h-4 w-4" />} onClick={() => { close(); router.push('/changes/new'); }}>Change</MenuItem>}
                {can('releases.manage') && <MenuItem icon={<Rocket className="h-4 w-4" />} onClick={() => { close(); router.push('/releases/new'); }}>Release</MenuItem>}
                {can('assets.manage') && <MenuItem icon={<Boxes className="h-4 w-4" />} onClick={() => { close(); router.push('/assets/new'); }}>Asset</MenuItem>}
                {can('solutions.manage') && <MenuItem icon={<BookOpen className="h-4 w-4" />} onClick={() => { close(); router.push('/solutions/new'); }}>Solution article</MenuItem>}
              </>
            )}
          </Menu>
        )}
        <NotificationBell />
        <Menu
          className="w-72"
          trigger={() => (
            <button className="flex items-center gap-2 rounded-md p-1 hover:bg-slate-100" aria-label="Account menu">
              <span className="relative">
                <Avatar name={me.user.name} src={me.user.avatar_url} size="sm" />
                {me.is_agent && (
                  <span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white', me.user.available ? 'bg-emerald-500' : 'bg-slate-400')} />
                )}
              </span>
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="border-b border-slate-100 px-3 py-2.5">
                <div className="text-sm font-semibold text-slate-900">{me.user.name}</div>
                <div className="text-xs text-slate-500">{me.user.email}</div>
              </div>
              {me.is_agent && (
                <div className="border-b border-slate-100 px-3 py-2.5">
                  <Toggle
                    checked={me.user.available}
                    onChange={(v) => availability.mutate(v)}
                    label="Available for assignment"
                    description="Round-robin skips you when off"
                  />
                </div>
              )}
              <div className="border-b border-slate-100 px-3 py-2.5">
                <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-500">
                  Theme
                  <Link href="/profile#appearance" onClick={close} className="text-blue-600 hover:underline">More</Link>
                </div>
                <ThemeSwatches />
              </div>
              <MenuItem href="/profile" onClick={close} icon={<UserRound className="h-4 w-4" />}>Profile & security</MenuItem>
              <MenuItem href="/me/tasks" onClick={close} icon={<CheckSquare className="h-4 w-4" />}>My tasks</MenuItem>
              <MenuItem href="/portal" onClick={close} icon={<HelpCircle className="h-4 w-4" />}>Support portal</MenuItem>
              <div className="my-1 border-t border-slate-100" />
              <MenuItem onClick={() => { close(); signOut(); }} icon={<LogOut className="h-4 w-4" />} danger>Sign out</MenuItem>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}

const SEARCH_ICONS: Record<string, React.ElementType> = {
  ticket: Ticket, problem: AlertOctagon, change: GitBranch, release: Rocket, asset: Boxes, article: BookOpen, person: UserRound, catalog: Inbox, work_item: FolderKanban,
};

export const SEARCH_TYPE_LABELS: Record<string, string> = {
  ticket: 'Tickets', work_item: 'Work items', problem: 'Problems', change: 'Changes', release: 'Releases', asset: 'Assets', article: 'Solutions', catalog: 'Services', person: 'People',
};

export function searchIcon(type: string): React.ElementType {
  return SEARCH_ICONS[type] ?? Search;
}

/**
 * Header search (agents and the portal). Arrow keys move through results,
 * Enter opens the highlighted one (or the full results page), Esc closes.
 */
export function GlobalSearch({ portal = false }: { portal?: boolean }) {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const router = useRouter();
  const ref = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();
  useClickOutside(ref, () => setOpen(false));
  const term = useDebounced(q.trim(), 200);
  const { data, isFetching } = useQuery({
    queryKey: ['search', term],
    queryFn: () => v2.get<{ results: SearchResult[] }>('/search', { q: term }),
    enabled: term.length >= 2 || /^#?\d+$/.test(term),
    placeholderData: (prev) => prev,
  });
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const results = term ? data?.results ?? [] : [];
  React.useEffect(() => setActive(-1), [term]);
  const searchable = term.length >= 2 || /^#?\d+$/.test(term);
  const allHref = `${portal ? '/portal/search' : '/search'}?q=${encodeURIComponent(q.trim())}`;

  const go = (url: string) => {
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
    router.push(url);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && results[active]) go(results[active].url);
      else if (q.trim().length >= 1) go(allHref);
    } else if (e.key === 'Escape') {
      if (q) setQ('');
      else {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div ref={ref} className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open && searchable}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-label="Search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={portal ? 'Search articles, services and your tickets…' : 'Search tickets, people, assets, articles…  (⌘K)'}
        className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-8 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQ('');
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && searchable && (
        <div className="menu-panel absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
          {isFetching && results.length === 0 && <div className="px-4 py-3 text-sm text-slate-500">Searching…</div>}
          {!isFetching && results.length === 0 && <div className="px-4 py-3 text-sm text-slate-500">No results for “{term}”</div>}
          <ul id={listId} role="listbox" className="max-h-96 overflow-y-auto py-1">
            {results.map((r, i) => {
              const Icon = searchIcon(r.type);
              return (
                <li key={`${r.type}-${r.id}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r.url)}
                    className={cn('flex w-full items-center gap-3 px-4 py-2 text-left', i === active ? 'bg-blue-50' : 'hover:bg-slate-50')}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-800">
                        {r.display_id && <span className="mr-1.5 font-mono text-xs text-slate-500">{r.display_id}</span>}
                        {r.title}
                      </span>
                      {r.subtitle && <span className="block truncate text-xs text-slate-500">{r.subtitle}</span>}
                    </span>
                    <span className="text-[11px] uppercase tracking-wide text-slate-400">{r.type.replace('_', ' ')}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            onClick={() => go(allHref)}
            className="flex w-full items-center justify-between border-t border-slate-100 px-4 py-2 text-left text-xs text-slate-500 hover:bg-slate-50"
          >
            <span>See all results for “{q.trim()}”</span>
            <span className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px]">Enter</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function notificationHref(n: AppNotification, portal: boolean): string | null {
  const m = n.metadata || {};
  if (m.ticket_id) return portal ? `/portal/tickets/${m.ticket_id}` : `/tickets/${m.ticket_id}`;
  if (m.problem_id) return `/problems/${m.problem_id}`;
  if (m.change_id) return `/changes/${m.change_id}`;
  if (m.release_id) return `/releases/${m.release_id}`;
  if (m.asset_id) return `/assets/${m.asset_id}`;
  if (m.approval_id) return portal ? '/portal/approvals' : '/approvals';
  if (m.contract_id) return '/assets/contracts';
  if (m.work_item_id && m.project_id) return `/projects/${m.project_id}?item=${m.work_item_id}`;
  if (m.project_id) return `/projects/${m.project_id}`;
  return null;
}

export function NotificationBell({ portal = false }: { portal?: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['notifications', 'bell'],
    queryFn: () => v2.get<{ items: AppNotification[]; unread: number }>('/me/notifications', { per_page: 12 }),
    refetchInterval: 30_000,
  });
  const markAll = useMutation({
    mutationFn: () => v2.post('/me/notifications/read', { all: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => v2.post('/me/notifications/read', { ids: [id] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = data?.unread ?? 0;
  return (
    <Menu
      className="w-[360px]"
      trigger={() => (
        <button className="relative flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold text-slate-900">Notifications</span>
            {unread > 0 && (
              <button onClick={() => markAll.mutate()} className="text-xs font-medium text-blue-600 hover:text-blue-700">
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {(data?.items ?? []).length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-500">You&apos;re all caught up</div>}
            {(data?.items ?? []).map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.read) markOne.mutate(n.id);
                  const href = notificationHref(n, portal);
                  close();
                  if (href) router.push(href);
                }}
                className={cn('flex w-full gap-2.5 border-b border-slate-50 px-3 py-2.5 text-left hover:bg-slate-50', !n.read && 'bg-blue-50/50')}
              >
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-blue-600')} />
                <span className="min-w-0">
                  <span className="block text-sm text-slate-800">{n.title}</span>
                  {n.message && <span className="block truncate text-xs text-slate-500">{n.message}</span>}
                  <span className="block text-[11px] text-slate-400">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
          <Link href={portal ? '/portal/notifications' : '/notifications'} onClick={close} className="block border-t border-slate-100 py-2 text-center text-xs font-medium text-blue-600 hover:bg-slate-50">
            View all notifications
          </Link>
        </div>
      )}
    </Menu>
  );
}
