import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { syncProductEmbedding } from '@/lib/ai/embeddings';
import { assignBarcodeToProduct } from '@/lib/barcode';

export const runtime = 'nodejs';

const SORT_MAP: Record<string, { column: string; ascending: boolean }> = {
  position_asc: { column: 'position', ascending: true },
  name_asc: { column: 'name', ascending: true },
  name_desc: { column: 'name', ascending: false },
  price_asc: { column: 'price', ascending: true },
  price_desc: { column: 'price', ascending: false },
  stock_asc: { column: 'stock', ascending: true },
  stock_desc: { column: 'stock', ascending: false },
};

function cleanNutrition(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !Number.isNaN(Number(v)))
    .map(([k, v]) => [k, Number(v)] as const);
  return entries.length ? Object.fromEntries(entries) : null;
}

function cleanDescriptions(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
    .map(([k, v]) => [k, String(v).trim()] as const);
  return Object.fromEntries(entries);
}

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(10, Number.parseInt(params.get('limit') ?? '25', 10) || 25));
  const q = (params.get('q') ?? '').trim();
  const categorySlug = (params.get('category') ?? '').trim();
  const status = params.get('status') ?? 'all';
  const requestedSort = params.get('sort') ?? 'position_asc';
  const sort = SORT_MAP[requestedSort] ?? { column: 'position', ascending: true };
  const supabase = createServiceClient();

  let categoryId: string | null = null;
  if (categorySlug) {
    const { data: category } = await supabase
      .from('categories')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('slug', categorySlug)
      .maybeSingle();
    categoryId = category?.id ?? '__missing__';
  }

  let query = supabase
    .from('products')
    .select(`
      id, name, slug, price, stock, active,
      image_url, storage_type, warehouse_location, description_source,
      barcode_value, categories(name, slug)
    `, { count: 'exact' })
    .eq('tenant_id', tenant.id);

  if (categoryId) query = query.eq('category_id', categoryId);
  if (q) {
    const safe = q.replace(/[%_,]/g, ' ').trim();
    query = query.or(`name.ilike.%${safe}%,slug.ilike.%${safe}%,barcode_value.ilike.%${safe}%`);
  }

  if (status === 'active') query = query.eq('active', true);
  if (status === 'inactive') query = query.eq('active', false);
  if (status === 'out') query = query.eq('stock', 0);
  if (status === 'ai') query = query.eq('description_source', 'ai');

  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const { data, count, error } = await query
    .order(sort.column, { ascending: sort.ascending })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    products: data ?? [],
    total: count ?? 0,
    page,
    limit,
  });
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json();
  const supabase = createServiceClient();

  const slugProd = (body.name as string)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  const descriptions = cleanDescriptions(body.descriptions);
  const firstLocale = tenant.locales?.[0];
  const legacyDescription = firstLocale && descriptions[firstLocale]
    ? descriptions[firstLocale]
    : (body.description || null);

  const { data, error } = await supabase
    .from('products')
    .insert({
      tenant_id: tenant.id,
      name: String(body.name ?? '').trim(),
      name_alt: body.name_alt ? String(body.name_alt).trim() : null,
      slug: slugProd,
      description: legacyDescription,
      descriptions,
      description_source: body.description_source === 'ai' || body.description_source === 'human' ? body.description_source : null,
      price: parseFloat(body.price) || 0,
      weight_grams: body.weight_grams ? parseInt(body.weight_grams, 10) : null,
      stock: parseInt(body.stock, 10) || 0,
      active: Boolean(body.active),
      featured: Boolean(body.featured),
      storage_type: body.storage_type ?? 'dry',
      category_id: body.category_id,
      warehouse_location: body.warehouse_location || null,
      position: 9999,
      producer_id: body.producer_id || null,
      importer_id: body.importer_id || null,
      ingredients_text: body.ingredients_text ? String(body.ingredients_text).trim() : null,
      allergens_text: body.allergens_text ? String(body.allergens_text).trim() : null,
      gluten_free_certified: Boolean(body.gluten_free_certified),
      usage_instructions: body.usage_instructions ? String(body.usage_instructions).trim() : null,
      conservation_instructions: body.conservation_instructions ? String(body.conservation_instructions).trim() : null,
      conservation_after_opening: body.conservation_after_opening ? String(body.conservation_after_opening).trim() : null,
      country_of_origin: body.country_of_origin ? String(body.country_of_origin).trim() : null,
      durability_type: body.durability_type || null,
      quid_ingredient: body.quid_ingredient ? String(body.quid_ingredient).trim() : null,
      quid_percentage: body.quid_percentage !== '' && body.quid_percentage != null ? parseFloat(body.quid_percentage) : null,
      alcohol_pct: body.alcohol_pct !== '' && body.alcohol_pct != null ? parseFloat(body.alcohol_pct) : null,
      net_quantity_display: body.net_quantity_display ? String(body.net_quantity_display).trim() : null,
      packaging_material: body.packaging_material ? String(body.packaging_material).trim() : null,
      recycling_note: body.recycling_note ? String(body.recycling_note).trim() : null,
      nutrition_basis: body.nutrition_basis === '100ml' ? '100ml' : '100g',
      nutrition: cleanNutrition(body.nutrition),
      label_background_image_url: body.label_background_image_url ?? null,
      label_background_color: body.label_background_color ? String(body.label_background_color).trim() : null,
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await syncProductEmbedding(tenant.id, data.id);

  try {
    await assignBarcodeToProduct(supabase, tenant.id, data.id);
  } catch (barcodeError) {
    console.error('[catalogue] Génération barcode échouée:', barcodeError);
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
