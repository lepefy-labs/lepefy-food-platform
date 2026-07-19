import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';

// Explicite depuis que getTenant() n'utilise plus cookies() (Prompt 4) :
// cette route perdait son seul déclencheur dynamique implicite. Contenu
// non personnalisé (branding tenant uniquement) — bon candidat ISR pour un
// futur prompt, même raisonnement que /card ; pas converti ici pour ne pas
// élargir le périmètre de ce prompt au-delà de ce qui était demandé.
export const dynamic = 'force-dynamic';

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const phone = tenant.whatsapp_number ? `+${tenant.whatsapp_number}` : '';
  const address = tenant.click_collect_address ?? '';
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${tenant.name}`,
    `ORG:${tenant.name}`,
    phone ? `TEL;TYPE=CELL:${phone}` : '',
    address ? `ADR;TYPE=WORK:;;${address.replace(/,/g, ';')}` : '',
    siteUrl ? `URL:${siteUrl}` : '',
    tenant.tagline ? `NOTE:${tenant.tagline}` : '',
    'END:VCARD',
  ].filter(Boolean).join('\r\n');

  return new NextResponse(vcard, {
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': `attachment; filename="${tenant.slug}.vcf"`,
    },
  });
}
