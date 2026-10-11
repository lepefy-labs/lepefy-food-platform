import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizeShippingAddress } from '@/lib/address/addressRules';

interface AddressBody {
  fullName?:   string;
  line1?:      string;
  line2?:      string | null;
  city?:       string;
  postalCode?: string;
  country?:    string;
  isDefault?:  boolean;
}

// PATCH /api/customers/me/addresses/:id — édition d'une adresse existante.
// isDefault: true bascule le défaut sur cette adresse (et l'enlève à
// l'ancienne) ; isDefault: false est ignoré silencieusement pour l'adresse
// actuellement par défaut — il doit toujours en exister exactement une dès
// qu'au moins une adresse existe (même invariant que POST et DELETE
// ci-dessous). Le client ne propose d'ailleurs pas de décocher l'adresse
// par défaut, seulement de définir une autre adresse comme telle.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const sessionCustomer = await getSessionCustomer(tenant.id);
  if (!sessionCustomer) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from('addresses')
    .select('id, full_name, line1, line2, city, postal_code, country')
    .eq('id', params.id)
    .eq('customer_id', sessionCustomer.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'Adresse introuvable.' }, { status: 404 });
  }

  const body = await req.json() as AddressBody;

  const update: Record<string, string | boolean | null> = {};
  const touchesAddress = [body.fullName, body.line1, body.line2, body.city, body.postalCode, body.country]
    .some((value) => value !== undefined);

  // Champs absents du corps = valeurs actuelles ; l'adresse résultante passe
  // le même contrôle que la création et le checkout. Un simple changement
  // d'adresse par défaut ne revalide pas une ancienne adresse.
  if (touchesAddress) {
    const normalized = normalizeShippingAddress({
      full_name:   body.fullName   !== undefined ? body.fullName   : existing.full_name,
      line1:       body.line1      !== undefined ? body.line1      : existing.line1,
      line2:       body.line2      !== undefined ? body.line2      : existing.line2,
      city:        body.city       !== undefined ? body.city       : existing.city,
      postal_code: body.postalCode !== undefined ? body.postalCode : existing.postal_code,
      country:     body.country    !== undefined ? body.country    : existing.country,
    });
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error, code: 'ADDRESS_INVALID', field: normalized.field }, { status: 400 });
    }
    Object.assign(update, {
      full_name:   normalized.address.full_name,
      line1:       normalized.address.line1,
      line2:       normalized.address.line2 ?? null,
      city:        normalized.address.city,
      postal_code: normalized.address.postal_code,
      country:     normalized.address.country,
    });
  }

  if (body.isDefault === true) {
    const { error: unsetError } = await supabase
      .from('addresses')
      .update({ is_default: false })
      .eq('customer_id', sessionCustomer.id)
      .eq('tenant_id', tenant.id)
      .eq('is_default', true)
      .neq('id', params.id);

    if (unsetError) {
      return NextResponse.json({ error: unsetError.message }, { status: 500 });
    }
    update.is_default = true;
  }

  const { data, error } = await supabase
    .from('addresses')
    .update(update)
    .eq('id', params.id)
    .eq('customer_id', sessionCustomer.id)
    .eq('tenant_id', tenant.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// DELETE /api/customers/me/addresses/:id — si l'adresse supprimée était par
// défaut et qu'il en reste d'autres, promeut la plus récente pour ne jamais
// laisser un client avec des adresses mais aucune par défaut (même
// invariant que POST).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const sessionCustomer = await getSessionCustomer(tenant.id);
  if (!sessionCustomer) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: existing } = await supabase
    .from('addresses')
    .select('id, is_default')
    .eq('id', params.id)
    .eq('customer_id', sessionCustomer.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'Adresse introuvable.' }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from('addresses')
    .delete()
    .eq('id', params.id)
    .eq('customer_id', sessionCustomer.id)
    .eq('tenant_id', tenant.id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  if (existing.is_default) {
    const { data: remaining } = await supabase
      .from('addresses')
      .select('id')
      .eq('customer_id', sessionCustomer.id)
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (remaining) {
      await supabase
        .from('addresses')
        .update({ is_default: true })
        .eq('id', remaining.id)
        .eq('tenant_id', tenant.id);
    }
  }

  return NextResponse.json({ ok: true });
}
