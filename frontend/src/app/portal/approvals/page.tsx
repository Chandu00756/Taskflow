import { ApprovalInbox } from '@/components/desk/approvals';

export default function PortalApprovalsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Approvals</h1>
      <p className="mb-6 mt-1 text-sm text-slate-500">Requests from your team that need your decision.</p>
      <ApprovalInbox portal />
    </div>
  );
}
