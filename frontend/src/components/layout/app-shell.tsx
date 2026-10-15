'use client';

import { DeskShell } from '@/components/desk/shell';

interface AppShellProps {
  children: React.ReactNode;
  /** Kept for backwards compatibility; the shell now tracks notifications itself. */
  unreadNotifications?: number;
}

/**
 * Legacy pages (projects, tasks, team dashboards) render inside the same
 * workspace chrome as the service desk. Requesters may use them too, so the
 * agent-only guard is disabled here.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <DeskShell requireAgent={false}>
      <div className="flex flex-col gap-6">{children}</div>
    </DeskShell>
  );
}
