'use client';

import Link from 'next/link';
import {
  BadgeCheck, Bell, BookOpen, GitBranch, Boxes, CalendarClock, Clock3, FileText, FormInput, Gauge, Headphones, KeyRound, LayoutGrid, Mail, MapPin, Megaphone, MessageSquareText, PhoneCall, ScrollText, Settings2, ShoppingBag, Smile, Tags, UserPlus, Users, Workflow, Wand2, Network, Users2,
} from 'lucide-react';
import { PageHeader } from '@/components/desk/kit';
import { useCan } from '@/lib/itsm/hooks';

type Item = { href: string; title: string; text: string; icon: React.ElementType; priv: string };

const SECTIONS: { title: string; items: Item[] }[] = [
  {
    title: 'Account',
    items: [
      { href: '/admin/account', title: 'Account & helpdesk', text: 'Organization, branding, portal, security policy, ticket numbering', icon: Settings2, priv: 'settings.manage' },
      { href: '/admin/audit-log', title: 'Audit log', text: 'Every administrative change, who made it and when', icon: ScrollText, priv: 'settings.manage' },
      { href: '/admin/email-outbox', title: 'Email delivery log', text: 'Outgoing notifications and their delivery status', icon: Mail, priv: 'settings.manage' },
    ],
  },
  {
    title: 'Organization',
    items: [
      { href: '/admin/departments', title: 'Org units', text: 'Company, divisions, business units and departments, with an org chart', icon: Network, priv: 'users.manage' },
      { href: '/admin/teams', title: 'Teams', text: 'Cross-functional teams with hand-picked or rule-based members', icon: Users2, priv: 'users.manage' },
      { href: '/admin/locations', title: 'Locations', text: 'Offices and sites for people and assets', icon: MapPin, priv: 'users.manage' },
      { href: '/admin/job-roles', title: 'Job roles & hierarchy', text: 'Designations from CEO down, with levels and who reports to whom', icon: GitBranch, priv: 'users.manage' },
      { href: '/people/org-chart', title: 'People org chart', text: 'Reporting lines across the organization', icon: Network, priv: 'users.manage' },
    ],
  },
  {
    title: 'People',
    items: [
      { href: '/admin/agents', title: 'Agents', text: 'Add agents, assign roles and groups, reset access', icon: Headphones, priv: 'users.manage' },
      { href: '/admin/requesters', title: 'Requesters', text: 'Employees who use the self-service portal', icon: Users, priv: 'users.manage' },
      { href: '/admin/groups', title: 'Agent groups', text: 'Routing, round-robin assignment and escalation', icon: LayoutGrid, priv: 'users.manage' },
      { href: '/admin/roles', title: 'Roles & permissions', text: 'Agent roles (Account Admin, SD Agent, Change Manager…) and what each can see and do', icon: KeyRound, priv: 'users.manage' },
      { href: '/admin/oncall', title: 'On-call schedules', text: 'Daily or weekly rotations per group', icon: PhoneCall, priv: 'users.manage' },
      { href: '/admin/invites', title: 'Invitations', text: 'Pending organization invitations', icon: UserPlus, priv: 'users.manage' },
    ],
  },
  {
    title: 'Service desk',
    items: [
      { href: '/admin/categories', title: 'Categories & classifications', text: 'Categories, sub-categories, business impact and change types for tickets, problems and changes', icon: Tags, priv: 'settings.manage' },
      { href: '/admin/fields', title: 'Form fields', text: 'Custom fields on tickets, problems, changes and more', icon: FormInput, priv: 'settings.manage' },
      { href: '/admin/sla', title: 'SLA policies', text: 'Response and resolution targets per priority', icon: Gauge, priv: 'settings.manage' },
      { href: '/admin/business-hours', title: 'Business hours', text: 'Working hours and holidays for SLA timers', icon: Clock3, priv: 'settings.manage' },
      { href: '/admin/workflows', title: 'Workflow automator', text: 'Route, prioritize and notify automatically', icon: Workflow, priv: 'settings.manage' },
      { href: '/admin/scenarios', title: 'Scenario automations', text: 'One-click bundles of ticket actions', icon: Wand2, priv: 'tickets.manage' },
      { href: '/admin/canned-responses', title: 'Canned responses', text: 'Reusable replies with placeholders', icon: MessageSquareText, priv: 'tickets.manage' },
      { href: '/admin/email-notifications', title: 'Email notifications', text: 'Which emails are sent and their content', icon: Bell, priv: 'settings.manage' },
      { href: '/admin/survey', title: 'Satisfaction survey', text: 'CSAT question and recent feedback', icon: Smile, priv: 'reports.view' },
    ],
  },
  {
    title: 'Service management',
    items: [
      { href: '/admin/catalog', title: 'Service catalog', text: 'Requestable items, forms and approvals', icon: ShoppingBag, priv: 'catalog.manage' },
      { href: '/solutions/manage', title: 'Knowledge base', text: 'Categories, folders and visibility', icon: BookOpen, priv: 'solutions.manage' },
      { href: '/admin/announcements', title: 'Announcements', text: 'Banners for agents and the portal', icon: Megaphone, priv: 'announcements.manage' },
      { href: '/assets/types', title: 'Asset types', text: 'CMDB hierarchy and type-specific fields', icon: Boxes, priv: 'assets.manage' },
      { href: '/assets/contracts', title: 'Contracts', text: 'Renewals and license entitlements', icon: FileText, priv: 'contracts.manage' },
      { href: '/changes?view=calendar', title: 'Change calendar', text: 'Planned changes and releases', icon: CalendarClock, priv: 'changes.view' },
    ],
  },
];

export default function AdminHome() {
  const can = useCan();
  return (
    <>
      <PageHeader title="Admin" subtitle="Configure your service desk, people and automations." icon={<BadgeCheck className="h-5 w-5" />} />
      <div className="space-y-8">
        {SECTIONS.map((s) => {
          const items = s.items.filter((i) => can(i.priv));
          if (!items.length) return null;
          return (
            <section key={s.title}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{s.title}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((i) => (
                  <Link key={i.href} href={i.href} className="group flex gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-blue-600 group-hover:text-white">
                      <i.icon className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{i.title}</span>
                      <span className="block text-xs text-slate-500">{i.text}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
