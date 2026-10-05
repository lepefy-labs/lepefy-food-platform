import type { SupabaseClient } from '@supabase/supabase-js';
import { KNOWLEDGE_INTENTS } from './knowledgeSuggestions';
import {
  activityBuckets,
  bucketIndexFor,
  bucketSizeFor,
  conversionFunnel,
  distinctConversationKeys,
  isCountableOrder,
  percent,
  redactMessage,
  type ActivityBucket,
  type AttributedOrder,
  type BucketSize,
  type FunnelStep,
} from './nalaAnalyticsRules';

export type NalaDashboardRange = 7 | 30 | 90;

export interface NalaIntentMetric {
  key: string;
  label: string;
  count: number;
  share: number;
}

export interface NalaMessageExample {
  text: string;
  at: string;
}

export interface NalaDemandMetric {
  label: string;
  count: number;
  example: string | null;
}

export interface NalaRelationshipMetric {
  key: string;
  label: string;
  count: number;
}

export interface NalaAnalyticsDashboard {
  rangeDays: NalaDashboardRange;
  since: string;
  currency: string;
  sessions: number;
  interactions: number;
  funnel: FunnelStep[];
  orderCount: number;
  assistedRevenue: number;
  /** Paid attributed orders left out (test, cancelled or refunded). */
  excludedOrders: number;
  unmetDemand: number;
  unmetDemandRate: number;
  knowledgeGaps: number;
  knowledgeGapExamples: NalaMessageExample[];
  retrievalIssues: number;
  retrievalIssueExamples: NalaMessageExample[];
  cartBuilderProposals: number;
  cartBuilderAccepted: number;
  cartBuilderAcceptanceRate: number;
  enrichedInteractions: number;
  enrichmentCoverage: number;
  intents: NalaIntentMetric[];
  unmetRequests: NalaDemandMetric[];
  relationshipTypes: NalaRelationshipMetric[];
  bucketSize: BucketSize;
  activity: ActivityBucket[];
}

interface InteractionRow {
  id: string;
  session_id: string;
  message_text: string | null;
  intent: string | null;
  outcome: string;
  demand_status: string | null;
  retrieval_quality: string | null;
  knowledge_status: string | null;
  requested_product_text: string | null;
  action_product_ids: string[] | null;
  action_relationship_types: string[] | null;
  semantic_enrichment_status: string;
  created_at: string;
}

interface ConversionRow {
  event_type: 'add_to_cart' | 'checkout_started' | 'purchase_completed';
  checkout_session_id: string | null;
  order_id: string | null;
  assisted_value: number | string | null;
  currency: string | null;
  nala_session_id: string | null;
  nala_interaction_id: string | null;
  occurred_at: string;
}

const PAGE_SIZE = 1000;
const ORDER_CHUNK = 200;
const EXAMPLES = 5;

const INTENT_LABELS: Record<string, string> = {
  product_search: 'Recherche produit',
  product_information: 'Info produit',
  availability: 'Disponibilité',
  price: 'Prix',
  recommendation: 'Recommandation',
  substitution: 'Alternative',
  recipe: 'Recette / panier',
  delivery: 'Livraison',
  store_information: 'Infos boutique',
  event_information: 'Événements',
  order_help: 'Aide commande',
  payment_help: 'Aide paiement',
  complaint: 'Réclamation',
  small_talk: 'Conversation libre',
  other: 'Autre',
  unknown: 'Pas encore analysé',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  direct: 'Produit demandé',
  similar: 'Produit similaire',
  substitute: 'Alternative',
  complementary: 'Produit complémentaire',
};

export function parseNalaDashboardRange(value: string | string[] | undefined): NalaDashboardRange {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === '7' || raw === '90' ? Number(raw) as NalaDashboardRange : 30;
}

function topCounts(values: string[], labels: Record<string, string>, limit = 6): Array<{ key: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, label: labels[key] ?? key, count }));
}

function topDemand(rows: InteractionRow[], limit = 8): NalaDemandMetric[] {
  const counts = new Map<string, NalaDemandMetric>();
  // Newest first so the example is the most recent message.
  for (const row of [...rows].reverse()) {
    const label = row.requested_product_text?.trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase('fr');
    const current = counts.get(key);
    counts.set(key, {
      label: current?.label ?? label,
      count: (current?.count ?? 0) + 1,
      example: current?.example ?? (redactMessage(row.message_text) || null),
    });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'))
    .slice(0, limit);
}

function latestExamples(rows: InteractionRow[]): NalaMessageExample[] {
  return [...rows]
    .reverse()
    .map((row) => ({ text: redactMessage(row.message_text), at: row.created_at }))
    .filter((example) => example.text)
    .slice(0, EXAMPLES);
}

async function loadInteractions(supabase: SupabaseClient, tenantId: string, since: string): Promise<InteractionRow[]> {
  const rows: InteractionRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('nala_interactions')
      .select('id, session_id, message_text, intent, outcome, demand_status, retrieval_quality, knowledge_status, requested_product_text, action_product_ids, action_relationship_types, semantic_enrichment_status, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Unable to load Nala interactions: ${error.message}`);
    const page = (data ?? []) as InteractionRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function loadConversions(supabase: SupabaseClient, tenantId: string, since: string): Promise<ConversionRow[]> {
  const rows: ConversionRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('nala_conversion_events')
      .select('event_type, checkout_session_id, order_id, assisted_value, currency, nala_session_id, nala_interaction_id, occurred_at')
      .eq('tenant_id', tenantId)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Unable to load Nala conversions: ${error.message}`);
    const page = (data ?? []) as ConversionRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** One query per 200 attributed orders (never per row), tenant-scoped. */
async function loadAttributedOrders(supabase: SupabaseClient, tenantId: string, orderIds: string[]): Promise<Map<string, AttributedOrder>> {
  const orders = new Map<string, AttributedOrder>();
  for (let index = 0; index < orderIds.length; index += ORDER_CHUNK) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, is_test, status, payment_status')
      .eq('tenant_id', tenantId)
      .in('id', orderIds.slice(index, index + ORDER_CHUNK));
    if (error) throw new Error(`Unable to load attributed orders: ${error.message}`);
    for (const row of (data ?? []) as Array<AttributedOrder & { id: string }>) orders.set(row.id, row);
  }
  return orders;
}

export async function loadNalaAnalyticsDashboard(params: {
  supabase: SupabaseClient;
  tenantId: string;
  rangeDays: NalaDashboardRange;
  fallbackCurrency: string;
  now?: Date;
}): Promise<NalaAnalyticsDashboard> {
  const now = params.now ?? new Date();
  const since = new Date(now.getTime() - params.rangeDays * 24 * 60 * 60 * 1000).toISOString();

  const [sessionsResult, interactions, conversions] = await Promise.all([
    params.supabase
      .from('nala_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', params.tenantId)
      .gte('started_at', since),
    loadInteractions(params.supabase, params.tenantId, since),
    loadConversions(params.supabase, params.tenantId, since),
  ]);

  if (sessionsResult.error) throw new Error(`Unable to count Nala sessions: ${sessionsResult.error.message}`);
  const sessionCount = sessionsResult.count ?? 0;

  const unmetRows = interactions.filter((row) => row.demand_status === 'unmet');
  // Same scope as the AI-lab suggestions: questions a knowledge entry can answer (product searches → unmet demand).
  const knowledgeGapRows = interactions.filter((row) => row.knowledge_status === 'missing' && KNOWLEDGE_INTENTS.has(row.intent ?? ''));
  const retrievalIssueRows = interactions.filter((row) => row.retrieval_quality === 'weak' || row.retrieval_quality === 'empty');
  const enrichedRows = interactions.filter((row) => row.semantic_enrichment_status === 'completed');

  const purchaseRows = conversions.filter((row) => row.event_type === 'purchase_completed' && row.order_id);
  const orders = await loadAttributedOrders(
    params.supabase,
    params.tenantId,
    [...new Set(purchaseRows.map((row) => row.order_id as string))],
  );
  const countedPurchases = purchaseRows.filter((row) => isCountableOrder(orders.get(row.order_id as string)));
  const countedOrderIds = new Set(countedPurchases.map((row) => row.order_id as string));
  const excludedOrders = new Set(purchaseRows.map((row) => row.order_id as string)).size - countedOrderIds.size;
  const assistedRevenue = countedPurchases.reduce((sum, row) => sum + Number(row.assisted_value ?? 0), 0);
  const currency = countedPurchases.find((row) => row.currency)?.currency ?? params.fallbackCurrency.toUpperCase();

  const addToCart = conversions.filter((row) => row.event_type === 'add_to_cart');
  const checkouts = conversions.filter((row) => row.event_type === 'checkout_started');
  const funnel = conversionFunnel({
    conversations: sessionCount,
    cart: distinctConversationKeys(addToCart),
    checkout: distinctConversationKeys(checkouts),
    order: distinctConversationKeys(countedPurchases),
  });

  const recipeRows = interactions.filter((row) => row.intent === 'recipe' && (row.action_product_ids?.length ?? 0) > 0);
  const recipeInteractionIds = new Set(recipeRows.map((row) => row.id));
  const acceptedRecipeInteractions = new Set(addToCart.flatMap((row) => row.nala_interaction_id && recipeInteractionIds.has(row.nala_interaction_id) ? [row.nala_interaction_id] : []));

  const intents: NalaIntentMetric[] = topCounts(interactions.map((row) => row.intent ?? 'unknown'), INTENT_LABELS)
    .map((item) => ({ ...item, share: percent(item.count, interactions.length) }));

  const relationshipTypes = topCounts(
    interactions.flatMap((row) => row.action_relationship_types ?? []),
    RELATIONSHIP_LABELS,
    4,
  );

  const activity = activityBuckets(params.rangeDays, now);
  for (const interaction of interactions) {
    const index = bucketIndexFor(activity, interaction.created_at);
    const bucket = activity[index];
    if (bucket) bucket.interactions += 1;
  }
  for (const purchase of countedPurchases) {
    const index = bucketIndexFor(activity, purchase.occurred_at);
    const bucket = activity[index];
    if (bucket) bucket.assistedRevenue += Number(purchase.assisted_value ?? 0);
  }

  return {
    rangeDays: params.rangeDays,
    since,
    currency,
    sessions: sessionCount,
    interactions: interactions.length,
    funnel,
    orderCount: countedOrderIds.size,
    assistedRevenue: Math.round(assistedRevenue * 100) / 100,
    excludedOrders,
    unmetDemand: unmetRows.length,
    unmetDemandRate: percent(unmetRows.length, interactions.length),
    knowledgeGaps: knowledgeGapRows.length,
    knowledgeGapExamples: latestExamples(knowledgeGapRows),
    retrievalIssues: retrievalIssueRows.length,
    retrievalIssueExamples: latestExamples(retrievalIssueRows),
    cartBuilderProposals: recipeRows.length,
    cartBuilderAccepted: acceptedRecipeInteractions.size,
    cartBuilderAcceptanceRate: percent(acceptedRecipeInteractions.size, recipeRows.length),
    enrichedInteractions: enrichedRows.length,
    enrichmentCoverage: percent(enrichedRows.length, interactions.length),
    intents,
    unmetRequests: topDemand(unmetRows),
    relationshipTypes,
    bucketSize: bucketSizeFor(params.rangeDays),
    activity,
  };
}
