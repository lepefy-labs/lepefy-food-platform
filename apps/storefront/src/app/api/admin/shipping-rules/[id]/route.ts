import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { ShippingDiscountType } from '@lepefy/types';

export const runtime = 'nodejs';

const VALID_DISCOUNT_TYPES: ShippingDiscountType[] = ['percentage', 'fixed'];

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
  if (!Number.isFinite(n) || n < 0) return undefined;
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  const updatePayload: Record<string, unknown> = {};

  if ('countries' in body) {
    const countries = normalizeCountries(body.countries);
    if (!countries) {
      return NextResponse.json(
        { error: 'Sélectionnez au moins un pays valide, ou « Tous les pays ».' },
        { status: 400 },
      );
    }
    updatePayload.countries = countries;
  }

  if ('free_shipping_above' in body) {
    const v = parseOptionalAmount(body.free_shipping_above);
    if (v === undefined) {
      return NextResponse.json({ error: 'Seuil de gratuité invalide.' }, { status: 400 });
    }
    updatePayload.free_shipping_above = v;
  }

  if ('flat_rate_override' in body) {
    const v = parseOptionalAmount(body.flat_rate_override);
    if (v === undefined) {
      return NextResponse.json({ error: 'Forfait invalide.' }, { status: 400 });
    }
    updatePayload.flat_rate_override = v;
  }

  // Le type et la valeur de remise voyagent toujours ensemble (le formulaire
  // admin envoie l'état complet à chaque sauvegarde) pour éviter qu'un patch
  // partiel n'efface silencieusement l'un des deux.
  if ('discount_type' in body || 'discount_value' in body) {
    const discount = validateDiscount(body.discount_type ?? null, body.discount_value);
    if (!discount) {
      return NextResponse.json({ error: 'Remise invalide.' }, { status: 400 });
    }
    updatePayload.discount_type  = discount.type;
    updatePayload.discount_value = discount.value;
  }

  if ('active'   in body) updatePayload.active   = Boolean(body.active);
  if ('position' in body) updatePayload.position = parseInt(String(body.position), 10) || 0;
  if ('note'     in body) updatePayload.note     = body.note ? String(body.note).trim() : null;

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('shipping_country_rules')
    .update(updatePayload)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'Une règle existe déjà pour cette combinaison de pays.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('shipping_country_rules')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
