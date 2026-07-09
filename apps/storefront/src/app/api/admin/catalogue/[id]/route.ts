import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

function cleanNutrition(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object') return null;
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && !Number.isNaN(Number(v)))
    .map(([k, v]) => [k, Number(v)] as const);
  return entries.length ? Object.fromEntries(entries) : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const body   = await req.json() as Record<string, unknown>;

  const supabase = createServiceClient();

  const updatePayload: Record<string, unknown> = {};

  if ('name'               in body) updatePayload.name               = String(body.name).trim();
  if ('description'        in body) updatePayload.description        = body.description ? String(body.description).trim() : null;
  if ('price'              in body) updatePayload.price              = parseFloat(String(body.price)) || 0;
  if ('weight_grams'       in body) updatePayload.weight_grams       = body.weight_grams ? parseInt(String(body.weight_grams), 10) : null;
  if ('stock'              in body) updatePayload.stock              = parseInt(String(body.stock ?? 0), 10) || 0;
  if ('active'             in body) updatePayload.active             = Boolean(body.active);
  if ('featured'           in body) updatePayload.featured           = Boolean(body.featured);
  if ('storage_type'       in body) updatePayload.storage_type       = body.storage_type;
  if ('category_id'        in body) updatePayload.category_id        = body.category_id;
  if ('warehouse_location' in body) updatePayload.warehouse_location = body.warehouse_location ? String(body.warehouse_location).trim() : null;
  if ('image_url'          in body) updatePayload.image_url          = body.image_url ?? null;

  if ('producer_id'                in body) updatePayload.producer_id                = body.producer_id || null;
  if ('importer_id'                in body) updatePayload.importer_id                = body.importer_id || null;
  if ('ingredients_text'           in body) updatePayload.ingredients_text           = body.ingredients_text ? String(body.ingredients_text).trim() : null;
  if ('allergens_text'             in body) updatePayload.allergens_text             = body.allergens_text ? String(body.allergens_text).trim() : null;
  if ('gluten_free_certified'      in body) updatePayload.gluten_free_certified      = Boolean(body.gluten_free_certified);
  if ('usage_instructions'         in body) updatePayload.usage_instructions         = body.usage_instructions ? String(body.usage_instructions).trim() : null;
  if ('conservation_instructions'  in body) updatePayload.conservation_instructions  = body.conservation_instructions ? String(body.conservation_instructions).trim() : null;
  if ('conservation_after_opening' in body) updatePayload.conservation_after_opening = body.conservation_after_opening ? String(body.conservation_after_opening).trim() : null;
  if ('country_of_origin'          in body) updatePayload.country_of_origin          = body.country_of_origin ? String(body.country_of_origin).trim() : null;
  if ('durability_type'            in body) updatePayload.durability_type            = body.durability_type || null;
  if ('quid_ingredient'            in body) updatePayload.quid_ingredient            = body.quid_ingredient ? String(body.quid_ingredient).trim() : null;
  if ('quid_percentage'            in body) updatePayload.quid_percentage            = body.quid_percentage !== '' && body.quid_percentage != null ? parseFloat(String(body.quid_percentage)) : null;
  if ('alcohol_pct'                in body) updatePayload.alcohol_pct                = body.alcohol_pct !== '' && body.alcohol_pct != null ? parseFloat(String(body.alcohol_pct)) : null;
  if ('net_quantity_display'       in body) updatePayload.net_quantity_display       = body.net_quantity_display ? String(body.net_quantity_display).trim() : null;
  if ('packaging_material'         in body) updatePayload.packaging_material         = body.packaging_material ? String(body.packaging_material).trim() : null;
  if ('recycling_note'             in body) updatePayload.recycling_note             = body.recycling_note ? String(body.recycling_note).trim() : null;
  if ('nutrition_basis'            in body) updatePayload.nutrition_basis            = body.nutrition_basis === '100ml' ? '100ml' : '100g';
  if ('nutrition'                  in body) updatePayload.nutrition                  = cleanNutrition(body.nutrition);
  if ('label_background_image_url' in body) updatePayload.label_background_image_url = body.label_background_image_url ?? null;
  if ('label_background_color'     in body) updatePayload.label_background_color     = body.label_background_color ? String(body.label_background_color).trim() : null;

  const { error } = await supabase
    .from('products')
    .update(updatePayload)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
