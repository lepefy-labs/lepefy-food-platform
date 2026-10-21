import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { getAiCapabilities } from '@/lib/ai/aiSettings';
import ProductEditClient from '../[id]/ProductEditClient';
import ProductEditWorkspace from '../[id]/ProductEditWorkspace';
import DuplicateSourceBar from './DuplicateSourceBar';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import {
  DUPLICATE_SOURCE_SELECT, emptyProductDraft, parseDuplicateSourceId, toDuplicateDraft, type DuplicateSourceRow,
} from '@/lib/catalog/productDuplication';

// Surface admin — reste dynamique (cf. audit Prompt 4, classification
// "/admin/**"). Explicite depuis que getTenant() n'utilise plus cookies() :
// cette page perdait son seul déclencheur dynamique implicite (elle-même
// n'utilise que createServiceClient(), sans cookies()).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminNouveauProduitPage({
  searchParams,
}: {
  searchParams: { duplicateFrom?: string | string[] };
}) {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);
  const supabase = createServiceClient();
  const [ai, access] = await Promise.all([getAiCapabilities(supabase, tenant.id, tenant), getCurrentAdminAccessContext(tenant.id)]);
  // Créer (et donc dupliquer) demande catalog.manage ; POST /api/admin/catalogue le revérifie.
  if (!access || !canAdmin(access, 'catalog.manage')) redirect('/admin/catalogue');

  // Duplication : seul l'id voyage dans l'URL ; la source est relue ici, dans ce tenant uniquement.
  const rawSourceId = Array.isArray(searchParams.duplicateFrom) ? searchParams.duplicateFrom[0] : searchParams.duplicateFrom;
  const sourceId = parseDuplicateSourceId(rawSourceId);
  const { data: sourceRow } = sourceId
    ? await supabase.from('products').select(DUPLICATE_SOURCE_SELECT).eq('id', sourceId).eq('tenant_id', tenant.id).maybeSingle()
    : { data: null };
  const source = (sourceRow as unknown as DuplicateSourceRow | null) ?? null;

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, slug, catalog_scope')
    .eq('tenant_id', tenant.id)
    .order('position');

  const { data: producers } = await supabase
    .from('producers')
    .select('id, tenant_id, name, legal_address, vat_number, health_stamp, country, active')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('name');

  const { data: importers } = await supabase
    .from('importers')
    .select('id, tenant_id, name, legal_address, vat_number, email, active')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('name');

  const draft = source ? toDuplicateDraft(source) : emptyProductDraft(categories?.[0]?.id ?? '');
  const categoryName = categories?.find((category: { id: string; name: string }) => category.id === draft.category_id)?.name ?? null;

  return (
    <div className="max-w-6xl mx-auto">
      <Link
        href="/admin/catalogue"
        className="text-sm text-a-text-3 hover:text-a-text-2 mb-4 inline-flex items-center gap-1"
      >
        ← Catalogue
      </Link>
      <DuplicateSourceBar
        source={source ? { id: source.id, name: source.name } : null}
        sourceMissing={rawSourceId != null && !source}
        tenantCurrency={tenant.currency}
      />
      <ProductEditWorkspace
        isNew={true}
        productName="Nouveau produit"
        categoryName={categoryName}
        active={false}
        stock={0}
        hasImage={Boolean(draft.image_url)}
        descriptionSource={draft.description_source}
        fulfillmentPolicy={draft.fulfillment_policy}
        pickupDisabled={!tenant.click_collect_enabled}
      >
        <ProductEditClient
          // Un autre produit source (ou « Repartir de zéro ») réinitialise tout le formulaire.
          key={source?.id ?? 'new'}
          product={draft}
          categories={categories ?? []}
          producers={producers ?? []}
          importers={importers ?? []}
          tenantId={tenant.id}
          tenantCurrency={tenant.currency}
          aiEnabled={ai.imageGeneration}
          tenantLocales={tenant.locales ?? ['fr']}
          aiDescriptionsEnabled={ai.descriptionGeneration}
          isNew={true}
          clickCollectEnabled={Boolean(tenant.click_collect_enabled)}
          duplicateFrom={source ? { id: source.id, name: source.name } : null}
        />
      </ProductEditWorkspace>
    </div>
  );
}
