'use client';

import { useParams } from 'next/navigation';
import { ArticleView } from '@/components/desk/kb';

export default function PortalArticlePage() {
  const { id } = useParams<{ id: string }>();
  return <ArticleView id={id} basePath="/portal/solutions" />;
}
