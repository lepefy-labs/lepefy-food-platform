import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

// Bascule les deux flags d'activation indépendants du module (052) —
// events_enabled et services_enabled sur `tenants`, jamais de valeur par
// défaut hardcodée pour un tenant en particulier.
export async function PATCH(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body  = await req.json() as { events_enabled?: boolean; services_enabled?: boolean };
  const patch: Record<string, boolean> = {};

  if (typeof body.events_enabled === 'boolean') patch.events_enabled = body.events_enabled;
  if (typeof body.services_enabled === 'boolean') patch.services_enabled = body.services_enabled;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucun champ valide à mettre à jour.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('tenants')
    .update(patch)
    .eq('id', tenant.id)
    .select('events_enabled, services_enabled')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
