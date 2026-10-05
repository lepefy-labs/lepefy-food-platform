import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getAdminWorkspaceUrls } from '@/lib/admin/workspace';
import { isWellFormedPortalToken } from '@/lib/orders/portal/orderPublicToken';
import { issuePortalReviewToken } from '@/lib/orders/portal/loadOrderPortal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /o/[token]/avis — « Donner mon avis » du portail. Émet un jeton d'avis
 * à usage unique (purpose qr_portal) uniquement pour une invitation encore
 * utilisable, puis 303 vers le formulaire existant /avis/donner. POST (et non
 * lien GET) : aucun aperçu de lien ne peut émettre de jeton.
 */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const base = getAdminWorkspaceUrls(tenant).shopBaseUrl ?? request.nextUrl.origin;
  const reviewToken = isWellFormedPortalToken(params.token)
    ? await issuePortalReviewToken(createServiceClient(), tenant.id, params.token).catch(() => null)
    : null;
  // Sans invitation utilisable, le formulaire affiche déjà « Avis indisponible ».
  const target = reviewToken ? `${base}/avis/donner?token=${encodeURIComponent(reviewToken)}` : `${base}/avis/donner`;
  return NextResponse.redirect(target, { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
