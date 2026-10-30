import { notFound } from 'next/navigation';
import { helpModuleLabel } from '@/lib/helpCenter/domain';
import { loadArticle } from '@/lib/helpCenter/server/platformService';
import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import { ErrorState } from '../../../../_components/ui/States';
import KnowledgeEditor from './KnowledgeEditor';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function KnowledgeArticlePage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  let data: Awaited<ReturnType<typeof loadArticle>> = null;
  try {
    data = await loadArticle(params.id);
  } catch (error) {
    console.error('[platform/knowledge] article load failed:', (error as { code?: string })?.code ?? error);
    return <ErrorState title="Article indisponible" supportHint={false} />;
  }
  if (!data) notFound();
  const fr = data.translations.find((translation) => translation.locale === 'fr');
  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={fr?.title ?? data.article.slug}
        description={`${helpModuleLabel(data.article.module)} · /admin/aide/${data.article.slug}`}
        breadcrumb={[{ label: 'Plateforme' }, { label: 'Base de connaissances', href: '/admin/platform/knowledge' }, { label: fr?.title ?? data.article.slug }]}
      />
      <KnowledgeEditor article={data.article} translations={data.translations} contexts={data.contexts} revisions={data.revisions} />
    </div>
  );
}
