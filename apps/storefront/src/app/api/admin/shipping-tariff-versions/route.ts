/**
 * GET  /api/admin/shipping-tariff-versions  → versions tarifaires du tenant (shipping.view)
 * POST /api/admin/shipping-tariff-versions  → crée une version immuable depuis un brouillon,
 *      puis la sélectionne comme version shadow si `select: true` (shipping.manage).
 *
 * Aucune action ne rend un prix facturable : le statut `active` n'est jamais
 * écrit en V1F. Voir docs/SHIPPING_FLAT_RATE_CHECKOUT.md.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import type { ShippingTariffDraftRow } from '@lepefy/types';
import { buildVersionFromDraft, TARIFF_ERROR_LABELS } from '@/lib/shipping/tariff/tariffVersion';
import { isMissingSchemaError } from '@/lib/shipping/tariff/adminData';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const MIGRATION_MISSING = 'Migration 124 non appliquée : les versions tarifaires ne sont pas encore disponibles.';

function optionalNumber(value: unknown): number | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 'invalid';
}

export async function GET() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('shipping_tariff_versions')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('country', { ascending: true })
    .order('version', { ascending: false });
  if (error) {
    return NextResponse.json({ error: isMissingSchemaError(error) ? MIGRATION_MISSING : 'Lecture des versions impossible.' }, { status: isMissingSchemaError(error) ? 409 : 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.draftId !== 'string') return NextResponse.json({ error: 'Brouillon manquant.' }, { status: 400 });

  const maxParcelKg = optionalNumber(body.maxParcelKg);
  const blockKg = optionalNumber(body.blockKg);
  const blockPrice = body.blockPrice === 0 || body.blockPrice === '0' ? 0 : optionalNumber(body.blockPrice);
  const logisticsVerifiedMaxKg = optionalNumber(body.logisticsVerifiedMaxKg);
  if (maxParcelKg === null || maxParcelKg === 'invalid' || blockKg === 'invalid' || blockPrice === 'invalid' || logisticsVerifiedMaxKg === 'invalid') {
    return NextResponse.json({ error: 'Paramètres numériques invalides.' }, { status: 400 });
  }
  if (typeof body.country !== 'string' || typeof body.pricesIncludeVat !== 'boolean') {
    return NextResponse.json({ error: 'Pays ou régime de TVA manquant.' }, { status: 400 });
  }
  const nonDeliverableZones = Array.isArray(body.nonDeliverableZones)
    ? body.nonDeliverableZones.filter((z): z is string => typeof z === 'string')
    : [];

  const supabase = createServiceClient();
  const { data: draft, error: draftError } = await supabase
    .from('shipping_tariff_drafts')
    .select('id, name, bands, zone_surcharges, multi_parcel_strategy')
    .eq('id', body.draftId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (draftError) return NextResponse.json({ error: 'Lecture du brouillon impossible.' }, { status: 500 });
  if (!draft) return NextResponse.json({ error: 'Brouillon introuvable.' }, { status: 404 });

  const built = buildVersionFromDraft(draft as ShippingTariffDraftRow, {
    country: body.country,
    pricesIncludeVat: body.pricesIncludeVat,
    maxParcelKg,
    blockKg,
    blockPrice,
    nonDeliverableZones,
    logisticsVerifiedMaxKg,
  });
  if (!built.ok) {
    return NextResponse.json({ error: built.errors.map((e) => TARIFF_ERROR_LABELS[e]).join(' '), codes: built.errors }, { status: 400 });
  }

  const { data: last, error: lastError } = await supabase
    .from('shipping_tariff_versions')
    .select('version')
    .eq('tenant_id', tenant.id)
    .eq('country', built.payload.country)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) {
    return NextResponse.json({ error: isMissingSchemaError(lastError) ? MIGRATION_MISSING : 'Lecture des versions impossible.' }, { status: isMissingSchemaError(lastError) ? 409 : 500 });
  }

  const adminId = await getAdminId();
  const { data: created, error: insertError } = await supabase
    .from('shipping_tariff_versions')
    .insert({
      ...built.payload,
      tenant_id: tenant.id,
      version: ((last as { version: number } | null)?.version ?? 0) + 1,
      status: 'validated',
      notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
      created_by: adminId,
    })
    .select('*')
    .single();
  if (insertError || !created) {
    const conflict = (insertError as { code?: string } | null)?.code === '23505';
    return NextResponse.json({ error: conflict ? 'Une autre version vient d’être créée. Rechargez la page.' : 'Création de la version impossible.' }, { status: conflict ? 409 : 500 });
  }

  if (body.select === true) {
    const { data: selected, error: selectError } = await supabase.rpc('select_shipping_tariff_shadow_version', {
      p_tenant_id: tenant.id,
      p_version_id: (created as { id: string }).id,
    });
    if (selectError) {
      console.error('[shipping-tariff-versions] select failed:', selectError);
      return NextResponse.json({ version: created, selected: false, error: 'Version créée mais non sélectionnée.' }, { status: 201 });
    }
    return NextResponse.json({ version: selected, selected: true }, { status: 201 });
  }
  return NextResponse.json({ version: created, selected: false }, { status: 201 });
}
