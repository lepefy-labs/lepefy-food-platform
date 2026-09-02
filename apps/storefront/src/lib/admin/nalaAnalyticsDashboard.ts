import type { SupabaseClient } from '@supabase/supabase-js';

export type NalaDashboardRange = 7 | 30 | 90;

export interface NalaIntentMetric {
  key: string;
  label: string;
  count: number;
  share: number;
}

export interface NalaDemandMetric {
  label: string;
  count: number;
}

export interface NalaRelationshipMetric {
  key: string;
  label: string;
  count: number;
}

export interface NalaDailyMetric {
  key: string;
  label: string;
  interactions: number;
  assistedRevenue: number;
}

export interface NalaAnalyticsDashboard {
  rangeDays: NalaDashboardRange;
  since: string;
  currency: string;
  sessions: number;
  interactions: number;
  unmetDemand: number;
  unmetDemandRate: number;
  knowledgeGaps: number;
  retrievalIssues: number;
  addToCartEvents: number;
  checkoutCount: number;
  orderCount: number;
  assistedRevenue: number;
  assistedOrderRate: number;
  cartBuilderProposals: number;
  cartBuilderAccepted: number;
  cartBuilderAcceptanceRate: number;
  enrichedInteractions: number;
  enrichmentCoverage: number;
  intents: NalaIntentMetric[];
  unmetRequests: NalaDemandMetric[];
  relationshipTypes: NalaRelationshipMetric[];
  daily: NalaDailyMetric[];
}

interface InteractionRow {
  id: string;
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
  nala_interaction_id: string | null;
  occurred_at: string;
}

const PAGE_SIZE = 1000;

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
  event_information: 'Événementiel',
  order_help: 'Aide commande',
  payment_help: 'Aide paiement',
  complaint: 'Réclamation',
  small_talk: 'Conversation',
  other: 'Autre',
  unknown: 'Non classé',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  direct: 'Produit direct',
  similar: 'Produit similaire',
  substitute: 'Alternative',
  complementary: 'Complémentaire',
};

export function parseNalaDashboardRange(value: string | string[] | undefined): NalaDashboardRange {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === '7' || raw === '90' ? Number(raw) as NalaDashboardRange : 30;
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function topCounts(values: string[], labels: Record<string, string>, limit = 6): Array<{ key: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, label: labels[key] ?? key, count }));
}

function topDemand(values: Array<string | null>, limit = 8): NalaDemandMetric[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const raw of values) {
    const label = raw?.trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase('fr');
    const current = counts.get(key);
    counts.set(key, { label: current?.label ?? label, count: (current?.count ?? 0) + 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'))
    .slice(0, limit);
}

async function loadInteractions(supabase: SupabaseClient, tenantId: string, since: string): Promise<InteractionRow[]> {
  const rows: InteractionRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('nala_interactions')
      .select('id, intent, outcome, demand_status, retrieval_quality, knowledge_status, requested_product_text, action_product_ids, action_relationship_types, semantic_enrichment_status, created_at')
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
      .select('event_type, checkout_session_id, order_id, assisted_value, currency, nala_interaction_id, occurred_at')
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

export async function loadNalaAnalyticsDashboard(params: {
  supabase: SupabaseClient;
  tenantId: string;
  rangeDays: NalaDashboardRange;
  fallbackCurrency: string;
}): Promise<NalaAnalyticsDashboard> {
  const sinceDate = new Date(Date.now() - params.rangeDays * 24 * 60 * 60 * 1000);
  const since = sinceDate.toISOString();

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
  const knowledgeGapRows = interactions.filter((row) => row.knowledge_status === 'missing');
  const retrievalIssueRows = interactions.filter((row) => row.retrieval_quality === 'weak' || row.retrieval_quality === 'empty');
  const enrichedRows = interactions.filter((row) => row.semantic_enrichment_status === 'completed');

  const addToCart = conversions.filter((row) => row.event_type === 'add_to_cart');
  const checkoutIds = new Set(conversions.flatMap((row) => row.event_type === 'checkout_started' && row.checkout_session_id ? [row.checkout_session_id] : []));
  const orderIds = new Set(conversions.flatMap((row) => row.event_type === 'purchase_completed' && row.order_id ? [row.order_id] : []));
  const purchaseRows = conversions.filter((row) => row.event_type === 'purchase_completed');
  const assistedRevenue = purchaseRows.reduce((sum, row) => sum + Number(row.assisted_value ?? 0), 0);
  const currency = purchaseRows.find((row) => row.currency)?.currency ?? params.fallbackCurrency.toUpperCase();

  const recipeRows = interactions.filter((row) => row.intent === 'recipe' && (row.action_product_ids?.length ?? 0) > 0);
  const recipeInteractionIds = new Set(recipeRows.map((row) => row.id));
  const acceptedRecipeInteractions = new Set(addToCart.flatMap((row) => row.nala_interaction_id && recipeInteractionIds.has(row.nala_interaction_id) ? [row.nala_interaction_id] : []));

  const intentCounts = topCounts(
    interactions.map((row) => row.intent ?? 'unknown'),
    INTENT_LABELS,
  );
  const intents: NalaIntentMetric[] = intentCounts.map((item) => ({
    ...item,
    share: percent(item.count, interactions.length),
  }));

  const relationshipTypes = topCounts(
    interactions.flatMap((row) => row.action_relationship_types ?? []),
    RELATIONSHIP_LABELS,
    4,
  );

  const dayCount = Math.min(params.rangeDays, 14);
  const dailyMap = new Map<string, NalaDailyMetric>();
  const formatter = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - offset);
    const key = dayKey(date);
    dailyMap.set(key, { key, label: formatter.format(date).replace('.', ''), interactions: 0, assistedRevenue: 0 });
  }
  for (const interaction of interactions) {
    const metric = dailyMap.get(interaction.created_at.slice(0, 10));
    if (metric) metric.interactions += 1;
  }
  for (const purchase of purchaseRows) {
    const metric = dailyMap.get(purchase.occurred_at.slice(0, 10));
    if (metric) metric.assistedRevenue += Number(purchase.assisted_value ?? 0);
  }

  return {
    rangeDays: params.rangeDays,
    since,
    currency,
    sessions: sessionCount,
    interactions: interactions.length,
    unmetDemand: unmetRows.length,
    unmetDemandRate: percent(unmetRows.length, interactions.length),
    knowledgeGaps: knowledgeGapRows.length,
    retrievalIssues: retrievalIssueRows.length,
    addToCartEvents: addToCart.length,
    checkoutCount: checkoutIds.size,
    orderCount: orderIds.size,
    assistedRevenue: Math.round(assistedRevenue * 100) / 100,
    assistedOrderRate: percent(orderIds.size, sessionCount),
    cartBuilderProposals: recipeRows.length,
    cartBuilderAccepted: acceptedRecipeInteractions.size,
    cartBuilderAcceptanceRate: percent(acceptedRecipeInteractions.size, recipeRows.length),
    enrichedInteractions: enrichedRows.length,
    enrichmentCoverage: percent(enrichedRows.length, interactions.length),
    intents,
    unmetRequests: topDemand(unmetRows.map((row) => row.requested_product_text)),
    relationshipTypes: relationshipTypes.map((item) => ({ ...item })),
    daily: [...dailyMap.values()],
  };
}
