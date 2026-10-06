import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { parseRuleConfig, resolveRules, RULE_DEFINITIONS, rulesUpdateSchema, type AutomationRuleRow } from '@/lib/whatsapp/automation/rules';
import { auditWhatsAppSettings } from '@/lib/whatsapp/server/adminAudit';
import { requireWhatsAppApi } from '@/lib/whatsapp/server/featureGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

async function readRules(tenantId: string) {
  const { data, error } = await createServiceClient().from('whatsapp_automation_rules')
    .select('code, enabled, priority, configuration').eq('tenant_id', tenantId);
  if (error) throw new Error('whatsapp_rules_read_failed');
  const resolved = resolveRules((data ?? []) as AutomationRuleRow[]);
  return resolved.map((rule) => ({ ...rule, ...RULE_DEFINITIONS.find((definition) => definition.code === rule.code)! }));
}

/** GET règles (whatsapp.view) — défauts du code fusionnés avec les surcharges du tenant. */
export async function GET() {
  const gate = await requireWhatsAppApi();
  if (!gate.ok) return gate.response;
  return NextResponse.json({ rules: await readRules(gate.tenant.id) }, { headers: { 'Cache-Control': 'no-store' } });
}

/** PUT règles (whatsapp.manage) : activation, priorité et textes optionnels, validés par code. */
export async function PUT(request: NextRequest) {
  const gate = await requireWhatsAppApi();
  if (!gate.ok) return gate.response;
  const parsed = rulesUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Règles invalides.' }, { status: 400 });

  const rows = [];
  for (const rule of parsed.data.rules) {
    const configuration = parseRuleConfig(rule.code, rule.configuration);
    if (!configuration) return NextResponse.json({ error: `Configuration invalide pour « ${rule.code} ».` }, { status: 400 });
    rows.push({ tenant_id: gate.tenant.id, code: rule.code, enabled: rule.enabled, priority: rule.priority, configuration });
  }
  const { error } = await createServiceClient().from('whatsapp_automation_rules').upsert(rows, { onConflict: 'tenant_id,code' });
  if (error) {
    console.error('[whatsapp] rules_save_failed', { tenantId: gate.tenant.id, code: error.code });
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }
  await auditWhatsAppSettings(gate.tenant.id, gate.actorId, 'rules_updated', {
    enabled: rows.filter((row) => row.enabled).map((row) => row.code).join(','),
  });
  return NextResponse.json({ rules: await readRules(gate.tenant.id) }, { headers: { 'Cache-Control': 'no-store' } });
}
