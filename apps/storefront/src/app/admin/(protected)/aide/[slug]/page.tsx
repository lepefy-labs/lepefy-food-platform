import { notFound } from 'next/navigation';
import { helpModuleLabel } from '@/lib/helpCenter/domain';
import { isValidSlug } from '@/lib/helpCenter/rules';
import { requireHelpTenantPage } from '@/lib/helpCenter/server/access';
import { helpArticle } from '@/lib/helpCenter/server/service';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import Badge from '../../../_components/ui/Badge';
import HelpArticleBody, { RelatedLinks } from '../../../_components/help/HelpArticleBody';
import HelpArticleFeedback from '../../../_components/help/HelpArticleFeedback';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** Shareable page of one guide. Unknown, unpublished and not-authorised guides are the same 404. */
export default async function HelpArticlePage({ params }: { params: { slug: string } }) {
  const { tenant, access, level } = await requireHelpTenantPage();
  if (!isValidSlug(params.slug)) notFound();
  const found = await helpArticle({ tenantId: tenant.id, access, level, locale: 'fr' }, params.slug);
  if (!found) notFound();
  const { article, related, localeFallback } = found;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <AdminPageHeader
        title={article.title}
        description={article.summary || undefined}
        breadcrumb={[{ label: 'Centre d’aide', href: '/admin/aide' }, { label: helpModuleLabel(article.module) }]}
        meta={localeFallback ? <Badge tone="neutral">Affiché en français : pas encore traduit</Badge> : undefined}
      />
      <HelpArticleBody blocks={article.blocks} />
      <RelatedLinks href={(slug) => `/admin/aide/${slug}`} items={related.map((item) => ({ slug: item.slug, title: item.title }))} />
      <HelpArticleFeedback slug={article.slug} />
    </div>
  );
}
