'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, BookOpen, ChevronRight, Megaphone, ShoppingBag, Ticket } from 'lucide-react';
import { Card, StatusBadge } from '@/components/desk/kit';
import { Markdown } from '@/components/desk/markdown';
import { PortalSearch } from '@/components/portal/shell';
import { v2 } from '@/lib/itsm/api';
import { useMe } from '@/lib/itsm/hooks';
import { timeAgo } from '@/lib/itsm/format';
import type { Announcement, Article, Ticket as TicketT } from '@/lib/itsm/types';

export default function PortalHome() {
  const { data: me } = useMe();
  const tickets = useQuery({ queryKey: ['portal', 'tickets', 'recent'], queryFn: () => v2.list<TicketT>('/tickets', { view: 'raised_by_me', per_page: 5 }) });
  const articles = useQuery({ queryKey: ['portal', 'popular'], queryFn: () => v2.list<Article>('/solutions/articles', { sort: 'popular', per_page: 6 }) });
  const announcements = useQuery({ queryKey: ['announcements'], queryFn: () => v2.items<Announcement>('/announcements') });
  const color = me?.settings.primary_color || '#2563eb';
  const actions = [
    { href: '/portal/new', title: 'Report an issue', text: 'Something broken? Tell us and we will fix it.', icon: AlertCircle },
    { href: '/portal/catalog', title: 'Request a service', text: 'Hardware, software, access and more.', icon: ShoppingBag },
    { href: '/portal/solutions', title: 'Browse solutions', text: 'Find answers in the knowledge base.', icon: BookOpen },
    { href: '/portal/tickets', title: 'My tickets', text: 'Follow up on your requests.', icon: Ticket },
  ];
  return (
    <div className="space-y-8">
      <section className="rounded-2xl px-6 py-10 text-center text-white sm:px-10" style={{ background: `linear-gradient(135deg, ${color}, #0f172a)` }}>
        <h1 className="text-2xl font-semibold sm:text-3xl">{me?.settings.portal_welcome || 'How can we help you today?'}</h1>
        <p className="mt-2 text-sm text-white/80">Search for answers, report issues and request services.</p>
        <div className="mx-auto mt-6 max-w-xl text-left">
          <PortalSearch />
        </div>
      </section>

      {(announcements.data ?? []).map((a) => (
        <div key={a.id} className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <div className="text-sm font-semibold text-amber-900">{a.title}</div>
            <Markdown text={a.body} className="text-sm text-amber-900/80" />
          </div>
        </div>
      ))}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map((a) => (
          <Link key={a.href} href={a.href} className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white">
              <a.icon className="h-5 w-5" />
            </span>
            <div className="mt-3 font-semibold text-slate-900">{a.title}</div>
            <div className="mt-1 text-sm text-slate-500">{a.text}</div>
          </Link>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="My recent tickets" actions={<Link href="/portal/tickets" className="text-xs font-medium text-blue-600">View all</Link>} padded={false}>
          {(tickets.data?.items ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">You have not raised any tickets yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tickets.data!.items.map((t) => (
                <li key={t.id}>
                  <Link href={`/portal/tickets/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{t.subject}</div>
                      <div className="text-xs text-slate-500">
                        {t.display_id} · {timeAgo(t.updated_at)}
                      </div>
                    </div>
                    <StatusBadge status={t.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Popular articles" actions={<Link href="/portal/solutions" className="text-xs font-medium text-blue-600">Knowledge base</Link>} padded={false}>
          {(articles.data?.items ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">No articles yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {articles.data!.items.map((a) => (
                <li key={a.id}>
                  <Link href={`/portal/solutions/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                    <BookOpen className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="flex-1 truncate text-sm text-slate-800">{a.title}</span>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
