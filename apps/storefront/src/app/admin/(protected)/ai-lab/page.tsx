import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { KnowledgeBaseClient } from './KnowledgeBaseClient';
import type { KnowledgeBaseEntry } from '@lepefy/types';

export const dynamic = 'force-dynamic';

export default async function AiLabPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tenant_knowledge_base')
    .select('id, category, content, source, reviewed_by, reviewed_at, active, created_at')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Base de connaissance IA</h1>
      <p className="text-sm text-gray-500 mb-6">
        Contenu culturel curaté à la main (recettes, expressions, contexte, FAQ) utilisé
        par le chatbox comme référence de ton et d&apos;informations. Jamais généré par l&apos;IA.
      </p>

      <KnowledgeBaseClient initialEntries={(data ?? []) as KnowledgeBaseEntry[]} />
    </div>
  );
}
