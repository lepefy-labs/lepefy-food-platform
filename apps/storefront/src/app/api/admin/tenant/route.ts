import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

const EDITABLE_TENANT_FIELDS = [
  'tagline',
  'storefront_url',
  'whatsapp_number',
  'click_collect_address',
  'google_maps_url',
  'click_collect_hours',
  'click_collect_hours_it',
  'legal_name',
  'legal_address',
  'legal_email',
  'story_heading',
  'story_text',
  'countries_served',
  'loyalty_enabled',
  'referral_max_depth',
  'purchase_points_rate',
  'referral_availability_mode',
  'referral_unlock_spending_threshold',
  'referral_fraud_max_conversions',
  'referral_fraud_period_days',
  'referral_fraud_action',
  'ambassador_min_purchase_amount',
  'ambassador_min_commission_amount',
  'ambassador_max_commission_amount',
  'ambassador_loyalty_from_second_order',
  'ambassador_first_order_discount_type',
  'ambassador_first_order_discount_value',
  'ambassador_payout_threshold_amount',
  'ambassador_commission_mode',
  'ambassador_split_pool_amount',
  'ambassador_split_pool_ambassador_percent',
] as const;

const NUMERIC_FIELDS = new Set<string>([
  'countries_served',
  'referral_max_depth',
  'referral_fraud_period_days',
]);

const BOOLEAN_FIELDS = new Set<string>(['loyalty_enabled', 'ambassador_loyalty_from_second_order']);

const DECIMAL_FIELDS = new Set<string>([
  'purchase_points_rate',
  'referral_unlock_spending_threshold',
  'referral_fraud_max_conversions',
  'ambassador_min_purchase_amount',
  'ambassador_min_commission_amount',
  'ambassador_max_commission_amount',
  'ambassador_first_order_discount_value',
  'ambassador_payout_threshold_amount',
  'ambassador_split_pool_amount',
  'ambassador_split_pool_ambassador_percent',
]);

const GOOGLE_MAPS_HOSTS = new Set([
  'maps.app.goo.gl',
  'www.google.com',
  'google.com',
  'maps.google.com',
]);

function isAllowedGoogleMapsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && GOOGLE_MAPS_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function PATCH(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  if ('google_maps_url' in body) {
    const rawMapsUrl = body.google_maps_url;
    if (rawMapsUrl != null && typeof rawMapsUrl !== 'string') {
      return NextResponse.json({ error: 'Le lien Google Maps doit être une URL HTTPS valide.' }, { status: 400 });
    }
    const mapsUrl = typeof rawMapsUrl === 'string' ? rawMapsUrl.trim() : '';
    if (mapsUrl && !isAllowedGoogleMapsUrl(mapsUrl)) {
      return NextResponse.json({ error: 'Le lien doit être une URL HTTPS Google Maps valide.' }, { status: 400 });
    }
  }

  if ('storefront_url' in body) {
    const rawStorefrontUrl = body.storefront_url;
    if (rawStorefrontUrl != null && typeof rawStorefrontUrl !== 'string') {
      return NextResponse.json({ error: 'L’URL de la boutique doit être une URL HTTPS valide.' }, { status: 400 });
    }
    const storefrontUrl = typeof rawStorefrontUrl === 'string' ? rawStorefrontUrl.trim() : '';
    if (storefrontUrl && !isHttpsUrl(storefrontUrl)) {
      return NextResponse.json({ error: 'L’URL de la boutique doit commencer par https://.' }, { status: 400 });
    }
    body.storefront_url = storefrontUrl ? storefrontUrl.replace(/\/+$/, '') : '';
  }

  const updatePayload = EDITABLE_TENANT_FIELDS.reduce<Record<string, unknown>>((acc, field) => {
    if (field in body) {
      const raw = body[field];
      if (NUMERIC_FIELDS.has(field)) {
        const num = typeof raw === 'number' ? raw : parseInt(String(raw ?? '').trim(), 10);
        acc[field] = Number.isFinite(num) ? num : null;
      } else if (DECIMAL_FIELDS.has(field)) {
        const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').trim());
        acc[field] = Number.isFinite(num) ? num : null;
      } else if (BOOLEAN_FIELDS.has(field)) {
        acc[field] = raw === true || raw === 'true';
      } else {
        acc[field] = typeof raw === 'string' ? raw.trim() || null : null;
      }
    }
    return acc;
  }, {});

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('tenants')
    .update(updatePayload)
    .eq('id', tenant.id)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
