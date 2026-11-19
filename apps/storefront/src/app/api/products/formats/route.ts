import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createPublicClient } from '@/lib/supabase/public';
import { PRODUCT_SALE_FORMAT_COLUMNS, PRODUCT_SELLING_FORMAT_COLUMNS } from '@/lib/catalog/productCardSelect';
import type { SaleFormatParent } from '@/lib/catalog/saleFormats';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 50;

export interface ProductFormatsResponse {
  products: Array<SaleFormatParent & {
    name: string;
    slug: string;
    image_url: string | null;
    storage_type: 'dry' | 'fresh' | 'frozen' | null;
    fulfillment_policy: string | null;
    net_quantity_display: string | null;
    sale_unit: string | null;
    net_content_value: number | null;
    net_content_unit: string | null;
    pack_count: number | null;
  }>;
}

/**
 * Formats de vente actuels des fiches d'un panier (migration 187), lus frais :
 * prix, stock dérivé et statut peuvent avoir changé depuis l'ajout. Sert à la
 * proposition « Passer au lot » ; `/api/checkout` reste la seule autorité.
 * GET /api/products/formats?ids=<uuid fiche>,<uuid fiche>
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('ids') ?? '';
  const ids = Array.from(new Set(raw.split(',').map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return NextResponse.json({ products: [] } satisfies ProductFormatsResponse);
  if (ids.length > MAX_IDS || ids.some((id) => !UUID.test(id))) {
    return NextResponse.json({ error: 'Produits invalides.' }, { status: 400 });
  }

  try {
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const { data, error } = await createPublicClient()
      .from('products')
      .select(`id, name, slug, price, compare_at_price, stock, active, image_url, storage_type, fulfillment_policy, weight_grams, min_order_quantity, order_quantity_step, ${PRODUCT_SELLING_FORMAT_COLUMNS}, ${PRODUCT_SALE_FORMAT_COLUMNS}`)
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .is('format_parent_id', null)
      .in('id', ids);
    if (error || !data) throw error ?? new Error('formats_lookup_failed');
    // Seules les fiches qui ont au moins un format actif intéressent le panier.
    const products = (data as unknown as ProductFormatsResponse['products']).filter((row) => (row.formats?.length ?? 0) > 0);
    return NextResponse.json({ products } satisfies ProductFormatsResponse,
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[products/formats] lookup failed:', error);
    return NextResponse.json({ error: 'Vérification impossible.' }, { status: 503 });
  }
}
