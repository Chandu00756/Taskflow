import { KBBrowser } from '@/components/desk/kb';

export default function PortalSolutionsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Knowledge base</h1>
      <p className="mb-6 mt-1 text-sm text-slate-500">Guides and answers to common questions.</p>
      <KBBrowser basePath="/portal/solutions" />
    </div>
  );
}
