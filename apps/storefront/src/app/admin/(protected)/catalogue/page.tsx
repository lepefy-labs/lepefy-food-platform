import { Suspense } from 'react';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import CatalogueTable from './CatalogueTable';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// List filters (q, status, category, sort, page) are read from the URL by the table.
export default async function AdminCataloguePage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();

  const [{ data: categories }, access] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, slug, catalog_scope')
      .eq('tenant_id', tenant.id)
      .order('position'),
    getCurrentAdminAccessContext(tenant.id),
  ]);
  // UI hint only: the catalogue write routes re-check catalog.manage.
  const canManage = Boolean(access && canAdmin(access, 'catalog.manage'));

  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-gray-50" />}>
      <CatalogueTable tenantCurrency={tenant.currency} categories={categories ?? []} canManage={canManage} />
    </Suspense>
  );
}
