import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminBlockAccent from '../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { KnowledgeBaseClient } from './KnowledgeBaseClient';
import type { KnowledgeBaseEntry } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

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
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Base de connaissance IA"
        description="Gérez le contenu culturel et métier validé qui sert de référence à l'assistant, sans le confondre avec du contenu généré automatiquement."
        meta={`${(data ?? []).length} entrée${(data ?? []).length !== 1 ? 's' : ''}`}
      />

      <AdminBlockAccent tone="primary">
        <KnowledgeBaseClient initialEntries={(data ?? []) as KnowledgeBaseEntry[]} />
      </AdminBlockAccent>
    </div>
  );
}
