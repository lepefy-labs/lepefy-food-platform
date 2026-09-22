import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  const updatePayload: Record<string, unknown> = {};

  if ('name' in body) {
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Nom requis.' }, { status: 400 });
    updatePayload.name = name;
  }
  if ('min_quantity' in body) updatePayload.min_quantity = Math.max(1, parseInt(String(body.min_quantity ?? 1), 10) || 1);
  if ('quantity_step' in body) updatePayload.quantity_step = Math.max(1, parseInt(String(body.quantity_step ?? 1), 10) || 1);
  if ('active' in body) updatePayload.active = Boolean(body.active);

  const supabase = createServiceClient();
  if (body.active === true) {
    const { data: target, error: targetError } = await supabase
      .from('purchase_quantity_groups')
      .select('id, active')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    if (targetError) return NextResponse.json({ error: 'Erreur de validation du groupe.' }, { status: 500 });
    if (!target) return NextResponse.json({ error: 'Groupe introuvable.' }, { status: 404 });

    const { data: members, error: membersError } = await supabase
      .from('purchase_quantity_group_products')
      .select('product_id, products(id, name)')
      .eq('group_id', params.id);
    const { data: otherActiveGroups, error: othersError } = await supabase
      .from('purchase_quantity_groups')
      .select('id, name, purchase_quantity_group_products(product_id)')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .neq('id', params.id);
    if (membersError || othersError) {
      return NextResponse.json({ error: 'Erreur de validation des appartenances.' }, { status: 500 });
    }
    const names = new Map((members ?? []).map((member) => [
      member.product_id,
      (member.products as unknown as { name: string } | null)?.name ?? member.product_id,
    ]));
    const conflicts = (otherActiveGroups ?? []).flatMap((other) =>
      ((other.purchase_quantity_group_products ?? []) as Array<{ product_id: string }>).flatMap((membership) =>
        names.has(membership.product_id) ? [{
          productId: membership.product_id,
          productName: names.get(membership.product_id),
          groupId: other.id,
          groupName: other.name,
        }] : []
      )
    );
    if (conflicts.length) {
      return NextResponse.json({
        error: 'Impossible d’activer ce groupe : certains produits appartiennent déjà à un groupe actif.',
        code: 'QUANTITY_GROUP_MEMBERSHIP_CONFLICT',
        conflicts,
      }, { status: 409 });
    }
  }

  if ('active' in body && typeof body.active !== 'boolean') {
    return NextResponse.json({ error: 'État du groupe invalide.' }, { status: 400 });
  }
  for (const field of ['min_quantity', 'quantity_step'] as const) {
    if (field in body && (!Number.isInteger(Number(body[field])) || Number(body[field]) < 1)) {
      return NextResponse.json({ error: 'Minimum et incrément doivent être des entiers positifs.' }, { status: 400 });
    }
  }

  const { error } = await supabase
    .from('purchase_quantity_groups')
    .update(updatePayload)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('purchase_quantity_groups')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
