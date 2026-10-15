'use client';

import { usePathname } from 'next/navigation';
import { DeskShell } from '@/components/desk/shell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The platform console is for super admins, who have no service desk workspace.
  if (pathname.startsWith('/admin/global')) return <>{children}</>;
  return <DeskShell>{children}</DeskShell>;
}
