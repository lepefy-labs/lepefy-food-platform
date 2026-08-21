import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function GET() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('tenant_notification_recipients')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: true });

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

  const body = await req.json() as {
    email?: unknown;
    label?: unknown;
    notify_card_payment?: unknown;
    notify_order_stock_conflict?: unknown;
  };

  const email = typeof body.email === 'string' ? body.email.trim() : '';

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Email invalide.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('tenant_notification_recipients')
    .insert({
      tenant_id:                   tenant.id,
      email,
      label:                       body.label ? String(body.label).trim() : null,
      notify_card_payment:         typeof body.notify_card_payment === 'boolean' ? body.notify_card_payment : true,
      notify_order_stock_conflict: typeof body.notify_order_stock_conflict === 'boolean' ? body.notify_order_stock_conflict : false,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Cet email est déjà enregistré.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidatePath('/admin/parametres');

  return NextResponse.json(data, { status: 201 });
}
