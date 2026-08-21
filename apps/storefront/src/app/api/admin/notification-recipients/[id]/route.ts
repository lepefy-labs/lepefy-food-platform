import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as {
    label?: unknown;
    notify_card_payment?: unknown;
    notify_order_stock_conflict?: unknown;
    active?: unknown;
  };

  const updatePayload: Record<string, unknown> = {};

  if ('label'                       in body) updatePayload.label                       = body.label ? String(body.label).trim() : null;
  if ('notify_card_payment'         in body) updatePayload.notify_card_payment         = Boolean(body.notify_card_payment);
  if ('notify_order_stock_conflict' in body) updatePayload.notify_order_stock_conflict = Boolean(body.notify_order_stock_conflict);
  if ('active'                      in body) updatePayload.active                      = Boolean(body.active);

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('tenant_notification_recipients')
    .update(updatePayload)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Destinataire introuvable.' }, { status: 404 });
  }

  revalidatePath('/admin/parametres');

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

  const { data, error } = await supabase
    .from('tenant_notification_recipients')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Destinataire introuvable.' }, { status: 404 });
  }

  revalidatePath('/admin/parametres');

  return NextResponse.json({ success: true });
}
