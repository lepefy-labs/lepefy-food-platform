import { createServiceClient } from '@/lib/supabase/server';
import { ANDROID_APP_COLUMNS, serializeAndroidApp, type AndroidAppRow } from '@/lib/mobileApp/androidApp';
import MobileAppClient from './MobileAppClient';

export const dynamic = 'force-dynamic';

// Platform owner only (enforced by platform/layout.tsx and the API routes).
export default async function PlatformMobileAppPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const { data } = await createServiceClient()
    .from('tenants')
    .select(`${ANDROID_APP_COLUMNS}, storefront_url`)
    .eq('slug', slug)
    .maybeSingle();
  if (!data) {
    return <p className="rounded-2xl border border-tone-danger-border bg-tone-danger-bg p-5 text-sm text-tone-danger-fg">Tenant introuvable ({slug}).</p>;
  }
  const row = data as AndroidAppRow & { storefront_url: string | null };
  return <MobileAppClient initial={serializeAndroidApp(row)} storefrontUrl={row.storefront_url} />;
}
