import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { ShippingDiscountType } from '@lepefy/types';

// Route admin — dati mutabili, mai cacheable (bug noto Next.js 14.2.x sulla
// Data Cache non disattivata da force-dynamic da solo, confermato in
// produzione su evenementiel/scan/[token]/route.ts, 11/08).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export const runtime = 'nodejs';

const VALID_DISCOUNT_TYPES: ShippingDiscountType[] = ['percentage', 'fixed'];

// countries = ['*'] est le fallback "tous les pays" (même pattern que
// shipping_vat_rates) — trié pour que la contrainte unique(tenant_id,
// countries) capture les doublons quel que soit l'ordre de sélection.
function normalizeCountries(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const codes = raw.map((c) => String(c).trim().toUpperCase());
  if (codes.includes('*')) return ['*'];
  const unique = [...new Set(codes)];
  if (unique.some((c) => !/^[A-Z]{2}$/.test(c))) return null;
  return unique.sort();
}

function parseOptionalAmount(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined; // marqueur d'erreur
  return parseFloat(n.toFixed(2));
}

function validateDiscount(
  type: unknown,
  value: unknown,
): { type: ShippingDiscountType | null; value: number | null } | null {
  if (type === null || type === undefined || type === '') return { type: null, value: null };
  if (!VALID_DISCOUNT_TYPES.includes(type as ShippingDiscountType)) return null;
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (type === 'percentage' && v > 100) return null;
  return { type: type as ShippingDiscountType, value: parseFloat(v.toFixed(2)) };
}

export async function GET() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('shipping_country_rules')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;

  const countries = normalizeCountries(body.countries);
  if (!countries) {
    return NextResponse.json(
      { error: 'Sélectionnez au moins un pays valide, ou « Tous les pays ».' },
      { status: 400 },
    );
  }

  const freeShippingAbove = parseOptionalAmount(body.free_shipping_above);
  const flatRateOverride  = parseOptionalAmount(body.flat_rate_override);
  if (freeShippingAbove === undefined || flatRateOverride === undefined) {
    return NextResponse.json({ error: 'Montants invalides.' }, { status: 400 });
  }

  const discount = validateDiscount(body.discount_type ?? null, body.discount_value);
  if (!discount) {
    return NextResponse.json({ error: 'Remise invalide.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Position par défaut = dernière position du tenant + 1 (même pattern que
  // tenant_hero_slides).
  const { data: lastRule } = await supabase
    .from('shipping_country_rules')
    .select('position')
    .eq('tenant_id', tenant.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: { position: number } | null };
  const nextPosition = (lastRule?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from('shipping_country_rules')
    .insert({
      tenant_id:            tenant.id,
      countries,
      free_shipping_above:  freeShippingAbove,
      flat_rate_override:   flatRateOverride,
      discount_type:        discount.type,
      discount_value:       discount.value,
      active:               body.active === undefined ? true : Boolean(body.active),
      position:             nextPosition,
      note:                 body.note ? String(body.note).trim() : null,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Une règle existe déjà pour cette combinaison de pays.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
