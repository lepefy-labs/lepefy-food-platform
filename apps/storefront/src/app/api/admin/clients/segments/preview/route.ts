import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { applyCustomSegment, validateSegmentDefinition } from '@/lib/admin/crm';

export async function POST(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'); const denied = await requireAdmin(tenant.id); if (denied) return denied;
  try { const result = await applyCustomSegment(tenant.id, validateSegmentDefinition((await req.json()).definition), 8); return NextResponse.json(result); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Définition invalide.' }, { status: 400 }); }
}
