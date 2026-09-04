import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  KnowledgeBaseCategory,
  KnowledgeBaseSuggestion,
  KnowledgeSuggestionSignal,
} from '@lepefy/types';

export const KNOWLEDGE_SUGGESTION_SOURCE_PREFIX = 'nala_suggestion:';

const LOOKBACK_DAYS = 90;
const MAX_INTERACTIONS = 500;
const MAX_SUGGESTIONS = 10;
const MAX_QUESTION_PREVIEW = 160;
const MAX_PROPOSED_CONTENT = 1200;

const ELIGIBLE_INTENTS = new Set([
  'product_information',
  'recipe',
  'delivery',
  'store_information',
  'event_information',
]);

export interface KnowledgeSuggestionInteractionRow {
  id: string;
  message_text: string;
  reply_text: string | null;
  intent: string | null;
  knowledge_status: string | null;
  retrieval_quality: string | null;
  requested_product_text: string | null;
  semantic_enrichment_status: string;
  outcome: string;
  created_at: string;
}

interface SuggestionGroup {
  key: string;
  intent: string;
  category: KnowledgeBaseCategory;
  questionPreview: string;
  proposedContent: string;
  occurrenceCount: number;
  signals: Set<KnowledgeSuggestionSignal>;
  latestAt: string;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPotentialPersonalData(value: string): boolean {
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)) return true;
  if (/(?:\+?\d[\s().-]*){8,}/.test(value)) return true;
  if (/\b(?:commande|order|ordine)\s*(?:n[°ºo.]?\s*)?[A-Z0-9-]{5,}\b/i.test(value)) return true;
  return false;
}

function cleanPreview(value: string, maxLength: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function categoryForIntent(intent: string): KnowledgeBaseCategory {
  return intent === 'recipe' ? 'recipe' : 'faq';
}

function suggestionSignals(row: KnowledgeSuggestionInteractionRow): KnowledgeSuggestionSignal[] {
  const signals: KnowledgeSuggestionSignal[] = [];
  if (row.knowledge_status === 'missing') signals.push('knowledge_missing');
  if (row.retrieval_quality === 'weak') signals.push('retrieval_weak');
  if (row.retrieval_quality === 'empty') signals.push('retrieval_empty');
  return signals;
}

function clusterSeed(row: KnowledgeSuggestionInteractionRow, intent: string): string {
  const requested = row.requested_product_text?.trim();
  if (requested) return `${intent}|topic|${normalize(requested).slice(0, 160)}`;
  return `${intent}|question|${normalize(row.message_text).slice(0, 200)}`;
}

function fingerprint(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

export function knowledgeSuggestionSource(key: string): string {
  return `${KNOWLEDGE_SUGGESTION_SOURCE_PREFIX}${key}`;
}

/**
 * Builds review-only knowledge drafts from bounded Nala analytics rows.
 * Nothing returned here is authoritative until a tenant admin explicitly approves it.
 */
export function buildKnowledgeBaseSuggestions(params: {
  rows: KnowledgeSuggestionInteractionRow[];
  existingSources?: Array<string | null>;
}): KnowledgeBaseSuggestion[] {
  const existingSources = new Set((params.existingSources ?? []).filter((source): source is string => Boolean(source)));
  const groups = new Map<string, SuggestionGroup>();

  const rows = [...params.rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const row of rows) {
    if (row.semantic_enrichment_status !== 'completed') continue;
    if (row.outcome !== 'answered' && row.outcome !== 'retrieval_empty') continue;

    const intent = row.intent ?? '';
    if (!ELIGIBLE_INTENTS.has(intent)) continue;

    const signals = suggestionSignals(row);
    if (signals.length === 0) continue;

    const message = row.message_text?.trim() ?? '';
    const reply = row.reply_text?.trim() ?? '';
    if (message.length < 2 || reply.length < 8) continue;

    // Knowledge review is not a backdoor into raw customer-support transcripts.
    // Skip rows that look like they contain direct personal/contact/order identifiers.
    if (containsPotentialPersonalData(message) || containsPotentialPersonalData(reply)) continue;

    const seed = clusterSeed(row, intent);
    if (!seed || seed.endsWith('|question|')) continue;
    const key = fingerprint(seed);
    if (existingSources.has(knowledgeSuggestionSource(key))) continue;

    const current = groups.get(key);
    if (current) {
      current.occurrenceCount += 1;
      signals.forEach((signal) => current.signals.add(signal));
      continue;
    }

    groups.set(key, {
      key,
      intent,
      category: categoryForIntent(intent),
      questionPreview: cleanPreview(message, MAX_QUESTION_PREVIEW),
      proposedContent: cleanPreview(reply, MAX_PROPOSED_CONTENT),
      occurrenceCount: 1,
      signals: new Set(signals),
      latestAt: row.created_at,
    });
  }

  return [...groups.values()]
    .sort((a, b) => {
      const aMissing = a.signals.has('knowledge_missing') ? 1 : 0;
      const bMissing = b.signals.has('knowledge_missing') ? 1 : 0;
      return bMissing - aMissing
        || b.occurrenceCount - a.occurrenceCount
        || b.latestAt.localeCompare(a.latestAt)
        || a.key.localeCompare(b.key);
    })
    .slice(0, MAX_SUGGESTIONS)
    .map((group) => ({
      key: group.key,
      intent: group.intent,
      category: group.category,
      questionPreview: group.questionPreview,
      proposedContent: group.proposedContent,
      occurrenceCount: group.occurrenceCount,
      signals: [...group.signals].sort(),
      latestAt: group.latestAt,
    }));
}

export async function loadKnowledgeBaseSuggestions(params: {
  supabase: SupabaseClient;
  tenantId: string;
  existingSources?: Array<string | null>;
}): Promise<KnowledgeBaseSuggestion[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await params.supabase
      .from('nala_interactions')
      .select('id, message_text, reply_text, intent, knowledge_status, retrieval_quality, requested_product_text, semantic_enrichment_status, outcome, created_at')
      .eq('tenant_id', params.tenantId)
      .eq('semantic_enrichment_status', 'completed')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_INTERACTIONS);

    if (error) throw new Error(error.message);

    return buildKnowledgeBaseSuggestions({
      rows: (data ?? []) as KnowledgeSuggestionInteractionRow[],
      existingSources: params.existingSources,
    });
  } catch (error) {
    console.error('[knowledge-suggestions] Unable to derive tenant review candidates; keeping manual knowledge available.', {
      tenantId: params.tenantId,
      error,
    });
    return [];
  }
}
