import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data: event } = await supabase
    .from('events')
    .select('id, tenant_id, capacity_total, capacity_remaining')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!event) return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });

  const { data: adjustments, error } = await supabase
    .from('event_capacity_adjustments')
    .select('id, previous_capacity, new_capacity, delta, reason, changed_by, created_at')
    .eq('event_id', params.id)
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const actorIds = [...new Set((adjustments ?? []).map((row) => row.changed_by).filter(Boolean))] as string[];
  const { data: admins } = actorIds.length > 0
    ? await supabase.from('admin_users').select('id, first_name, last_name, nickname, email').in('id', actorIds)
    : { data: [] as Array<{ id: string; first_name: string | null; last_name: string | null; nickname: string | null; email: string }> };

  const actorById = new Map((admins ?? []).map((admin) => {
    const fullName = [admin.first_name, admin.last_name].filter(Boolean).join(' ').trim();
    return [admin.id, admin.nickname || fullName || admin.email];
  }));

  return NextResponse.json({
    capacity_total: event.capacity_total,
    capacity_remaining: event.capacity_remaining,
    reserved_places: Math.max(0, event.capacity_total - event.capacity_remaining),
    adjustments: (adjustments ?? []).map((row) => ({
      ...row,
      actor_name: row.changed_by ? actorById.get(row.changed_by) ?? 'Administrateur' : 'Administrateur',
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const context = await getCurrentAdminAccessContext(tenant.id);
  if (!context) return NextResponse.json({ error: 'Accès administrateur introuvable.' }, { status: 403 });

  const body = await req.json().catch(() => null) as { capacity_total?: unknown; reason?: unknown } | null;
  const newCapacity = Number(body?.capacity_total);
  if (!Number.isInteger(newCapacity) || newCapacity < 0) {
    return NextResponse.json({ error: 'La capacité doit être un entier positif ou nul.' }, { status: 400 });
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('adjust_event_capacity', {
    p_event_id: params.id,
    p_tenant_id: tenant.id,
    p_new_capacity: newCapacity,
    p_actor_user_id: context.userId,
    p_reason: reason || null,
  });

  if (error) {
    const message = error.message || 'Impossible de modifier la capacité.';
    const status = message.includes('inférieure aux') ? 409 : message.includes('introuvable') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  const event = Array.isArray(data) ? data[0] : data;
  if (!event) return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });

  revalidatePath('/evenementiel');
  if (event.slug) revalidatePath(`/evenementiel/evenements/${event.slug}`);

  return NextResponse.json({
    event,
    reserved_places: Math.max(0, Number(event.capacity_total) - Number(event.capacity_remaining)),
  });
}
