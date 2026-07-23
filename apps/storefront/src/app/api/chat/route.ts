import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit, logAiUsage } from '@/lib/ai/usageTracking';
import { embedText } from '@/lib/ai/embeddings';
import { buildSystemPrompt, type ChatTurn, type MatchedProductContext, type KnowledgeSnippet } from '@/lib/ai/chatbox';
import { matchSmallTalk } from '@/lib/ai/smallTalk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ENDPOINT = 'chatbox';
const MODEL = 'gemini-2.5-flash';
const MAX_MESSAGE_LENGTH = 300;
const MAX_HISTORY_TURNS = 6;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });

interface MatchProductsRow {
  name: string;
  price: number;
  stock: number | null;
  weight_grams: number | null;
  storage_type: string | null;
  category_name: string | null;
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  if (!tenant.ai_chatbox_enabled) {
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

  const smallTalkReply = matchSmallTalk(message, tenant.name);
  if (smallTalkReply) {
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
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

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

    const matchedProducts: MatchedProductContext[] = ((matches ?? []) as MatchProductsRow[]).map((m) => ({
      name: m.name,
      price: m.price,
      stock: m.stock,
      weightGrams: m.weight_grams,
      storageType: m.storage_type,
      categoryName: m.category_name,
    }));

    const { data: knowledgeMatches } = await supabase.rpc('match_knowledge_base', {
      query_embedding: vector,
      p_tenant_id: tenant.id,
      match_count: 3,
      min_similarity: 0.35,
    });

    const knowledgeSnippets: KnowledgeSnippet[] = ((knowledgeMatches ?? []) as { category: string; content: string }[]).map((k) => ({
      category: k.category,
      content: k.content,
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
      ...history.map(h => `${h.role === 'user' ? 'Client' : 'Assistant'}: ${h.text}`),
      `Client: ${message}`,
    ].join('\n');

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

    return NextResponse.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[chatbox] Erreur:', message);
    await logAiUsage({
      tenantId: tenant.id,
      endpoint: ENDPOINT,
      provider: 'gemini',
      model: MODEL,
      status: 'error',
    });
    return NextResponse.json({ error: 'chat_failed' }, { status: 502 });
  }
}
