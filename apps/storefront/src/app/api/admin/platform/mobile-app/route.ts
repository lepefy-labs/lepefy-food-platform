import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { revalidateTenantCache } from '@/lib/cache/storefrontCache';
import { ANDROID_APP_COLUMNS, planAndroidAppUpdate, serializeAndroidApp, type AndroidAppRow } from '@/lib/mobileApp/androidApp';
import { createServiceClient } from '@/lib/supabase/server';

// Platform owner only: Android app of the current deployment tenant
// (/go, assetlinks.json and the /card customer email depend on it). Tenant
// capabilities never grant /api/admin/platform/** (adminApiPermissions).

const patchSchema = z.object({
  packageName: z.string().max(150).nullable().optional(),
  isPublic: z.boolean().optional(),
  // Signing fingerprints are never part of an ordinary save: the UI unlocks
  // them on explicit request and the change must carry confirm = true.
  fingerprints: z.object({ value: z.string().max(2000), confirm: z.literal(true) }).optional(),
}).strict();

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

async function loadTenant(): Promise<AndroidAppRow | null> {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const { data } = await createServiceClient().from('tenants').select(ANDROID_APP_COLUMNS).eq('slug', slug).maybeSingle();
  return (data as AndroidAppRow | null) ?? null;
}

export async function GET() {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  const row = await loadTenant();
  if (!row) return NextResponse.json({ error: 'Tenant introuvable.' }, { status: 404 });
  return NextResponse.json(serializeAndroidApp(row));
}

export async function PATCH(request: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Requête refusée.' }, { status: 403 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Données invalides.' }, { status: 400 });
  const row = await loadTenant();
  if (!row) return NextResponse.json({ error: 'Tenant introuvable.' }, { status: 404 });

  const plan = planAndroidAppUpdate(row, parsed.data);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
  if (!Object.keys(plan.update).length) return NextResponse.json(serializeAndroidApp(row));

  const { data, error } = await createServiceClient()
    .from('tenants')
    .update(plan.update)
    .eq('id', row.id)
    .select(ANDROID_APP_COLUMNS)
    .single();
  if (error || !data) {
    console.error('[platform/mobile-app] update failed:', error);
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 503 });
  }

  const saved = data as AndroidAppRow;
  console.info('[platform/mobile-app] updated — tenant:', row.slug, '— fields:', Object.keys(plan.update).join(','), '— public:', saved.android_public);
  // /go and assetlinks.json read getTenant() (tagged cache); emails read the row directly.
  revalidateTenantCache();
  return NextResponse.json(serializeAndroidApp(saved));
}
