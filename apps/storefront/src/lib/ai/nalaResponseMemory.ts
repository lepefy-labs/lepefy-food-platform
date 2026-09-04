import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Tenant } from '@lepefy/types';
import { decisionValidator, type NalaDecision } from '@/lib/ai/core/nalaDecision';
import type { NalaDeterministicSemanticEnrichment } from '@/lib/ai/nalaAnalytics';

export type NalaResponseMemoryQueryFamily =
  | 'definition'
  | 'recipe'
  | 'storage'
  | 'use'
  | 'delivery'
  | 'store_info'
  | 'general';

export interface NalaResponseMemorySignature {
  family: NalaResponseMemoryQueryFamily;
  normalizedQuery: string;
  terms: string[];
  lookupTerms: string[];
}

interface NalaResponseMemoryRow {
  id: string;
  locale: string;
  query_family: NalaResponseMemoryQueryFamily;
  normalized_query: string;
  query_terms: string[];
  intent: string;
  subject_key: string | null;
  reply: string;
  decision: unknown;
  tenant_version: string;
  knowledge_revision: string;
  context_product_versions: unknown;
  context_kb_versions: unknown;
  context_fingerprint: string;
  hit_count: number;
  expires_at: string;
}

export interface NalaResponseMemoryResolution {
  id: string;
  reply: string;
  decision: NalaDecision;
  subjectKey: string | null;
  contextKbIds: string[];
  matchScore: number;
}

interface CurrentContextSnapshot {
  tenantVersion: string;
  knowledgeRevision: string;
  productVersions: Record<string, string>;
  kbVersions: Record<string, string>;
}

interface PersistNalaResponseMemoryParams {
  supabase: SupabaseClient;
  tenant: Tenant;
  locale: string;
  message: string;
  reply: string;
  decision: NalaDecision;
  cartPlan: unknown;
  hadPendingAction: boolean;
  matchedProductIds: string[] | null;
  matchedKbIds: string[] | null;
  interactionId: string | null;
  sourceProvider: string;
  sourceModel: string;
}

const RESPONSE_MEMORY_TTL_DAYS = 30;
const MAX_CANDIDATES = 30;
const MAX_TERMS = 24;
const MAX_NORMALIZED_QUERY = 500;
const MIN_GENERAL_SCORE = 0.84;
const MIN_FAMILY_SCORE = 0.72;
const AMBIGUITY_GAP = 0.08;

const REUSABLE_INTENTS = new Set<NalaDecision['intent']>([
  'product_information',
  'meal_preparation',
  'delivery',
  'store_information',
]);

const STOP_WORDS = new Set([
  'a', 'ai', 'al', 'alla', 'alle', 'allo', 'anche', 'au', 'aux', 'avec', 'avez', 'avete',
  'ce', 'ces', 'che', 'chi', 'ci', 'come', 'comment', 'con', 'cosa', 'd', 'da', 'dans', 'de',
  'dei', 'del', 'della', 'delle', 'des', 'di', 'do', 'du', 'e', 'en', 'est', 'et', 'for', 'hai',
  'have', 'how', 'i', 'il', 'in', 'is', 'it', 'la', 'le', 'les', 'lo', 'mi', 'ne', 'nel', 'nella',
  'nous', 'of', 'on', 'per', 'pour', 'qu', 'que', 'quel', 'quelle', 'quels', 'quelles', 'qui',
  'si', 'su', 'the', 'to', 'un', 'una', 'une', 'uno', 'vous', 'what', 'with', 'you', 'your',
]);

const GENERIC_LOOKUP_TERMS = new Set([
  'definition', 'recipe', 'storage', 'use', 'delivery', 'store_info', 'time', 'cost', 'where',
]);

function normalizeBase(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectFamily(base: string): NalaResponseMemoryQueryFamily {
  if (/\b(qu est ce|c est quoi|what is|what are|cos e|che cos e|cosa e)\b/.test(base)) {
    return 'definition';
  }
  if (/\b(recette|cuisin\w*|cuir\w*|cuisson|prepar\w*|recipe|cook\w*|ricett\w*|cucin\w*|cottur\w*)\b/.test(base)) {
    return 'recipe';
  }
  if (/\b(conserv\w*|stockage|storage|how to store|keep|keeping|scaden\w*)\b/.test(base)) {
    return 'storage';
  }
  if (/\b(utilis\w*|sert|servir|usage|use|using|usare|utilizz\w*)\b/.test(base)) {
    return 'use';
  }
  if (/\b(livraison|livrer|livrez|delivery|deliver\w*|consegna|spedizion\w*)\b/.test(base)) {
    return 'delivery';
  }
  if (/\b(magasin|boutique|negozio|shop|adresse|address|indirizzo|parking)\b/.test(base)) {
    return 'store_info';
  }
  return 'general';
}

function canonicalFamilyTerm(family: NalaResponseMemoryQueryFamily): string | null {
  return family === 'general' ? null : family;
}

function semanticMarkers(base: string): string[] {
  const markers: string[] = [];
  if (/\b(combien|cout|coute|prix|cost|price|quanto costa|prezzo|costo)\b/.test(base)) markers.push('cost');
  if (/\b(quand|delai|duree|combien de temps|when|how long|tempo|quanto tempo)\b/.test(base)) markers.push('time');
  if (/\b(ou|where|dove)\b/.test(base)) markers.push('where');
  if (/\b(pas|non|not|never|jamais|mai)\b/.test(base)) markers.push('not');
  return markers;
}

function canonicalizeToken(token: string, family: NalaResponseMemoryQueryFamily): string {
  if (/^(recett|cuisin|cuir|cuisson|prepar|recipe|cook|ricett|cucin|cottur)/.test(token)) return 'recipe';
  if (/^(conserv|stockage|storage|keeping|scaden)/.test(token) || (token === 'store' && family === 'storage')) return 'storage';
  if (/^(utilis|servir|usage|using|utilizz)/.test(token) || token === 'sert' || token === 'use' || token === 'usare') return 'use';
  if (/^(livraison|livrer|livrez|delivery|deliver|consegna|spedizion)/.test(token)) return 'delivery';
  if ((token === 'store' || token === 'shop') && family === 'store_info') return 'store_info';
  return token;
}

function uniqueBounded(values: string[], max = MAX_TERMS): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, max);
}

export function buildNalaResponseMemorySignature(message: string): NalaResponseMemorySignature {
  const base = normalizeBase(message).slice(0, MAX_NORMALIZED_QUERY);
  const family = detectFamily(base);
  const familyTerm = canonicalFamilyTerm(family);
  const tokens = base
    .split(' ')
    .map((token) => canonicalizeToken(token, family))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
  const terms = uniqueBounded([
    ...(familyTerm ? [familyTerm] : []),
    ...semanticMarkers(base),
    ...tokens,
  ]);
  const normalizedQuery = terms.join(' ').slice(0, MAX_NORMALIZED_QUERY);
  const specific = terms.filter((term) => !GENERIC_LOOKUP_TERMS.has(term) && term !== 'not');
  return {
    family,
    normalizedQuery,
    terms,
    lookupTerms: uniqueBounded(specific.length > 0 ? specific : terms, 12),
  };
}

function subjectTerms(subject: string | null): string[] {
  if (!subject) return [];
  return uniqueBounded(
    normalizeBase(subject)
      .split(' ')
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
    8,
  );
}

function normalizedSubject(decision: NalaDecision): string | null {
  const raw = decision.subject?.name ?? decision.entities.product ?? decision.entities.dish;
  if (!raw) return null;
  const normalized = normalizeBase(raw).slice(0, 150);
  return normalized || null;
}

function containsPotentialSensitiveData(value: string): boolean {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) return true;
  if (/(?:\+?\d[\s().-]*){8,}/.test(value)) return true;
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(value)) return true;
  if (/\b(?:commande|order|ordine)\s*(?:n[°ºo.]?\s*)?[A-Z0-9-]{4,}\b/i.test(value)) return true;
  if (/\b(?:iban|carte bancaire|credit card|carta di credito)\b/i.test(value)) return true;
  return false;
}

function containsDynamicMoneyValue(value: string): boolean {
  return /(?:€|£|\$)\s*\d|\d+(?:[.,]\d{1,2})?\s*(?:€|£|\$)|\b\d+(?:[.,]\d{1,2})?\s*(?:eur|usd|chf|gbp)\b/i.test(value);
}

function containsUncertainAnswer(value: string): boolean {
  return /\b(?:je ne sais pas|je ne suis pas sur|peut etre|probablement|i don t know|i am not sure|might be|non lo so|non sono sicur|forse)\b/i
    .test(normalizeBase(value));
}

export function canPersistNalaResponseMemory(params: {
  message: string;
  reply: string;
  decision: NalaDecision;
  cartPlan: unknown;
  hadPendingAction: boolean;
  sourceProvider: string;
}): boolean {
  if (!params.sourceProvider || params.sourceProvider === 'lepefy') return false;
  if (!REUSABLE_INTENTS.has(params.decision.intent)) return false;
  if (params.decision.commerceMode !== 'none' || params.decision.pendingAction !== null) return false;
  if (params.cartPlan !== null || params.hadPendingAction) return false;
  if (containsPotentialSensitiveData(params.message) || containsPotentialSensitiveData(params.reply)) return false;
  if (containsDynamicMoneyValue(params.reply) || containsUncertainAnswer(params.reply)) return false;

  const signature = buildNalaResponseMemorySignature(params.message);
  if (signature.terms.length < 2 || !signature.normalizedQuery) return false;

  const subject = normalizedSubject(params.decision);
  const requiredSubjectTerms = subjectTerms(subject);
  if (requiredSubjectTerms.length > 0
    && !requiredSubjectTerms.every((term) => signature.terms.includes(term))) {
    return false;
  }
  if (requiredSubjectTerms.length === 0 && signature.family === 'general' && signature.terms.length < 3) {
    return false;
  }
  return true;
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function sameInstant(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

function contextFingerprint(params: {
  tenantVersion: string;
  knowledgeRevision: string;
  productVersions: Record<string, string>;
  kbVersions: Record<string, string>;
}): string {
  const ordered = {
    tenantVersion: params.tenantVersion,
    knowledgeRevision: params.knowledgeRevision,
    productVersions: Object.fromEntries(Object.entries(params.productVersions).sort(([a], [b]) => a.localeCompare(b))),
    kbVersions: Object.fromEntries(Object.entries(params.kbVersions).sort(([a], [b]) => a.localeCompare(b))),
  };
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

export function scoreNalaResponseMemoryCandidate(
  signature: NalaResponseMemorySignature,
  candidate: Pick<NalaResponseMemoryRow, 'query_family' | 'normalized_query' | 'query_terms' | 'subject_key'>,
): number {
  if (candidate.query_family !== signature.family) return 0;
  const candidateTerms = uniqueBounded(candidate.query_terms ?? []);
  if (candidateTerms.length === 0 || signature.terms.length === 0) return 0;

  const requiredSubjectTerms = subjectTerms(candidate.subject_key);
  if (requiredSubjectTerms.length > 0
    && !requiredSubjectTerms.every((term) => signature.terms.includes(term))) {
    return 0;
  }

  if (candidate.normalized_query === signature.normalizedQuery) return 1;

  const current = new Set(signature.terms);
  const stored = new Set(candidateTerms);
  const common = [...current].filter((term) => stored.has(term)).length;
  if (common === 0) return 0;
  const union = new Set([...current, ...stored]).size;
  const containment = common / Math.min(current.size, stored.size);
  const jaccard = common / union;
  const subjectBonus = requiredSubjectTerms.length > 0 ? 0.08 : 0;
  return Math.min(1, 0.62 * containment + 0.38 * jaccard + subjectBonus);
}

function minScoreForFamily(family: NalaResponseMemoryQueryFamily): number {
  return family === 'general' ? MIN_GENERAL_SCORE : MIN_FAMILY_SCORE;
}

function memorySchemaUnavailable(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  return code === '42P01' || code === '42703' || code === 'PGRST202'
    || code === 'PGRST204' || code === 'PGRST205';
}

async function loadKnowledgeRevision(supabase: SupabaseClient, tenantId: string): Promise<string> {
  const { data, error, count } = await supabase
    .from('tenant_knowledge_base')
    .select('updated_at', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const latest = (data?.[0] as { updated_at?: string } | undefined)?.updated_at ?? 'none';
  return `${count ?? 0}:${latest}`;
}

async function loadContextSnapshot(params: {
  supabase: SupabaseClient;
  tenant: Tenant;
  candidates: NalaResponseMemoryRow[];
}): Promise<CurrentContextSnapshot> {
  const productIds = uniqueBounded(
    params.candidates.flatMap((candidate) => Object.keys(asStringRecord(candidate.context_product_versions))),
    200,
  );
  const kbIds = uniqueBounded(
    params.candidates.flatMap((candidate) => Object.keys(asStringRecord(candidate.context_kb_versions))),
    200,
  );

  const [productsResult, kbResult, knowledgeRevision] = await Promise.all([
    productIds.length > 0
      ? params.supabase.from('products').select('id, updated_at').eq('tenant_id', params.tenant.id).in('id', productIds)
      : Promise.resolve({ data: [], error: null }),
    kbIds.length > 0
      ? params.supabase.from('tenant_knowledge_base').select('id, updated_at, active')
        .eq('tenant_id', params.tenant.id).in('id', kbIds)
      : Promise.resolve({ data: [], error: null }),
    loadKnowledgeRevision(params.supabase, params.tenant.id),
  ]);

  if (productsResult.error) throw productsResult.error;
  if (kbResult.error) throw kbResult.error;

  const productVersions: Record<string, string> = {};
  for (const row of (productsResult.data ?? []) as Array<{ id: string; updated_at: string }>) {
    productVersions[row.id] = row.updated_at;
  }
  const kbVersions: Record<string, string> = {};
  for (const row of (kbResult.data ?? []) as Array<{ id: string; updated_at: string; active: boolean }>) {
    if (row.active) kbVersions[row.id] = row.updated_at;
  }

  return {
    tenantVersion: params.tenant.updated_at,
    knowledgeRevision,
    productVersions,
    kbVersions,
  };
}

export function isNalaResponseMemoryContextFresh(
  candidate: Pick<NalaResponseMemoryRow,
    'tenant_version' | 'knowledge_revision' | 'context_product_versions' | 'context_kb_versions' | 'context_fingerprint'>,
  current: CurrentContextSnapshot,
): boolean {
  if (!sameInstant(candidate.tenant_version, current.tenantVersion)) return false;
  if (candidate.knowledge_revision !== current.knowledgeRevision) return false;

  const expectedProducts = asStringRecord(candidate.context_product_versions);
  const expectedKb = asStringRecord(candidate.context_kb_versions);
  for (const [id, version] of Object.entries(expectedProducts)) {
    if (!current.productVersions[id] || !sameInstant(version, current.productVersions[id])) return false;
  }
  for (const [id, version] of Object.entries(expectedKb)) {
    if (!current.kbVersions[id] || !sameInstant(version, current.kbVersions[id])) return false;
  }

  const currentProductVersions = Object.fromEntries(
    Object.keys(expectedProducts).map((id): [string, string] => [id, current.productVersions[id]!] ),
  );
  const currentKbVersions = Object.fromEntries(
    Object.keys(expectedKb).map((id): [string, string] => [id, current.kbVersions[id]!] ),
  );
  return candidate.context_fingerprint === contextFingerprint({
    tenantVersion: current.tenantVersion,
    knowledgeRevision: current.knowledgeRevision,
    productVersions: currentProductVersions,
    kbVersions: currentKbVersions,
  });
}

export async function resolveNalaResponseMemory(params: {
  supabase: SupabaseClient;
  tenant: Tenant;
  locale: string;
  message: string;
}): Promise<NalaResponseMemoryResolution | null> {
  const signature = buildNalaResponseMemorySignature(params.message);
  if (!signature.normalizedQuery || signature.terms.length < 2 || signature.lookupTerms.length === 0) return null;

  try {
    const now = new Date().toISOString();
    const { data, error } = await params.supabase
      .from('nala_response_memory')
      .select('id, locale, query_family, normalized_query, query_terms, intent, subject_key, reply, decision, tenant_version, knowledge_revision, context_product_versions, context_kb_versions, context_fingerprint, hit_count, expires_at')
      .eq('tenant_id', params.tenant.id)
      .eq('locale', params.locale)
      .eq('query_family', signature.family)
      .eq('active', true)
      .gt('expires_at', now)
      .overlaps('query_terms', signature.lookupTerms)
      .order('hit_count', { ascending: false })
      .limit(MAX_CANDIDATES);

    if (error) throw error;
    const rows = (data ?? []) as NalaResponseMemoryRow[];
    if (rows.length === 0) return null;

    const scored = rows
      .map((row) => ({ row, score: scoreNalaResponseMemoryCandidate(signature, row) }))
      .filter(({ score }) => score >= minScoreForFamily(signature.family))
      .sort((a, b) => b.score - a.score || b.row.hit_count - a.row.hit_count);
    if (scored.length === 0) return null;

    const context = await loadContextSnapshot({
      supabase: params.supabase,
      tenant: params.tenant,
      candidates: scored.slice(0, 8).map(({ row }) => row),
    });

    const staleIds: string[] = [];
    const fresh = scored.slice(0, 8).flatMap(({ row, score }) => {
      const parsed = decisionValidator.safeParse(row.decision);
      if (!parsed.success || parsed.data.intent !== row.intent
        || parsed.data.commerceMode !== 'none' || parsed.data.pendingAction !== null) {
        staleIds.push(row.id);
        return [];
      }
      if (!isNalaResponseMemoryContextFresh(row, context)) {
        staleIds.push(row.id);
        return [];
      }
      return [{ row, score, decision: parsed.data }];
    });

    if (staleIds.length > 0) {
      await params.supabase.from('nala_response_memory')
        .update({ active: false })
        .eq('tenant_id', params.tenant.id)
        .in('id', staleIds)
        .then(() => undefined, () => undefined);
    }
    if (fresh.length === 0) return null;

    const best = fresh[0];
    const second = fresh[1];
    if (!best) return null;
    if (second && best.score - second.score < AMBIGUITY_GAP && second.row.reply !== best.row.reply) {
      return null;
    }

    await params.supabase.rpc('touch_nala_response_memory', {
      p_tenant_id: params.tenant.id,
      p_memory_id: best.row.id,
    }).then(() => undefined, () => undefined);

    return {
      id: best.row.id,
      reply: best.row.reply,
      decision: best.decision,
      subjectKey: best.row.subject_key,
      contextKbIds: Object.keys(asStringRecord(best.row.context_kb_versions)),
      matchScore: best.score,
    };
  } catch (error) {
    if (!memorySchemaUnavailable(error)) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? 'unknown')
        : 'unknown';
      console.error('[nala-response-memory] Lookup failed; falling through to normal AI routing.', {
        tenantId: params.tenant.id,
        code,
      });
    }
    return null;
  }
}

async function loadVersionMaps(params: {
  supabase: SupabaseClient;
  tenantId: string;
  productIds: string[];
  kbIds: string[];
}): Promise<{ productVersions: Record<string, string>; kbVersions: Record<string, string> }> {
  const productIds = [...new Set(params.productIds)].slice(0, 12);
  const kbIds = [...new Set(params.kbIds)].slice(0, 8);
  const [productsResult, kbResult] = await Promise.all([
    productIds.length > 0
      ? params.supabase.from('products').select('id, updated_at').eq('tenant_id', params.tenantId).in('id', productIds)
      : Promise.resolve({ data: [], error: null }),
    kbIds.length > 0
      ? params.supabase.from('tenant_knowledge_base').select('id, updated_at, active')
        .eq('tenant_id', params.tenantId).in('id', kbIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (kbResult.error) throw kbResult.error;

  const productVersions = Object.fromEntries(
    ((productsResult.data ?? []) as Array<{ id: string; updated_at: string }>).map((row) => [row.id, row.updated_at]),
  );
  const kbVersions = Object.fromEntries(
    ((kbResult.data ?? []) as Array<{ id: string; updated_at: string; active: boolean }>)
      .filter((row) => row.active)
      .map((row) => [row.id, row.updated_at]),
  );
  if (Object.keys(productVersions).length !== productIds.length || Object.keys(kbVersions).length !== kbIds.length) {
    throw new Error('context_changed');
  }
  return { productVersions, kbVersions };
}

export async function persistNalaResponseMemory(params: PersistNalaResponseMemoryParams): Promise<void> {
  if (!canPersistNalaResponseMemory(params)) return;

  const signature = buildNalaResponseMemorySignature(params.message);
  const subjectKey = normalizedSubject(params.decision);
  try {
    const [versions, knowledgeRevision] = await Promise.all([
      loadVersionMaps({
        supabase: params.supabase,
        tenantId: params.tenant.id,
        productIds: params.matchedProductIds ?? [],
        kbIds: params.matchedKbIds ?? [],
      }),
      loadKnowledgeRevision(params.supabase, params.tenant.id),
    ]);
    const fingerprint = contextFingerprint({
      tenantVersion: params.tenant.updated_at,
      knowledgeRevision,
      productVersions: versions.productVersions,
      kbVersions: versions.kbVersions,
    });
    const expiresAt = new Date(Date.now() + RESPONSE_MEMORY_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await params.supabase.from('nala_response_memory').upsert({
      tenant_id: params.tenant.id,
      locale: params.locale,
      query_family: signature.family,
      normalized_query: signature.normalizedQuery,
      query_terms: signature.terms,
      intent: params.decision.intent,
      subject_key: subjectKey,
      reply: params.reply,
      decision: params.decision,
      tenant_version: params.tenant.updated_at,
      knowledge_revision: knowledgeRevision,
      context_product_versions: versions.productVersions,
      context_kb_versions: versions.kbVersions,
      context_fingerprint: fingerprint,
      source_interaction_id: params.interactionId,
      source_provider: params.sourceProvider.slice(0, 100),
      source_model: params.sourceModel.slice(0, 160),
      active: true,
      expires_at: expiresAt,
      hit_count: 0,
      last_used_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,locale,normalized_query' });
    if (error) throw error;
  } catch (error) {
    if (!memorySchemaUnavailable(error) && !(error instanceof Error && error.message === 'context_changed')) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? 'unknown')
        : 'unknown';
      console.error('[nala-response-memory] Safe answer was not persisted; chat response remains valid.', {
        tenantId: params.tenant.id,
        code,
      });
    }
  }
}

export function semanticEnrichmentForNalaResponseMemory(
  resolution: NalaResponseMemoryResolution,
): NalaDeterministicSemanticEnrichment {
  const intent = resolution.decision.intent === 'meal_preparation'
    ? 'recipe'
    : resolution.decision.intent === 'product_information'
      ? 'product_information'
      : resolution.decision.intent === 'delivery'
        ? 'delivery'
        : 'store_information';
  return {
    intent,
    intentConfidence: Math.round(resolution.matchScore * 100) / 100,
    demandStatus: 'fulfilled',
    retrievalQuality: 'not_applicable',
    knowledgeStatus: resolution.contextKbIds.length > 0 ? 'sufficient' : 'missing',
    requestedProductText: intent === 'product_information' ? resolution.subjectKey : null,
    version: 'response_memory_v1',
  };
}

export async function purgeExpiredNalaResponseMemory(supabase: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('purge_expired_nala_response_memory');
    if (error) throw error;
    const count = typeof data === 'number'
      ? data
      : typeof data === 'string' && /^(0|[1-9][0-9]*)$/.test(data) ? Number(data) : NaN;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('invalid_purge_result');
    return count;
  } catch (error) {
    if (memorySchemaUnavailable(error)) return 0;
    throw new Error('response_memory_maintenance_failed');
  }
}
