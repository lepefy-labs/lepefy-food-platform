import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createPublicClient } from '@/lib/supabase/public';
import { getRelatedProducts } from '@/lib/catalog/getRelatedProducts';
import type { Category } from '@lepefy/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { productId: string } }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.productId)) {
    return NextResponse.json({ products: [] }, { status: 400 });
  }
  try {
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const supabase = createPublicClient();
    const { data: product, error } = await supabase.from('products')
      .select('id, category_id, category:categories(catalog_scope)')
      .eq('id', params.productId).eq('tenant_id', tenant.id).eq('active', true).maybeSingle();
    if (error) throw error;
    if (!product) return NextResponse.json({ products: [] }, { status: 404 });
    const requested = Number(req.nextUrl.searchParams.get('limit') ?? 4);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(4, Math.floor(requested))) : 4;
    const category = product.category as unknown as Pick<Category, 'catalog_scope'> | null;
    const products = await getRelatedProducts(
      supabase,
      category?.catalog_scope === 'gadgets' ? { ...tenant, ai_semantic_search: false } : tenant,
      product,
      limit,
    );
    return NextResponse.json({ strategy: 'similar', products }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Optional enhancement: cart mutation and confirmation never depend on this request.
    return NextResponse.json({ products: [] }, { status: 503 });
  }
}
