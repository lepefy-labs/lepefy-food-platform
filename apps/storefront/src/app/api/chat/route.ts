import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
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
  type NalaAnalyticsContext,
} from '@/lib/ai/nalaAnalytics';

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
  price: number;
  stock: number | null;
  weight_grams: number | null;
  storage_type: string | null;
  category_name: string | null;
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
    locale: body?.locale,
    deviceType: body?.deviceType,
  });

  const smallTalkReply = matchSmallTalk(message, tenant.name);
  if (smallTalkReply) {
    await logNalaInteraction({
      context: analyticsContext,
      messageText: message,
      replyText: smallTalkReply,
      aiCallTriggered: false,
      outcome: 'small_talk',
      intent: 'small_talk',
    });
    return NextResponse.json({ reply: smallTalkReply });
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
        maxOutputTokens: 500,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const reply = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    const inputTokens = (response.usageMetadata?.promptTokenCount ?? 0) + (embedTokens ?? 0);
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

    if (!reply) throw new Error('Réponse vide de Gemini');

    await logAiUsage({
      tenantId: tenant.id,
      endpoint: ENDPOINT,
      provider: 'gemini',
      model: MODEL,
      inputTokens,
      outputTokens,
      status: 'success',
    });
    await logNalaInteraction({
      context: analyticsContext,
      messageText: message,
      replyText: reply,
      aiCallTriggered,
      outcome: matchedProductIds === null && matchedKbIds === null ? 'retrieval_empty' : 'answered',
      matchedProductIds,
      matchedKbIds,
    });

    return NextResponse.json({ reply });
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
