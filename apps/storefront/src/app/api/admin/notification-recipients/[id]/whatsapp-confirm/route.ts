import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { confirmRecipientWhatsapp } from '@/lib/notifications/staff/testSend';

export const runtime = 'nodejs';

/** « J’ai bien reçu le message » : enables automatic WhatsApp sends to this number. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  const result = await confirmRecipientWhatsapp(createServiceClient(), tenant.id, params.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  revalidatePath('/admin/parametres');
  return NextResponse.json({ verifiedAt: result.verifiedAt });
}
