import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

const EDITABLE_TENANT_FIELDS = [
  'tagline',
  'whatsapp_number',
  'click_collect_address',
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
] as const;

// Champs numériques de la whitelist — jamais forcés à un minimum, une valeur
// vide reste `null` (ex. countries_served : pas de chiffre tant qu'il n'est
// pas confirmé par le tenant, jamais une valeur par défaut inventée).
const NUMERIC_FIELDS = new Set<string>([
  'countries_served',
  'referral_max_depth',
  'referral_fraud_period_days',
]);

// Champs booléens — le parsing générique de la whitelist (string trim/parseInt)
// ne convient ni aux nombres décimaux (purchase_points_rate, taux type 1.25)
// ni aux booléens ; whitelist séparée pour éviter de stocker "false" comme
// chaîne truthy.
const BOOLEAN_FIELDS = new Set<string>(['loyalty_enabled']);

// Champs numériques pouvant être décimaux (contrairement à NUMERIC_FIELDS
// existant, qui utilise parseInt — inadapté à un taux ou un montant en euros).
const DECIMAL_FIELDS = new Set<string>([
  'purchase_points_rate',
  'referral_unlock_spending_threshold',
  'referral_fraud_max_conversions',
]);

export async function PATCH(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body   = await req.json() as Record<string, unknown>;

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
