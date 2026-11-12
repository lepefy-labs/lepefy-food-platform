import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { logAiUsage } from '@/lib/ai/usageTracking';
import { STUDIO_LIMITS } from '../domain';
import { buildStudioPrompt } from '../style';
import { isRetryableJobError } from '../rules';
import { assetPrefix, downloadPrivate, normalizeImage, removePrivate, uploadPrivate } from './storage';
import { styleById } from './style';
import { runStudioImage, studioCallCostUsd, studioCandidates } from './providers/registry';
import { StudioProviderError } from './providers/types';

/**
 * Durable processing of a proposal. A job is claimed by compare-and-set
 * (`studio_claim_jobs`), so the request that created it, a « Réessayer » and
 * the n8n tick can all try: only one holder of the claim token can finish it
 * (`studio_finish_revision`). A function killed mid-way leaves an expired lock
 * that the next tick takes over (max 3 attempts, then « Échec »).
 */

interface ClaimRow { out_job_id: string; out_claim_token: string; out_tenant_id: string; out_asset_id: string; out_revision_id: string; out_attempt: number }

export async function processStudioJobs(options: { jobId?: string; limit?: number; deadlineMs?: number } = {}): Promise<{ processed: number; results: string[] }> {
  const db = createServiceClient();
  const deadline = Date.now() + (options.deadlineMs ?? 100_000);
  const results: string[] = [];
  if (!options.jobId) {
    const { error } = await db.rpc('studio_fail_exhausted_jobs');
    if (error) console.error('[studio] exhausted jobs check failed:', error.code);
  }
  // One job at a time: a provider call can take most of the function budget.
  for (let i = 0; i < (options.jobId ? 1 : options.limit ?? 2); i += 1) {
    if (Date.now() + 30_000 > deadline) break;
    const { data, error } = await db.rpc('studio_claim_jobs', {
      p_limit: 1, p_job_id: options.jobId ?? null, p_lock_seconds: STUDIO_LIMITS.jobLockSeconds,
    });
    if (error) { console.error('[studio] claim failed:', error.code); break; }
    const claim = ((data ?? []) as ClaimRow[])[0];
    if (!claim) break;
    results.push(await processClaim(claim));
  }
  return { processed: results.length, results };
}

async function processClaim(claim: ClaimRow): Promise<string> {
  const db = createServiceClient();
  const finish = async (success: boolean, result: Record<string, unknown>, code: string | null, retryable: boolean) => {
    const { data, error } = await db.rpc('studio_finish_revision', {
      p_job_id: claim.out_job_id, p_claim_token: claim.out_claim_token, p_success: success,
      p_result: result, p_error_code: code, p_retryable: retryable, p_force: false,
    });
    if (error) console.error('[studio] finish failed:', error.code);
    return String(data ?? 'error');
  };

  const [{ data: revision }, { data: asset }] = await Promise.all([
    db.from('studio_revisions').select('id, revision_no, base_revision_id, request_text, style_version_id, status')
      .eq('tenant_id', claim.out_tenant_id).eq('id', claim.out_revision_id).maybeSingle(),
    db.from('studio_assets').select('id, origin, request_text, source_path, request_key, title')
      .eq('tenant_id', claim.out_tenant_id).eq('id', claim.out_asset_id).maybeSingle(),
  ]);
  if (!revision || !asset || revision.status !== 'pending') return finish(false, {}, 'worker_interrupted', false);

  // Input image: the proposal being corrected, else the original photo.
  let input: { bytes: Buffer; mime: string } | null = null;
  try {
    if (revision.base_revision_id) {
      const { data: base } = await db.from('studio_revisions').select('storage_path')
        .eq('tenant_id', claim.out_tenant_id).eq('id', revision.base_revision_id).maybeSingle();
      if (!base?.storage_path) throw new Error('source_missing');
      input = { bytes: await downloadPrivate(db, base.storage_path), mime: 'image/webp' };
    } else if (asset.source_path) {
      input = { bytes: await downloadPrivate(db, asset.source_path), mime: 'image/jpeg' };
    }
  } catch {
    return finish(false, {}, 'source_missing', false);
  }

  const style = await styleById(db, claim.out_tenant_id, revision.style_version_id);
  if (!style) return finish(false, {}, 'worker_interrupted', false);
  const isCorrection = Boolean(revision.base_revision_id);
  const prompt = buildStudioPrompt({
    origin: asset.origin,
    style: style.instructions,
    request: isCorrection ? asset.request_text : revision.request_text ?? asset.request_text,
    correction: isCorrection ? revision.request_text : null,
  });
  const capability = input ? 'photo_edit' : 'prompt_generate';
  const candidates = await studioCandidates(db, capability);

  let run;
  try {
    run = await runStudioImage(candidates, { capability, prompt, input, aspectRatio: '1:1' }, { timeoutMs: STUDIO_LIMITS.providerTimeoutMs });
  } catch (error) {
    const code = error instanceof StudioProviderError ? error.code : 'provider_error';
    const tried = (error as { attempts?: Array<{ model: string }> }).attempts ?? [];
    await logAiUsage({
      tenantId: claim.out_tenant_id, endpoint: 'studio-image', provider: candidates[0]?.providerType ?? 'none',
      model: candidates[0]?.providerModelId ?? 'none', consumer: 'studio', capability,
      status: code === 'rate_limit' ? 'rate_limited' : 'error', fallbackUsed: tried.length > 1, fallbackReason: code,
    });
    console.warn('[studio] generation failed', { tenant: claim.out_tenant_id, revision: claim.out_revision_id, code, attempt: claim.out_attempt });
    return finish(false, { final_prompt: prompt }, code, isRetryableJobError(code));
  }

  const cost = await studioCallCostUsd(db, run.model.providerType, run.model.providerModelId, run);
  await logAiUsage({
    tenantId: claim.out_tenant_id, endpoint: 'studio-image', provider: run.model.providerType, model: run.model.providerModelId,
    inputTokens: run.inputTokens, outputTokens: run.outputTokens, imagesGenerated: 1, estimatedCostUsd: cost, consumer: 'studio', capability,
    latencyMs: run.latencyMs, fallbackUsed: run.attempts.length > 0, fallbackReason: run.attempts.at(-1)?.code ?? null, status: 'success',
  });

  let stored;
  const path = assetPrefix(claim.out_tenant_id, asset.request_key) + `rev-${revision.revision_no}-${claim.out_claim_token.slice(0, 8)}.webp`;
  try {
    stored = await normalizeImage(run.bytes, 'webp');
    await uploadPrivate(db, path, stored.bytes, 'image/webp');
  } catch {
    return finish(false, { cost_usd: cost, provider: run.model.providerType, model: run.model.providerModelId }, 'invalid_output', true);
  }

  const outcome = await finish(true, {
    final_prompt: prompt, provider: run.model.providerType, model: run.model.providerModelId, storage_path: path,
    width: stored.width, height: stored.height, bytes: stored.bytes.byteLength, sha256: stored.sha256,
    cost_usd: cost, latency_ms: run.latencyMs,
  }, null, false);
  // Another worker finished first (expired lock): our copy is not referenced.
  if (outcome === 'stale') {
    const { data: current } = await db.from('studio_revisions').select('storage_path').eq('id', claim.out_revision_id).maybeSingle();
    if (current?.storage_path !== path) await removePrivate(db, [path]).catch(() => undefined);
  }
  return outcome;
}
