'use client';

import { useParams, useRouter } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Btn, LinkBtn, useConfirm } from '@/components/desk/kit';
import { ArticleView } from '@/components/desk/kb';
import { useCan } from '@/lib/itsm/hooks';
import { v2, parseApiError } from '@/lib/itsm/api';

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const router = useRouter();
  const confirm = useConfirm();
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this article?', message: 'It will no longer be available to agents or the portal.', danger: true, confirmLabel: 'Delete' }))) return;
    try {
      await v2.del(`/solutions/articles/${id}`);
      toast.success('Article deleted');
      router.push('/solutions');
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  };
  return (
    <ArticleView
      id={id}
      basePath="/solutions"
      agent
      actions={
        can('solutions.manage') && (
          <div className="flex gap-2">
            <LinkBtn href={`/solutions/${id}/edit`} size="sm" icon={<Pencil className="h-4 w-4" />}>Edit</LinkBtn>
            <Btn size="sm" variant="ghost" onClick={remove} icon={<Trash2 className="h-4 w-4" />}>Delete</Btn>
          </div>
        )
      }
    />
  );
}
