import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { loadKnowledgeBaseSuggestions } from '@/lib/admin/knowledgeSuggestions';
import AdminBlockAccent from '../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import AdminStatCard from '../../_components/ui/AdminStatCard';
import AdminTabs from '../../_components/ui/Tabs';
import { KnowledgeBaseClient } from './KnowledgeBaseClient';
import { pageWindow } from '@/lib/admin/listParams';
import { missingKnowledgeSchema } from '@/lib/admin/knowledgeSchema';
import { isDismissedMarker } from '@/lib/admin/knowledgeSuggestions';
import type { KnowledgeBaseEntry, KnowledgeLibraryEntry } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AiLabPage({ searchParams }: { searchParams?: { tab?: string; q?: string; category?: string; status?: string; area?: string; page?: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const tab = ['suggestions', 'library', 'mine', 'add'].includes(searchParams?.tab ?? '') ? searchParams!.tab! : 'suggestions';
  const page = Math.max(1, Math.min(10000, Number(searchParams?.page) || 1));
  const query = (searchParams?.q ?? '').trim().slice(0, 100).replace(/[%_,]/g, ' ');
  const category = ['faq', 'recipe', 'expression', 'greeting', 'cultural_context'].includes(searchParams?.category ?? '') ? searchParams!.category! : '';
  const status = ['active', 'paused'].includes(searchParams?.status ?? '') ? searchParams!.status! : '';
  const area = /^[A-Z]{2}$/.test(searchParams?.area ?? '') ? searchParams!.area! : '';
  const pageSize = 20;
  const { data: sources } = await supabase.from('tenant_knowledge_base').select('source').eq('tenant_id', tenant.id);
  const existingSources = (sources ?? []).map((entry) => entry.source);
  const suggestions = await loadKnowledgeBaseSuggestions({
    supabase,
    tenantId: tenant.id,
    existingSources,
  });
  const { error: schemaError } = await supabase.from('knowledge_library').select('id', { head: true }).limit(1);
  if (schemaError) {
    if (!missingKnowledgeSchema(schemaError)) throw new Error('Bibliothèque de connaissances indisponible.');
    const { data: legacyRows } = await supabase.from('tenant_knowledge_base')
      .select('id, category, content, source, reviewed_by, reviewed_at, active, created_at')
      .eq('tenant_id', tenant.id).order('created_at', { ascending: false });
    const legacyEntries = ((legacyRows ?? []) as KnowledgeBaseEntry[]).filter((entry) => !isDismissedMarker(entry.source));
    return <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader title="Base de connaissance IA" description="Gérez les connaissances validées pour Nala." />
      <p role="status" className="mb-4 rounded-lg bg-tone-info-bg p-3 text-sm text-tone-info-fg">La nouvelle bibliothèque sera disponible après la mise à jour de la base de données. Vos connaissances actuelles restent accessibles.</p>
      <AdminBlockAccent tone="primary"><KnowledgeBaseClient initialEntries={legacyEntries} initialSuggestions={suggestions} activeTab="legacy" libraryEntries={[]} libraryAreas={[]} search="" categoryFilter="" statusFilter="" areaFilter="" window={pageWindow(legacyEntries.length, 1, Math.max(legacyEntries.length, 1))} /></AdminBlockAccent>
    </div>;
  }
  const [{ count: libraryCount }, { count: activeCount }, { count: dueCount }] = await Promise.all([
    supabase.from('knowledge_library')
    .select('id', { count: 'exact', head: true }).eq('is_current', true).eq('verification_status', 'verified').eq('locale', 'fr'),
    supabase.from('tenant_knowledge_base').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).is('deleted_at', null).eq('active', true).or('source.is.null,source.not.like.nala_dismissed:%'),
    supabase.from('tenant_knowledge_base').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).is('deleted_at', null).or('source.is.null,source.not.like.nala_dismissed:%').lt('reviewed_at', new Date(Date.now() - 365 * 86400000).toISOString()),
  ]);
  const [{ data: tenantVersions }, { data: currentVersions }] = await Promise.all([
    supabase.from('tenant_knowledge_base').select('library_key, library_locale, library_version').eq('tenant_id', tenant.id).is('deleted_at', null).not('library_key', 'is', null),
    supabase.from('knowledge_library').select('stable_key, locale, version').eq('is_current', true).eq('verification_status', 'verified'),
  ]);
  const latestVersions = new Map((currentVersions ?? []).map((entry) => [`${entry.stable_key}:${entry.locale}`, entry.version]));
  const versionUpdates = (tenantVersions ?? []).filter((entry) => Number(latestVersions.get(`${entry.library_key}:${entry.library_locale}`) ?? 0) > Number(entry.library_version ?? 0)).length;
  let mineQuery = supabase.from('tenant_knowledge_base')
    .select('id, title, category, content, source, reviewed_by, reviewed_at, active, created_at, updated_at, library_key, library_locale, library_version, revision', { count: 'exact' })
    .eq('tenant_id', tenant.id).is('deleted_at', null).or('source.is.null,source.not.like.nala_dismissed:%');
  if (query) mineQuery = mineQuery.or(`content.ilike.%${query}%,title.ilike.%${query}%`);
  if (category) mineQuery = mineQuery.eq('category', category);
  if (status) mineQuery = mineQuery.eq('active', status === 'active');
  const { data: mineRows, count: mineCount } = tab === 'mine' ? await mineQuery.order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1) : { data: [], count: 0 };
  const entries = (mineRows ?? []) as KnowledgeBaseEntry[];
  let libraryQuery = supabase.from('knowledge_library')
    .select('id, stable_key, locale, version, title, category, content, scope, cultural_area, provenance, verification_status, reviewed_at, review_due_at, requires_tenant_confirmation', { count: 'exact' })
    .eq('is_current', true).eq('verification_status', 'verified').eq('locale', 'fr');
  if (area) libraryQuery = libraryQuery.or(`scope.eq.global,cultural_area.eq.${area}`);
  if (category) libraryQuery = libraryQuery.eq('category', category);
  if (query) libraryQuery = libraryQuery.or(`title.ilike.%${query}%,content.ilike.%${query}%`);
  const { data: libraryRows, count: filteredLibraryCount } = tab === 'library' ? await libraryQuery.order('title').range((page - 1) * pageSize, page * pageSize - 1) : { data: [], count: 0 };
  const { data: adoptedRows } = tab === 'library' ? await supabase.from('tenant_knowledge_base').select('library_key, library_locale, library_version').eq('tenant_id', tenant.id).is('deleted_at', null).not('library_key', 'is', null) : { data: [] };
  const adoptedVersions = new Map((adoptedRows ?? []).map((entry) => [`${entry.library_key}:${entry.library_locale}`, entry.library_version]));
  const { data: areaRows } = tab === 'library' ? await supabase.from('knowledge_library').select('cultural_area').eq('is_current', true).eq('verification_status', 'verified').eq('locale', 'fr').not('cultural_area', 'is', null) : { data: [] };
  const areas = [...new Set((areaRows ?? []).map((entry) => entry.cultural_area).filter((value): value is string => Boolean(value)))].sort();

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Base de connaissance IA"
        description="Choisissez et vérifiez les informations que Nala peut utiliser pour votre boutique. Les prix, stocks et frais actuels proviennent toujours des données de la boutique."
        meta={`${activeCount ?? 0} actives · ${suggestions.length} suggestions`}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminStatCard title="Actives" value={activeCount ?? 0} />
        <AdminStatCard title="Suggestions à vérifier" value={suggestions.length} />
        <AdminStatCard title="Dans la bibliothèque" value={libraryCount ?? 0} />
        <AdminStatCard title="Points à revoir" value={(dueCount ?? 0) + versionUpdates} tone={(dueCount ?? 0) + versionUpdates ? 'warning' : 'neutral'} />
      </div>
      <AdminTabs label="Base de connaissance" className="mb-5" tabs={[
        { href: '/admin/ai-lab?tab=suggestions', label: 'Suggestions de Nala', active: tab === 'suggestions' },
        { href: '/admin/ai-lab?tab=library', label: 'Bibliothèque', active: tab === 'library' },
        { href: '/admin/ai-lab?tab=mine', label: 'Mes connaissances', active: tab === 'mine' },
        { href: '/admin/ai-lab?tab=add', label: 'Ajouter', active: tab === 'add' },
      ]} />
      <AdminBlockAccent tone="primary"><KnowledgeBaseClient initialEntries={entries} initialSuggestions={suggestions} activeTab={tab}
        libraryEntries={(libraryRows ?? []).map((entry) => ({ ...entry, adopted: adoptedVersions.has(`${entry.stable_key}:${entry.locale}`), adoptedVersion: adoptedVersions.get(`${entry.stable_key}:${entry.locale}`) ?? null, updateAvailable: Number(adoptedVersions.get(`${entry.stable_key}:${entry.locale}`) ?? 0) > 0 && Number(adoptedVersions.get(`${entry.stable_key}:${entry.locale}`)) < entry.version })) as KnowledgeLibraryEntry[]}
        libraryAreas={areas} search={query} categoryFilter={category} statusFilter={status} areaFilter={area}
        window={pageWindow(tab === 'mine' ? mineCount ?? 0 : filteredLibraryCount ?? 0, page, pageSize)} /></AdminBlockAccent>
    </div>
  );
}
