import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit, logAiUsage } from '@/lib/ai/usageTracking';
import { embedText } from '@/lib/ai/embeddings';
import { buildSystemPrompt, type ChatTurn, type MatchedProductContext, type KnowledgeSnippet } from '@/lib/ai/chatbox';
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
  isNalaCartBuilderIntent,
  normalizeNalaCartPlanExtraction,
  type NalaCartPlan,
} from '@/lib/ai/nalaCartPlanContract';
import { resolveCartPlanIngredients } from '@/lib/ai/nalaCartPlanResolver';
import { inferNalaRelationshipType } from '@/lib/ai/nalaRelationshipIntent';
import { getRelatedProducts } from '@/lib/catalog/productRelationships';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ENDPOINT = 'chatbox';
const MODEL = 'gemini-2.5-flash';
const MAX_MESSAGE_LENGTH = 300;
const MAX_HISTORY_TURNS = 6;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

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

interface MainChatResponse {
  reply: string;
  cartPlan: unknown;
}

function parseMainChatResponse(raw: string): MainChatResponse {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : '',
    cartPlan: parsed.cartPlan,
  };
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
  const history: ChatTurn[] = Array.isArray(body?.history)
    ? body.history.slice(-MAX_HISTORY_TURNS)
    : [];

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

  const smallTalkReply = matchSmallTalk(message, tenant.name);
  if (smallTalkReply) {
    const interactionId = await logNalaInteraction({
      context: analyticsContext,
      messageText: message,
      replyText: smallTalkReply,
      aiCallTriggered: false,
      outcome: 'small_talk',
      intent: 'small_talk',
    });
    return NextResponse.json({
      reply: smallTalkReply,
      interactionId,
      matchedProductIds: null,
      actionProductIds: null,
      actions: [],
      cartPlan: null,
    });
  }

  const allowed = await checkRateLimit(tenant.id, ENDPOINT, true);
  if (!allowed) {
    await logAiUsage({
      tenantId: tenant.id,
      endpoint: ENDPOINT,
      provider: 'gemini',
      model: MODEL,
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

  try {
    const cartBuilderRequested = isNalaCartBuilderIntent(message);
    const { vector, tokenCount: embedTokens } = await embedText(message);
    const supabase = createServiceClient();
    const { data: matches, error: matchError } = await supabase.rpc('match_products', {
      query_embedding: vector,
      p_tenant_id: tenant.id,
      match_count: 6,
      min_similarity: 0.3,
    });
    if (matchError) throw new Error(matchError.message);

    const productRows = (matches ?? []) as MatchProductsRow[];
    matchedProductIds = productRows.length ? productRows.map((match) => match.id) : null;
    const matchedProducts: MatchedProductContext[] = productRows.map((match) => ({
      name: match.name,
      price: match.price,
      stock: match.stock,
      weightGrams: match.weight_grams,
      storageType: match.storage_type,
      categoryName: match.category_name,
    }));

    const anchor = productRows[0] ?? null;
    const requestedRelationshipType = cartBuilderRequested
      ? null
      : inferNalaRelationshipType(message, anchor ? { id: anchor.id, stock: anchor.stock } : null);

    let actionCandidates: NalaProductActionCandidate[] = cartBuilderRequested
      ? []
      : productRows.map((product) => ({
          id: product.id,
          similarity: product.similarity,
          relationshipType: 'direct',
        }));
    let relationshipSuggestion: {
      type: NonNullable<typeof requestedRelationshipType>;
      sourceProductName: string;
      targetProductName: string;
    } | null = null;

    if (requestedRelationshipType && anchor) {
      const [relationship] = await getRelatedProducts({
        supabase,
        tenantId: tenant.id,
        sourceProductId: anchor.id,
        type: requestedRelationshipType,
        limit: 1,
        allowSemanticFallback: true,
      });

      if (relationship) {
        actionCandidates = [{
          id: relationship.product.id,
          relationshipType: requestedRelationshipType,
          similarity: relationship.similarity ?? undefined,
        }];
        relationshipSuggestion = {
          type: requestedRelationshipType,
          sourceProductName: anchor.name,
          targetProductName: relationship.product.name,
        };
        matchedProducts.push({
          name: relationship.product.name,
          price: relationship.product.price,
          stock: relationship.product.stock,
          weightGrams: relationship.product.weightGrams,
          storageType: relationship.product.storageType,
          categoryName: null,
        });
      } else {
        actionCandidates = [];
      }
    }

    const { data: knowledgeMatches } = await supabase.rpc('match_knowledge_base', {
      query_embedding: vector,
      p_tenant_id: tenant.id,
      match_count: 3,
      min_similarity: 0.35,
    });

    const knowledgeRows = (knowledgeMatches ?? []) as MatchKnowledgeRow[];
    matchedKbIds = knowledgeRows.length ? knowledgeRows.map((match) => match.id) : null;
    const knowledgeSnippets: KnowledgeSnippet[] = knowledgeRows.map((match) => ({
      category: match.category,
      content: match.content,
    }));

    const systemPrompt = buildSystemPrompt({
      tenantName: tenant.name,
      locales: tenant.locales ?? ['fr'],
      whatsappNumber: tenant.whatsapp_number ?? null,
      extraContext: tenant.chatbox_extra_context ?? null,
      matchedProducts,
      knowledgeSnippets,
      relationshipSuggestion,
      cartBuilderRequested,
    });

    const conversationText = [
      ...history.map((turn) => `${turn.role === 'user' ? 'Client' : 'Assistant'}: ${turn.text}`),
      `Client: ${message}`,
    ].join('\n');

    aiCallTriggered = true;
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: conversationText,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.4,
        maxOutputTokens: 800,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: { type: Type.STRING },
            cartPlan: {
              type: Type.OBJECT,
              nullable: true,
              properties: {
                type: { type: Type.STRING, enum: ['recipe'] },
                title: { type: Type.STRING },
                ingredients: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      required: { type: Type.BOOLEAN },
                      quantityHint: { type: Type.STRING, nullable: true },
                    },
                    required: ['name', 'required', 'quantityHint'],
                  },
                },
              },
              required: ['type', 'title', 'ingredients'],
            },
          },
          required: ['reply', 'cartPlan'],
        },
      },
    });

    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const mainResponse = parseMainChatResponse(raw);
    if (!mainResponse.reply) throw new Error('Réponse vide de Gemini');

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
    let cartEmbeddingTokens = 0;
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
        cartEmbeddingTokens = resolved.tokenCount;
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

    await logAiUsage({
      tenantId: tenant.id,
      endpoint: ENDPOINT,
      provider: 'gemini',
      model: MODEL,
      inputTokens: (response.usageMetadata?.promptTokenCount ?? 0)
        + (embedTokens ?? 0)
        + cartEmbeddingTokens,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      status: 'success',
    });

    return NextResponse.json({
      reply: mainResponse.reply,
      interactionId,
      matchedProductIds: interactionId ? matchedProductIds : null,
      actionProductIds: interactionId ? actionProductIds : null,
      actions,
      cartPlan,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[chatbox] Erreur:', errorMessage);
    await logAiUsage({
      tenantId: tenant.id,
      endpoint: ENDPOINT,
      provider: 'gemini',
      model: MODEL,
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
