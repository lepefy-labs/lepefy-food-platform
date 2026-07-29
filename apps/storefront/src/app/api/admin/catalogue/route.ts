import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { syncProductEmbedding } from '@/lib/ai/embeddings';
import { assignBarcodeToProduct } from '@/lib/barcode';

export const runtime = 'nodejs';

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

export async function POST(req: NextRequest) {
  const slug     = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant   = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body     = await req.json();
  const supabase = createServiceClient();

  const slugProd = (body.name as string)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  const descriptions = cleanDescriptions(body.descriptions);
  const firstLocale   = tenant.locales?.[0];
  const legacyDescription = firstLocale && descriptions[firstLocale]
    ? descriptions[firstLocale]
    : (body.description || null);

  const { data, error } = await supabase
    .from('products')
    .insert({
      tenant_id:          tenant.id,
      name:               String(body.name ?? '').trim(),
      name_alt:           body.name_alt ? String(body.name_alt).trim() : null,
      slug:               slugProd,
      description:        legacyDescription,
      descriptions:        descriptions,
      description_source:  body.description_source === 'ai' || body.description_source === 'human' ? body.description_source : null,
      price:              parseFloat(body.price) || 0,
      weight_grams:       body.weight_grams ? parseInt(body.weight_grams, 10) : null,
      stock:              parseInt(body.stock, 10) || 0,
      active:             Boolean(body.active),
      featured:           Boolean(body.featured),
      storage_type:       body.storage_type ?? 'dry',
      category_id:        body.category_id,
      warehouse_location: body.warehouse_location || null,
      position:           9999,

      producer_id:                 body.producer_id || null,
      importer_id:                 body.importer_id || null,
      ingredients_text:            body.ingredients_text ? String(body.ingredients_text).trim() : null,
      allergens_text:              body.allergens_text ? String(body.allergens_text).trim() : null,
      gluten_free_certified:       Boolean(body.gluten_free_certified),
      usage_instructions:          body.usage_instructions ? String(body.usage_instructions).trim() : null,
      conservation_instructions:   body.conservation_instructions ? String(body.conservation_instructions).trim() : null,
      conservation_after_opening:  body.conservation_after_opening ? String(body.conservation_after_opening).trim() : null,
      country_of_origin:           body.country_of_origin ? String(body.country_of_origin).trim() : null,
      durability_type:             body.durability_type || null,
      quid_ingredient:              body.quid_ingredient ? String(body.quid_ingredient).trim() : null,
      quid_percentage:              body.quid_percentage !== '' && body.quid_percentage != null ? parseFloat(body.quid_percentage) : null,
      alcohol_pct:                  body.alcohol_pct !== '' && body.alcohol_pct != null ? parseFloat(body.alcohol_pct) : null,
      net_quantity_display:         body.net_quantity_display ? String(body.net_quantity_display).trim() : null,
      packaging_material:           body.packaging_material ? String(body.packaging_material).trim() : null,
      recycling_note:               body.recycling_note ? String(body.recycling_note).trim() : null,
      nutrition_basis:              body.nutrition_basis === '100ml' ? '100ml' : '100g',
      nutrition:                    cleanNutrition(body.nutrition),
      label_background_image_url:   body.label_background_image_url ?? null,
      label_background_color:       body.label_background_color ? String(body.label_background_color).trim() : null,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await syncProductEmbedding(tenant.id, data.id);

  try {
    await assignBarcodeToProduct(supabase, tenant.id, data.id);
  } catch (barcodeError) {
    // Non bloccante: il prodotto è comunque creato, il barcode può essere
    // generato più tardi dal pulsante "Rigenera" nell'admin.
    console.error('[catalogue] Génération barcode échouée:', barcodeError);
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
