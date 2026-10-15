import { PageHeader } from '@/components/desk/kit';
import { ApprovalInbox } from '@/components/desk/approvals';

export default function ApprovalsPage() {
  return (
    <>
      <PageHeader title="Approvals" subtitle="Service requests and changes waiting on your decision." />
      <ApprovalInbox />
    </>
  );
}
