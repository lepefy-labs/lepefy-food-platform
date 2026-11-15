/**
 * Growth import protocol (no server-only import: unit-tested with a fake db).
 * The route wraps it with the service client: lib/growth/server/ingest.ts.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { evaluateDossier, strongIdentityKeys, DEFAULT_TARGET_SEGMENT } from './engine';
import type { GrowthDossier } from './types';
import { parisDay } from './dates';

export const GROWTH_INGEST_LIMITS = { maxBodyBytes: 5_000_000, maxProspects: 500 } as const;

/** Constant-time comparison of the bearer token with GROWTH_INGEST_TOKEN. Unset or short token = disabled. */
export function growthIngestAuthorized(header: string | null): 'ok' | 'disabled' | 'denied' {
  const expected = process.env.GROWTH_INGEST_TOKEN ?? '';
  if (expected.length < 32) return 'disabled';
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!match?.[1]) return 'denied';
  const a = createHash('sha256').update(match[1]).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b) ? 'ok' : 'denied';
}

export class GrowthIngestError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

const ID = /^[a-z0-9][a-z0-9-]{1,119}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

interface IncomingProspect { id: string; dossier: GrowthDossier; runs: string[]; firstSeen: string; lastSeen: string }

/** Shape check only: the content is judged by the growth engine below, never trusted from the CLI. */
export function parseIngestBody(body: unknown): { targetSegment: string; prospects: IncomingProspect[] } {
  if (!isObject(body) || body.version !== 1 || !Array.isArray(body.prospects)) throw new GrowthIngestError('invalid_body');
  if (body.prospects.length > GROWTH_INGEST_LIMITS.maxProspects) throw new GrowthIngestError('too_many_prospects', 413);
  const targetSegment = typeof body.targetSegment === 'string' && body.targetSegment.length <= 100 ? body.targetSegment : DEFAULT_TARGET_SEGMENT;
  const seen = new Set<string>();
  const prospects = body.prospects.map((p): IncomingProspect => {
    if (!isObject(p) || typeof p.id !== 'string' || !ID.test(p.id) || seen.has(p.id) || !isObject(p.dossier)) throw new GrowthIngestError('invalid_prospect');
    seen.add(p.id);
    const runs = Array.isArray(p.runs) ? p.runs.filter((r): r is string => typeof r === 'string' && r.length <= 100).slice(0, 100) : [];
    const firstSeen = typeof p.firstSeen === 'string' && DAY.test(p.firstSeen) ? p.firstSeen : null;
    const lastSeen = typeof p.lastSeen === 'string' && DAY.test(p.lastSeen) ? p.lastSeen : null;
    if (!firstSeen || !lastSeen) throw new GrowthIngestError('invalid_prospect');
    return { id: p.id, dossier: p.dossier as unknown as GrowthDossier, runs, firstSeen, lastSeen };
  });
  return { targetSegment, prospects };
}

export interface GrowthIngestResult {
  imported: number;
  rejected: { id: string; errors: string[] }[];
  /** Shops imported as « do not contact » because they match a suppressed identity. */
  suppressed: string[];
  /** Every suppressed identity key, so the CLI never proposes those shops again. */
  suppressionKeys: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Re-validates and stores the dossiers. `db` is the service client (injected so the rule is testable). */
export async function ingestGrowthProspects(body: unknown, db: Db, today: string = parisDay()): Promise<GrowthIngestResult> {
  const { targetSegment, prospects } = parseIngestBody(body);
  const { data: suppressionRows, error: suppressionError } = await db.from('growth_suppressions').select('identity_key');
  if (suppressionError) throw new GrowthIngestError('storage_unavailable', 503);
  const suppressionKeys: string[] = (suppressionRows ?? []).map((r: { identity_key: string }) => r.identity_key);
  const suppressedSet = new Set(suppressionKeys);

  const rejected: GrowthIngestResult['rejected'] = [];
  const suppressed: string[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const p of prospects) {
    let evaluation;
    try { evaluation = evaluateDossier(p.dossier, today, targetSegment); }
    catch { rejected.push({ id: p.id, errors: ['Fiche illisible.'] }); continue; }
    if (evaluation.status === 'respinta') { rejected.push({ id: p.id, errors: evaluation.errors.slice(0, 20) }); continue; }
    const keys = strongIdentityKeys(p.dossier);
    const match = keys.find((k) => suppressedSet.has(k));
    const d = p.dossier;
    rows.push({
      id: p.id,
      name: String(d.name).slice(0, 300),
      city: String(d.city).slice(0, 200),
      country: String(d.country).toUpperCase(),
      segment: String(d.segment).slice(0, 100),
      status: evaluation.status,
      separate_segment: evaluation.separate,
      fit_score: evaluation.fit.score,
      priority: ['A', 'B', 'C'].includes(d.priority?.level) ? d.priority.level : null,
      entry_kind: evaluation.entry.kind,
      entry_verified: evaluation.entry.verified,
      dossier: d,
      evaluation,
      identity_keys: keys,
      runs: p.runs,
      first_seen: p.firstSeen,
      last_seen: p.lastSeen,
      imported_at: new Date().toISOString(),
      // Sales fields are never written by an import; a suppressed identity only ever turns « do not contact » on.
      ...(match ? { do_not_contact: true, do_not_contact_reason: `Même commerce qu’une fiche exclue (${match}).` } : {}),
    });
    if (match) suppressed.push(p.id);
  }

  // Rows with and without the suppression columns go in separate upserts so an import never clears them.
  for (const batch of [rows.filter((r) => !('do_not_contact' in r)), rows.filter((r) => 'do_not_contact' in r)]) {
    if (!batch.length) continue;
    const { error } = await db.from('growth_prospects').upsert(batch, { onConflict: 'id' });
    if (error) throw new GrowthIngestError(/country|check/i.test(error.message ?? '') ? 'invalid_prospect' : 'storage_unavailable', /country|check/i.test(error.message ?? '') ? 400 : 503);
  }
  return { imported: rows.length, rejected, suppressed, suppressionKeys };
}
