import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { routingMutation } from '@/lib/ai/core/routingConfig';
import { invalidateAiRouting } from '@/lib/ai/core/aiGateway';
import { approvedInferenceUrl } from '@/lib/ai/core/providers/openaiCompatibleAdapter';

export async function GET() {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  const db = createServiceClient();
  const results = await Promise.all([
    db.from('ai_providers').select('*').order('key'),
    db.from('ai_models').select('*').order('key'),
    db.from('ai_routing_policies').select('*').order('consumer'),
    db.from('ai_routing_policy_models').select('*').order('priority'),
  ]);
  if (results.some(r => r.error)) return NextResponse.json({
    error: 'Configuration indisponible. Vérifiez la migration 100.',
  }, { status: 503 });
  return NextResponse.json({ providers: results[0].data, models: results[1].data,
    policies: results[2].data, policyModels: results[3].data }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(req: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  const parsed = routingMutation.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Configuration invalide. Vérifiez les champs.' }, { status: 400 });
  const mutation = parsed.data;
  if (mutation.kind === 'provider' && mutation.values.base_url) {
    try { approvedInferenceUrl(mutation.values.base_url); }
    catch { return NextResponse.json({ error: 'Origine HTTPS à autoriser dans LEPEFY_AI_ALLOWED_ORIGINS.' }, { status: 400 }); }
  }
  if (mutation.kind === 'provider' && mutation.values.enabled
    && mutation.values.provider_type === 'openai_compatible' && !mutation.values.base_url) {
    return NextResponse.json({ error: 'URL de base requise.' }, { status: 400 });
  }
  const db = createServiceClient();
  const table = { provider: 'ai_providers', model: 'ai_models', policy: 'ai_routing_policies',
    policyModel: 'ai_routing_policy_models' }[mutation.kind];
  const values: Record<string, unknown> = mutation.values;
  const result = mutation.kind === 'policyModel'
    ? await db.from(table).upsert(values, { onConflict: 'policy_id,model_id' }).select('model_id')
    : mutation.id
      ? await db.from(table).update(values).eq('id', mutation.id).select('id')
      : await db.from(table).insert(values).select('id');
  if (result.error || !result.data?.length) return NextResponse.json({
    error: 'Enregistrement impossible. Vérifiez les références et les clés uniques.',
  }, { status: 400 });
  invalidateAiRouting();
  return NextResponse.json({ ok: true });
}
