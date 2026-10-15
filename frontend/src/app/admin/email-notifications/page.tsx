'use client';

import { CrudPage } from '@/components/desk/crud';
import { StatusBadge } from '@/components/desk/kit';
import { PLACEHOLDER_HELP } from '@/components/admin/editors';
import { labelize } from '@/lib/itsm/format';

type Template = { id: string; event: string; recipient: string; name: string; enabled: boolean; subject: string; body: string };

export default function EmailNotificationsPage() {
  return (
    <CrudPage<Template>
      title="Email notifications"
      subtitle="Turn notifications on or off and edit their content. Delivery requires SMTP settings on the server."
      singular="Notification"
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Email notifications' }]}
      listPath="/email-templates"
      queryKey={['email-templates']}
      deletePath={() => null}
      columns={[
        { label: 'Notification', render: (r) => <div><div className="font-medium text-slate-900">{r.name}</div><div className="text-xs text-slate-500">{r.subject}</div></div> },
        { label: 'Sent to', render: (r) => labelize(r.recipient) },
        { label: 'Status', render: (r) => <StatusBadge status={r.enabled ? 'active' : 'draft'} label={r.enabled ? 'Enabled' : 'Disabled'} /> },
      ]}
      fields={[
        { name: 'enabled', label: 'Send this notification', type: 'toggle' },
        { name: 'subject', label: 'Subject', required: true },
        { name: 'body', label: 'Body', type: 'textarea', rows: 10, hint: `Placeholders: ${PLACEHOLDER_HELP}, {{reply.body}}, {{approval.subject}}, {{survey.url}}` },
      ]}
      defaults={{}}
      toForm={(r) => ({ enabled: r.enabled, subject: r.subject, body: r.body })}
      canEdit
      canCreate={false}
      drawerWidth="max-w-2xl"
    />
  );
}
