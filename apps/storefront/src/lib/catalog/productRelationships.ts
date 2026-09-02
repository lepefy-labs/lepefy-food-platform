import type { SupabaseClient } from '@supabase/supabase-js';

export const PRODUCT_RELATIONSHIP_TYPES = ['similar', 'substitute', 'complementary'] as const;
export type ProductRelationshipType = typeof PRODUCT_RELATIONSHIP_TYPES[number];
export type ProductRelationshipSource = 'manual' | 'system' | 'semantic';

export interface RelationshipProduct {
  id: string;
  tenantId: string;
  categoryId: string | null;
  name: string;
  slug: string;
  imageUrl: string | null;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  active: boolean;
  weightGrams: number | null;
  storageType: 'dry' | 'fresh' | 'frozen' | null;
}

export interface ResolvedProductRelationship {
  id: string | null;
  relationshipType: ProductRelationshipType;
  source: ProductRelationshipSource;
  priority: number;
  similarity: number | null;
  product: RelationshipProduct;
}

interface CanonicalProductRow {
  id: string;
  tenant_id: string;
  category_id: string | null;
  name: string;
  slug: string;
  image_url: string | null;
  price: number;
  compare_at_price: number | null;
  stock: number;
  active: boolean;
  weight_grams: number | null;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  embedding?: unknown;
}

interface RelationshipRow {
  id: string;
  target_product_id: string;
  relationship_type: ProductRelationshipType;
  source: 'manual' | 'system';
  priority: number;
}

interface SemanticRow {
  id: string;
  category_id: string | null;
  similarity: number;
}

const PRODUCT_SELECT =
  'id, tenant_id, category_id, name, slug, image_url, price, compare_at_price, stock, active, weight_grams, storage_type';

export function isProductRelationshipType(value: unknown): value is ProductRelationshipType {
  return typeof value === 'string'
    && (PRODUCT_RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

export function validateProductRelationshipProducts(params: {
  tenantId: string;
  sourceProductId: string;
  targetProductId: string;
  sourceTenantId?: string;
  targetTenantId?: string;
  relationshipType: unknown;
}): { valid: true } | { valid: false; reason: 'invalid_type' | 'self_relation' | 'wrong_tenant' | 'product_not_found' } {
  if (!isProductRelationshipType(params.relationshipType)) return { valid: false, reason: 'invalid_type' };
  if (params.sourceProductId === params.targetProductId) return { valid: false, reason: 'self_relation' };
  if (!params.sourceTenantId || !params.targetTenantId) return { valid: false, reason: 'product_not_found' };
  if (params.sourceTenantId !== params.tenantId || params.targetTenantId !== params.tenantId) {
    return { valid: false, reason: 'wrong_tenant' };
  }
  return { valid: true };
}

export function orderExplicitRelationships<T extends Pick<RelationshipRow, 'source' | 'priority'>>(
  rows: T[],
): T[] {
  return [...rows].sort((left, right) => {
    const sourceDelta = (right.source === 'manual' ? 1 : 0) - (left.source === 'manual' ? 1 : 0);
    return sourceDelta || right.priority - left.priority;
  });
}

function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) return value.filter((item): item is number => typeof item === 'number');
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === 'number') : null;
  } catch {
    return null;
  }
}

function toProduct(row: CanonicalProductRow): RelationshipProduct {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    categoryId: row.category_id,
    name: row.name,
    slug: row.slug,
    imageUrl: row.image_url,
    price: Number(row.price),
    compareAtPrice: row.compare_at_price == null ? null : Number(row.compare_at_price),
    stock: row.stock,
    active: row.active,
    weightGrams: row.weight_grams,
    storageType: row.storage_type,
  };
}

function isPurchasable(row: CanonicalProductRow, tenantId: string): boolean {
  return row.tenant_id === tenantId && row.active && Number.isFinite(row.stock) && row.stock > 0;
}

export function selectSemanticRelationshipCandidates(params: {
  type: ProductRelationshipType;
  sourceProductId: string;
  sourceCategoryId: string | null;
  excludedIds: string[];
  candidates: SemanticRow[];
  limit: number;
}): SemanticRow[] {
  if (params.type === 'complementary') return [];
  const excluded = new Set([params.sourceProductId, ...params.excludedIds]);

  const eligible = params.candidates.filter((candidate) => {
    if (excluded.has(candidate.id) || !Number.isFinite(candidate.similarity)) return false;
    if (params.type === 'substitute') {
      return Boolean(params.sourceCategoryId)
        && candidate.category_id === params.sourceCategoryId
        && candidate.similarity >= 0.72;
    }
    return candidate.similarity >= 0.4;
  });

  eligible.sort((left, right) => {
    if (params.type === 'similar' && params.sourceCategoryId) {
      const categoryDelta =
        Number(right.category_id === params.sourceCategoryId)
        - Number(left.category_id === params.sourceCategoryId);
      if (categoryDelta) return categoryDelta;
    }
    return right.similarity - left.similarity;
  });

  return eligible.slice(0, params.limit);
}

export async function getRelatedProducts(params: {
  supabase: SupabaseClient;
  tenantId: string;
  sourceProductId: string;
  type: ProductRelationshipType;
  limit?: number;
  allowSemanticFallback?: boolean;
}): Promise<ResolvedProductRelationship[]> {
  const limit = Math.min(20, Math.max(1, params.limit ?? 8));
  const { data: sourceData, error: sourceError } = await params.supabase
    .from('products')
    .select(`${PRODUCT_SELECT}, embedding`)
    .eq('id', params.sourceProductId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle();

  if (sourceError || !sourceData) return [];
  const source = sourceData as CanonicalProductRow;

  const { data: relationshipData, error: relationshipError } = await params.supabase
    .from('product_relationships')
    .select('id, target_product_id, relationship_type, source, priority')
    .eq('tenant_id', params.tenantId)
    .eq('source_product_id', params.sourceProductId)
    .eq('relationship_type', params.type)
    .eq('active', true);

  const relationshipRows = relationshipError
    ? []
    : orderExplicitRelationships((relationshipData ?? []) as RelationshipRow[]);
  const targetIds = [...new Set(relationshipRows.map((row) => row.target_product_id))];

  let canonicalTargets: CanonicalProductRow[] = [];
  if (targetIds.length > 0) {
    const { data } = await params.supabase
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('tenant_id', params.tenantId)
      .in('id', targetIds);
    canonicalTargets = (data ?? []) as CanonicalProductRow[];
  }

  const targetById = new Map(canonicalTargets.map((row) => [row.id, row]));
  const explicit = relationshipRows.flatMap((relationship) => {
    const target = targetById.get(relationship.target_product_id);
    if (!target || !isPurchasable(target, params.tenantId)) return [];
    return [{
      id: relationship.id,
      relationshipType: params.type,
      source: relationship.source,
      priority: relationship.priority,
      similarity: null,
      product: toProduct(target),
    } satisfies ResolvedProductRelationship];
  }).slice(0, limit);

  if (
    explicit.length >= limit
    || params.allowSemanticFallback === false
    || params.type === 'complementary'
  ) {
    return explicit;
  }

  const embedding = parseEmbedding(source.embedding);
  if (!embedding) return explicit;

  const remaining = limit - explicit.length;
  const minSimilarity = params.type === 'substitute' ? 0.72 : 0.4;
  const { data: semanticData, error: semanticError } = await params.supabase.rpc('match_products', {
    query_embedding: embedding,
    p_tenant_id: params.tenantId,
    match_count: Math.max(remaining * 4, 8),
    min_similarity: minSimilarity,
  });
  if (semanticError) return explicit;

  const semanticCandidates = selectSemanticRelationshipCandidates({
    type: params.type,
    sourceProductId: params.sourceProductId,
    sourceCategoryId: source.category_id,
    excludedIds: explicit.map((item) => item.product.id),
    candidates: (semanticData ?? []) as SemanticRow[],
    limit: remaining,
  });
  if (semanticCandidates.length === 0) return explicit;

  const semanticIds = semanticCandidates.map((candidate) => candidate.id);
  const { data: semanticProducts } = await params.supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('tenant_id', params.tenantId)
    .eq('active', true)
    .gt('stock', 0)
    .in('id', semanticIds);

  const semanticProductById = new Map(
    ((semanticProducts ?? []) as CanonicalProductRow[]).map((row) => [row.id, row]),
  );

  const fallback = semanticCandidates.flatMap((candidate) => {
    const target = semanticProductById.get(candidate.id);
    if (!target || !isPurchasable(target, params.tenantId)) return [];
    return [{
      id: null,
      relationshipType: params.type,
      source: 'semantic' as const,
      priority: 0,
      similarity: candidate.similarity,
      product: toProduct(target),
    }];
  });

  return [...explicit, ...fallback].slice(0, limit);
}
