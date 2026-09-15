import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { dispatchMarketingCampaign } from '@/lib/marketing/dispatchMarketingCampaign';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'); const denied = await requireAdmin(tenant.id); if (denied) return denied;
  try { return NextResponse.json(await dispatchMarketingCampaign(tenant.id, params.id)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Envoi impossible.' }, { status: 409 }); }
}
