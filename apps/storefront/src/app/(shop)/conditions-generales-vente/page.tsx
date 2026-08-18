import type { Metadata } from 'next';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import { getTenant } from '@/lib/tenant/getTenant';
import { getLatestLegalDocument } from '@/lib/legal/getLatestLegalDocument';

// Même traitement typographique que politique-confidentialite/page.tsx
// (h2/p/ul en Tailwind natif) — pas de plugin @tailwindcss/typography
// dans ce monorepo, donc mapping explicite plutôt que classes "prose".
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => <h2 className="text-base font-bold text-gray-900 mb-2">{children}</h2>,
  h2: ({ children }) => <h2 className="text-base font-bold text-gray-900 mb-2">{children}</h2>,
  h3: ({ children }) => <h2 className="text-base font-bold text-gray-900 mb-2">{children}</h2>,
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  a: ({ href, children }) => (
    <a href={href} className="underline">
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
};

// Le contenu dépend de la dernière version publiée dans tenant_legal_documents
// (peut changer sans redéploiement) — force-dynamic seul ne suffit pas sur
// Next.js 14.2.x, fetchCache doit être désactivé aussi (cf. CLAUDE.md).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function generateMetadata(): Promise<Metadata> {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  return {
    title: `Conditions Générales de Vente | ${tenant.name}`,
    description: `Conditions générales de vente de ${tenant.name}.`,
  };
}

export default async function ConditionsGeneralesVentePage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const terms = await getLatestLegalDocument(tenant.id, 'terms');

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Conditions Générales de Vente</h1>

      {terms ? (
        <div className="space-y-4 text-sm text-gray-600 leading-relaxed">
          <ReactMarkdown components={MARKDOWN_COMPONENTS}>{terms.content}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-gray-600">Document non disponible pour le moment.</p>
      )}
    </div>
  );
}
