import { NextRequest, NextResponse } from 'next/server';
import { runAi } from '@/lib/ai/core/aiGateway';
import { openConversation, finishConversation, releaseConversation, type ConversationContext } from '@/lib/ai/core/conversationContext';
import { boundedContext, memoryFromDecision } from '@/lib/ai/core/contextPackage';
import { nalaResponseSchema, nalaResponseValidator, NALA_DECISION_INSTRUCTIONS } from '@/lib/ai/core/nalaDecision';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit, logAiUsage } from '@/lib/ai/usageTracking';
import { embedText, logNalaEmbeddingUsage } from '@/lib/ai/embeddings';
import { buildSystemPrompt, type MatchedProductContext, type KnowledgeSnippet } from '@/lib/ai/chatbox';
import { matchSmallTalk } from '@/lib/ai/smallTalk';
import { canUseNala } from '@/lib/entitlements/tenantEntitlements';
import {
  logNalaInteraction,
  prepareNalaAnalytics,
  updateNalaInteractionActions,
  type NalaAnalyticsContext,
} from '@/lib/ai/nalaAnalytics';
import { buildNalaProductActions } from '@/lib/ai/nalaProductActions';
import {
  resolveNalaProductActionLocale,
  type NalaProductActionCandidate,
} from '@/lib/ai/nalaProductActionContract';
import {
  normalizeNalaCartPlanExtraction,
  type NalaCartPlan,
} from '@/lib/ai/nalaCartPlanContract';
import { resolveCartPlanIngredients } from '@/lib/ai/nalaCartPlanResolver';
import { getRelatedProducts } from '@/lib/catalog/productRelationships';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ENDPOINT = 'chatbox';
const MAX_MESSAGE_LENGTH = 300;

interface MatchProductsRow {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  price: number;
  category_id: string | null;
  stock: number | null;
  weight_grams: number | null;
  storage_type: string | null;
  category_name: string | null;
  similarity: number;
}

interface MatchKnowledgeRow {
  id: string;
  category: string;
  content: string;
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  if (!(await canUseNala(tenant.id))) {
    return NextResponse.json({ error: 'not_enabled' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const rawMessage = typeof body?.message === 'string' ? body.message : '';
  const message = rawMessage.trim().slice(0, MAX_MESSAGE_LENGTH);

  if (message.length < 2) {
    return NextResponse.json({ error: 'message_too_short' }, { status: 400 });
  }

  const analyticsContext: NalaAnalyticsContext | null = await prepareNalaAnalytics({
    request: req,
    tenantId: tenant.id,
    clientSessionId: body?.clientSessionId,
    sourcePath: body?.sourcePath,
    locale: body?.storefrontLocale,
    deviceType: body?.deviceType,
  });

  const allowed = await checkRateLimit(tenant.id, ENDPOINT, true);
  if (!allowed) {
    await logAiUsage({
      tenantId: tenant.id,
      endpoint: ENDPOINT,
      provider: 'lepefy',
      model: 'routing',
      status: 'rate_limited',
    });
    await logNalaInteraction({
      context: analyticsContext,
      messageText: message,
      replyText: null,
      aiCallTriggered: false,
      outcome: 'rate_limited',
    });
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let aiCallTriggered = false;
  let matchedProductIds: string[] | null = null;
  let matchedKbIds: string[] | null = null;

  let conversation: ConversationContext | null = null;
  try {
    const locale = resolveNalaProductActionLocale({
      storefrontLocale: body?.storefrontLocale, tenantLocales: tenant.locales, tenantLocale: tenant.locale,
    });
    conversation = await openConversation({
      tenantId: tenant.id, consumer: 'nala', conversationId: body?.conversationId, locale,
    });
    const smallTalkReply = conversation.memory.pendingAction ? null : matchSmallTalk(message, tenant.name);
    if (smallTalkReply) {
      await finishConversation(conversation, {
        message, reply: smallTalkReply,
        memory: { ...conversation.memory, activeIntent: 'small_talk', locale },
        provider: null, model: null, confidence: null, commerceMode: 'none',
      });
      const interactionId = await logNalaInteraction({
        context: analyticsContext, messageText: message, replyText: smallTalkReply,
        aiCallTriggered: false, outcome: 'small_talk', intent: 'small_talk',
      });
      return NextResponse.json({ reply: smallTalkReply, conversationId: conversation.id,
        interactionId, matchedProductIds: null, actionProductIds: null, actions: [], cartPlan: null });
    }
    // Retrieval remains a legacy embedding consumer in V1; failure must not block routed inference.
    let retrievalTimer: ReturnType<typeof setTimeout> | undefined;
    const retrieval = await Promise.race([
      embedText(message).catch(() => null),
      new Promise<null>(resolve => { retrievalTimer = setTimeout(() => resolve(null), 4000); }),
    ]).finally(() => { if (retrievalTimer) clearTimeout(retrievalTimer); });
    const vector = retrieval?.vector;
    if (retrieval?.tokenCount) await logNalaEmbeddingUsage(tenant.id, retrieval.tokenCount);
    const supabase = createServiceClient();
    const { data: matches, error: matchError } = vector ? await supabase.rpc('match_products', {
      query_embedding: vector,
      p_tenant_id: tenant.id,
      match_count: 6,
      min_similarity: 0.3,
    }) : { data: [], error: null };
    if (matchError) throw new Error(matchError.message);

    const productRows = (matches ?? []) as MatchProductsRow[];
    matchedProductIds = productRows.length ? productRows.map((match) => match.id) : null;
    const matchedProducts: MatchedProductContext[] = productRows.map((match) => ({
      name: match.name.slice(0, 150),
      price: match.price,
      stock: match.stock,
      weightGrams: match.weight_grams,
      storageType: match.storage_type,
      categoryName: match.category_name,
    }));

    const { data: knowledgeMatches } = vector ? await supabase.rpc('match_knowledge_base', {
      query_embedding: vector,
      p_tenant_id: tenant.id,
      match_count: 3,
      min_similarity: 0.35,
    }) : { data: [] };

    const knowledgeRows = (knowledgeMatches ?? []) as MatchKnowledgeRow[];
    matchedKbIds = knowledgeRows.length ? knowledgeRows.map((match) => match.id) : null;
    const knowledgeSnippets: KnowledgeSnippet[] = knowledgeRows.map((match) => ({
      category: match.category,
      content: match.content.slice(0, 1000),
    }));

    const systemPrompt = buildSystemPrompt({
      tenantName: tenant.name,
      locales: tenant.locales ?? ['fr'],
      whatsappNumber: tenant.whatsapp_number ?? null,
      extraContext: tenant.chatbox_extra_context?.slice(0, 4000) ?? null,
      matchedProducts,
      knowledgeSnippets,

    });

    const contextPackage = boundedContext({
      system: systemPrompt + NALA_DECISION_INSTRUCTIONS,
      memory: conversation.memory, summary: conversation.summary, turns: conversation.turns, message,
    });
    aiCallTriggered = true;
    const response = await runAi({
      tenantId: tenant.id, endpoint: ENDPOINT, consumer: 'nala', capability: 'structured_chat',
      request: { ...contextPackage, responseSchema: nalaResponseSchema,
        validate: value => nalaResponseValidator.parse(value), temperature: 0.4, maxOutputTokens: 1200 },
    });
    const mainResponse = response.structured;
    const decision = mainResponse.decision;
    const cartBuilderRequested = decision.commerceMode === 'cart_builder';
    const anchor = productRows[0] ?? null;
    const mode = decision.commerceMode;
    let actionCandidates: NalaProductActionCandidate[] = mode === 'product_action'
      ? productRows.map(product => ({ id: product.id, similarity: product.similarity, relationshipType: 'direct' }))
      : [];
    if (anchor && (mode === 'similar' || mode === 'substitute' || mode === 'complementary')) {
      const [relationship] = await getRelatedProducts({
        supabase, tenantId: tenant.id, sourceProductId: anchor.id, type: mode,
        limit: 1, allowSemanticFallback: true,
      });
      if (relationship) actionCandidates = [{
        id: relationship.product.id, relationshipType: mode, similarity: relationship.similarity ?? undefined,
      }];
    }

    const extraction = normalizeNalaCartPlanExtraction(
      mainResponse.cartPlan,
      cartBuilderRequested,
    );
    const interactionId = await logNalaInteraction({
      context: analyticsContext,
      messageText: message,
      replyText: mainResponse.reply,
      aiCallTriggered,
      outcome: matchedProductIds === null && matchedKbIds === null ? 'retrieval_empty' : 'answered',
      intent: cartBuilderRequested ? 'recipe' : null,
      matchedProductIds,
      matchedKbIds,
    });

    const actionLocale = resolveNalaProductActionLocale({
      storefrontLocale: body?.storefrontLocale,
      tenantLocales: tenant.locales,
      tenantLocale: tenant.locale,
    });
    let cartPlan: NalaCartPlan | null = null;
    if (extraction && interactionId) {
      try {
        const resolved = await resolveCartPlanIngredients({
          supabase,
          tenantId: tenant.id,
          interactionId,
          extraction,
          currency: tenant.currency ?? 'EUR',
          locale: actionLocale,
        });
        cartPlan = resolved.plan;
        await logNalaEmbeddingUsage(tenant.id, resolved.tokenCount);
      } catch (error) {
        console.error('[nala-cart-builder] Plan resolution failed; omitting proposal.', {
          tenantId: tenant.id,
          interactionId,
          error,
        });
      }
    }

    const actions = cartPlan ? [] : await buildNalaProductActions({
      supabase,
      tenantId: tenant.id,
      interactionId,
      message,
      locale: actionLocale,
      currency: tenant.currency ?? 'EUR',
      candidates: actionCandidates,
    });

    const cartPlanActions = cartPlan?.items.flatMap((item) => item.product ? [{
      product: { id: item.product.id },
      relationshipType: item.status === 'substitute' ? 'substitute' : 'direct',
    }] : []) ?? [];
    await updateNalaInteractionActions({
      tenantId: tenant.id,
      interactionId,
      actions: cartPlanActions.length > 0 ? cartPlanActions : actions,
    });

    const actionProductIds = [
      ...new Set([
        ...actions.map((action) => action.product.id),
        ...cartPlanActions.map((action) => action.product.id),
      ]),
    ];

    await finishConversation(conversation, {
      message, reply: mainResponse.reply, memory: memoryFromDecision(decision, locale),
      provider: response.provider, model: response.model, confidence: decision.confidence,
      commerceMode: decision.commerceMode,
    });

    return NextResponse.json({
      reply: mainResponse.reply,
      conversationId: conversation.id,
      cartPlanExpanded: conversation.memory.pendingAction === 'cart_builder' && decision.pendingAction === null && cartBuilderRequested,
      interactionId,
      matchedProductIds: interactionId ? matchedProductIds : null,
      actionProductIds: interactionId ? actionProductIds : null,
      actions,
      cartPlan,
    });
  } catch (err) {
    await releaseConversation(conversation).catch(() => undefined);
    const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[chatbox] Erreur:', errorMessage);
    await logAiUsage({
      tenantId: tenant.id,
      endpoint: ENDPOINT,
      provider: 'lepefy',
      model: 'routing',
      status: 'error',
    });
    await logNalaInteraction({
      context: analyticsContext,
      messageText: message,
      replyText: null,
      aiCallTriggered,
      outcome: 'error',
      matchedProductIds,
      matchedKbIds,
    });
    return NextResponse.json({ error: 'chat_failed' }, { status: 502 });
  }
}
