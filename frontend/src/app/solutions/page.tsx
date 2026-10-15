'use client';

import { FolderCog, Plus } from 'lucide-react';
import { LinkBtn, PageHeader } from '@/components/desk/kit';
import { KBBrowser } from '@/components/desk/kb';
import { useCan } from '@/lib/itsm/hooks';

export default function SolutionsPage() {
  const can = useCan();
  return (
    <>
      <PageHeader
        title="Solutions"
        subtitle="Knowledge base articles for agents and the self-service portal."
        actions={
          can('solutions.manage') && (
            <>
              <LinkBtn href="/solutions/manage" size="sm" icon={<FolderCog className="h-4 w-4" />}>Categories & folders</LinkBtn>
              <LinkBtn href="/solutions/new" variant="primary" size="sm" icon={<Plus className="h-4 w-4" />}>New article</LinkBtn>
            </>
          )
        }
      />
      <KBBrowser basePath="/solutions" agent />
    </>
  );
}
