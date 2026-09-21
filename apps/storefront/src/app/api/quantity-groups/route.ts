import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createPublicClient } from '@/lib/supabase/public';

export const dynamic = 'force-dynamic';

export interface PublicQuantityGroup {
  id: string;
  name: string;
  min_quantity: number;
  quantity_step: number;
  productIds: string[];
}

// Lecture publique des groupes de quantité combinable actifs (ex. "Boissons") —
// consommée côté client par le panier pour afficher la progression avant le
// checkout (cf. lib/purchaseQuantityRules.ts pour la même règle appliquée
// côté serveur, de façon autoritaire, dans /api/checkout).
export async function GET() {
  try {
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from('purchase_quantity_groups')
      .select('id, name, min_quantity, quantity_step, purchase_quantity_group_products(product_id)')
      .eq('tenant_id', tenant.id)
      .eq('active', true) as {
        data: Array<{
          id: string; name: string; min_quantity: number; quantity_step: number;
          purchase_quantity_group_products: Array<{ product_id: string }>;
        }> | null;
        error: unknown;
      };

    if (error) throw error;

    const groups: PublicQuantityGroup[] = (data ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      min_quantity: group.min_quantity,
      quantity_step: group.quantity_step,
      productIds: group.purchase_quantity_group_products.map((row) => row.product_id),
    }));

    return NextResponse.json({ groups }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Optionnel : l'absence de groupes ne doit jamais bloquer l'affichage du panier.
    return NextResponse.json({ groups: [] }, { status: 503 });
  }
}
