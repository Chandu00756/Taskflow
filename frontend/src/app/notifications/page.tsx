'use client';

import { DeskShell } from '@/components/desk/shell';
import { PageHeader } from '@/components/desk/kit';
import { NotificationsList } from '@/components/desk/notifications-list';

export default function NotificationsPage() {
  return (
    <DeskShell requireAgent={false}>
      <PageHeader title="Notifications" subtitle="Assignments, replies, approvals and SLA alerts." />
      <NotificationsList />
    </DeskShell>
  );
}
