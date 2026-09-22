import type { createClient } from '@/lib/supabase/server';

/**
 * Catalog filtering uses the tenant's explicit ACTIVE group membership, not a
 * merchandising category or a client-supplied list of product IDs.
 */
export async function getActiveQuantityGroupFilter(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  groupId: string,
): Promise<{ id: string; name: string; productIds: string[] } | null> {
  const { data, error } = await supabase
    .from('purchase_quantity_groups')
    .select('id, name, purchase_quantity_group_products(product_id)')
    .eq('id', groupId)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .maybeSingle() as {
      data: {
        id: string;
        name: string;
        purchase_quantity_group_products: Array<{ product_id: string }>;
      } | null;
      error: unknown;
    };
  if (error) throw new Error('Unable to resolve quantity group for catalog.');
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    productIds: data.purchase_quantity_group_products.map((member) => member.product_id),
  };
}
