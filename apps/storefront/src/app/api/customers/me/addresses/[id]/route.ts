import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';

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
    .select('id')
    .eq('id', params.id)
    .eq('customer_id', sessionCustomer.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'Adresse introuvable.' }, { status: 404 });
  }

  const body = await req.json() as AddressBody;
  const update: Record<string, string | boolean | null> = {};

  if (body.fullName !== undefined) {
    if (body.fullName.trim().length === 0) {
      return NextResponse.json({ error: 'Le nom du destinataire ne peut pas être vide.' }, { status: 400 });
    }
    update.full_name = body.fullName.trim();
  }
  if (body.line1 !== undefined) {
    if (body.line1.trim().length === 0) {
      return NextResponse.json({ error: 'La rue ne peut pas être vide.' }, { status: 400 });
    }
    update.line1 = body.line1.trim();
  }
  if (body.line2 !== undefined) update.line2 = body.line2?.trim() || null;
  if (body.city !== undefined) {
    if (body.city.trim().length === 0) {
      return NextResponse.json({ error: 'La ville ne peut pas être vide.' }, { status: 400 });
    }
    update.city = body.city.trim();
  }
  if (body.postalCode !== undefined) {
    if (body.postalCode.trim().length === 0) {
      return NextResponse.json({ error: 'Le code postal ne peut pas être vide.' }, { status: 400 });
    }
    update.postal_code = body.postalCode.trim();
  }
  if (body.country !== undefined) {
    if (body.country.trim().length === 0) {
      return NextResponse.json({ error: 'Le pays ne peut pas être vide.' }, { status: 400 });
    }
    update.country = body.country.trim();
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
