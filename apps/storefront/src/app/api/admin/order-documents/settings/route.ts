import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import {
  orderDocumentsModule, orderDocumentsPatchSchema, readOrderDocumentSettings, ORDER_DOCUMENTS_FEATURE_KEY,
} from '@/lib/orders/documents/settings';
import { isModuleRegistered, updateModuleConfig, ModuleConfigValidationError } from '@/lib/tenantConfig/moduleConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UNAVAILABLE = { error: 'La migration 145 doit être appliquée avant d’enregistrer ces préférences.' };

async function currentTenantId(): Promise<string> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return tenant.id;
}

/** GET/PATCH préférences « Documents des commandes » (tenant_settings.view / manage). */
export async function GET() {
  const tenantId = await currentTenantId();
  const denied = await requireAdmin(tenantId);
  if (denied) return denied;
  return NextResponse.json(await readOrderDocumentSettings(createServiceClient(), tenantId), { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(req: NextRequest) {
  const tenantId = await currentTenantId();
  const denied = await requireAdmin(tenantId);
  if (denied) return denied;

  const parsed = orderDocumentsPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Préférences invalides.' }, { status: 400 });

  const db = createServiceClient();
  try {
    if (!(await isModuleRegistered(db, ORDER_DOCUMENTS_FEATURE_KEY))) return NextResponse.json(UNAVAILABLE, { status: 409 });
    // `enabled` toujours vrai : les documents sont disponibles, seule la config compte.
    const state = await updateModuleConfig(db, orderDocumentsModule, tenantId, { enabled: true, config: parsed.data.config });
    return NextResponse.json({ config: state.config, available: true, status: state.status });
  } catch (error) {
    if (error instanceof ModuleConfigValidationError) {
      return NextResponse.json({ error: 'Préférences invalides.', issues: error.issues }, { status: 400 });
    }
    // CHECK SQL plus ancien que le code (146 non appliquée) : message explicite, pas un 500 opaque.
    if (error instanceof Error && /check constraint|23514/i.test(error.message)) {
      return NextResponse.json({ error: 'La migration 146 doit être appliquée avant d’enregistrer ces préférences.' }, { status: 409 });
    }
    console.error('[order-documents settings] update failed', tenantId, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }
}
