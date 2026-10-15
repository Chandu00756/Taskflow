import { DeskShell } from '@/components/desk/shell';

export default function SectionLayout({ children }: { children: React.ReactNode }) {
  return <DeskShell>{children}</DeskShell>;
}
