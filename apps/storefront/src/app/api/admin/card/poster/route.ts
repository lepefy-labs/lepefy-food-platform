import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { getTenantSocialLinks } from '@/lib/tenant/getTenantSocialLinks';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { buildPosterHtml } from '@/lib/card/buildPosterHtml';
import { htmlToPdf } from '@/lib/labels/gotenberg';

export const runtime = 'nodejs'; // stesso fix già applicato in labels/generate
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const [paymentMethods, socialLinks] = await Promise.all([
    getTenantPaymentMethods(tenant.id),
    getTenantSocialLinks(tenant.id),
  ]);

  const qrUrl = `${req.nextUrl.origin}/api/card/qr-code?format=png&size=900`;

  const html = buildPosterHtml({
    tenant: {
      name: tenant.name,
      logo_url: tenant.logo_url,
      primary_color: tenant.primary_color,
      click_collect_address: tenant.click_collect_address,
      click_collect_hours: tenant.click_collect_hours,
    },
    paymentMethods,
    socialLinks,
    qrUrl,
  });

  const pdfBuffer = await htmlToPdf(html);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${tenant.slug}-affiche-paiement.pdf"`,
    },
  });
}
