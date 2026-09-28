import { NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { isValidAndroidPackage, playStoreListingUrl } from '@/lib/mobileApp/androidApp';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Is the Play Store listing of the tenant package publicly reachable? Google
 * answers 404 while the app is in closed testing. Only play.google.com is
 * ever called, with the package read from the database (no user-supplied URL).
 */
export async function POST() {
  const denied = await requirePlatformOwner();
  if (denied) return denied;

  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const { data } = await createServiceClient().from('tenants').select('android_package_name').eq('slug', slug).maybeSingle();
  const packageName = (data as { android_package_name: string | null } | null)?.android_package_name;
  if (!isValidAndroidPackage(packageName)) {
    return NextResponse.json({ error: 'Aucun package Android enregistré.' }, { status: 400 });
  }

  const url = playStoreListingUrl(packageName);
  try {
    const response = await fetch(`${url}&hl=fr`, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    return NextResponse.json({ url, reachable: response.status === 200, httpStatus: response.status, checkedAt: new Date().toISOString() });
  } catch (error) {
    console.warn('[platform/mobile-app] listing check failed:', error);
    return NextResponse.json({ url, reachable: null, httpStatus: null, checkedAt: new Date().toISOString() });
  }
}
