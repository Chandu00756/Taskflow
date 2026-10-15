'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArticleEditor } from '@/components/desk/article-editor';
import { LoadingBlock } from '@/components/desk/kit';
import { v2 } from '@/lib/itsm/api';
import type { Article } from '@/lib/itsm/types';

export default function EditArticlePage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useQuery({ queryKey: ['kb-article', id], queryFn: () => v2.get<{ article: Article }>(`/solutions/articles/${id}`) });
  if (!data) return <LoadingBlock />;
  return <ArticleEditor article={data.article} />;
}
