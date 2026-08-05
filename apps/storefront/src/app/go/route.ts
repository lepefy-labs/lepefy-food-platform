import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';

// Smart-link stabile: il QR "QR Shop" (api/shop/qr-code) incorpora questa
// URL, mai la destinazione finale. Oggi reindirizza sempre allo shop; il
// giorno del lancio pubblico Android basta valorizzare tenants.android_public
// a true in DB — nessun nuovo QR, nessuna nuova stampa.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const userAgent = req.headers.get('user-agent') ?? '';
  const isAndroid = /Android/i.test(userAgent);

  // android_public va controllato IN AGGIUNTA a android_package_name, mai al
  // suo posto: durante il closed testing il package name esiste già ma la
  // scheda pubblica Play Store non è raggiungibile dal pubblico generico
  // finché android_public resta false (default) — vedi
  // 049_tenant_android_public_release.sql.
  if (tenant.android_package_name && tenant.android_public && isAndroid) {
    return NextResponse.redirect(
      `https://play.google.com/store/apps/details?id=${tenant.android_package_name}`,
      302,
    );
  }

  return NextResponse.redirect(new URL('/', req.url), 302);
}
