import 'server-only';
import type { Tenant } from '@lepefy/types';
import { runAi } from '@/lib/ai/core/aiGateway';
import { finishConversation, openConversation, releaseConversation, type ConversationContext } from '@/lib/ai/core/conversationContext';
import { boundedContext, memoryFromDecision } from '@/lib/ai/core/contextPackage';
import { nalaResponseSchema, nalaResponseValidator, NALA_DECISION_INSTRUCTIONS } from '@/lib/ai/core/nalaDecision';
import { buildSystemPrompt, type KnowledgeSnippet, type MatchedProductContext } from '@/lib/ai/chatbox';
import { embedText, logNalaEmbeddingUsage } from '@/lib/ai/embeddings';
import { matchSmallTalk } from '@/lib/ai/smallTalk';
import { checkRateLimit, logAiUsage } from '@/lib/ai/usageTracking';
import { getNalaExtraContext } from '@/lib/ai/aiSettings';
import { persistNalaResponseMemory, resolveNalaResponseMemory } from '@/lib/ai/nalaResponseMemory';
import { canUseNala } from '@/lib/entitlements/tenantEntitlements';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Nala sur un canal de messagerie (WhatsApp aujourd'hui, Instagram/Messenger
 * demain). Ce n'est PAS un second assistant : même prompt système
 * (buildSystemPrompt), même contrat de décision, même routage AI Core
 * (consumer `nala`, capability `structured_chat`), même mémoire de réponses et
 * même récupération catalogue/connaissances que le widget storefront.
 *
 * Différences propres au canal, volontairement minimales :
 * - historique AI Core séparé (consumer de conversation `nala_<canal>`) ;
 * - consigne de format (texte brut, pas de cartes produit ni de panier) ;
 * - pas d'actions storefront (cartes produit, Cart Builder) : le canal reçoit
 *   la réponse texte + l'intention, et applique ses propres garde-fous.
 *
 * Le tenant est toujours celui résolu côté serveur par l'appelant.
 */

export type NalaChannel = 'whatsapp';

export interface NalaChannelTurnResult {
  status: 'answered' | 'unavailable' | 'rate_limited';
  reply: string | null;
  intent: string;
  confidence: number | null;
  conversationId: string | null;
  provider: string | null;
  model: string | null;
}

const MAX_MESSAGE_LENGTH = 300;

const CHANNEL_INSTRUCTIONS: Record<NalaChannel, string> = {
  whatsapp: `
Canal : WhatsApp. Réponds en texte brut court (3 phrases maximum), sans tableau ni titre Markdown.
Tu ne peux ni afficher de fiche produit, ni ajouter au panier : indique simplement le nom du produit.
N'annonce jamais de frais de livraison, de délai, d'état de commande, de suivi ou de statut de paiement :
ces informations sont données par l'équipe ou par les réponses automatiques de la boutique.
Si tu n'es pas sûr, dis-le et propose de transmettre la demande à l'équipe.`,
};

interface MatchProductsRow {
  id: string; name: string; price: number; stock: number | null; weight_grams: number | null;
  storage_type: string | null; category_name: string | null;
}

export async function runNalaChannelTurn(params: {
  tenant: Tenant;
  channel: NalaChannel;
  conversationId: string | null;
  message: string;
  locale: string;
}): Promise<NalaChannelTurnResult> {
  const { tenant, channel, locale } = params;
  const endpoint = `nala_${channel}`;
  const empty: Omit<NalaChannelTurnResult, 'status'> = {
    reply: null, intent: 'unknown', confidence: null, conversationId: null, provider: null, model: null,
  };
  const message = params.message.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (message.length < 2 || !(await canUseNala(tenant.id))) return { status: 'unavailable', ...empty };
  if (!(await checkRateLimit(tenant.id, endpoint, true))) {
    await logAiUsage({ tenantId: tenant.id, endpoint, provider: 'lepefy', model: 'routing', status: 'rate_limited' });
    return { status: 'rate_limited', ...empty };
  }

  const supabase = createServiceClient();
  let conversation: ConversationContext | null = null;
  try {
    conversation = await openConversation({
      tenantId: tenant.id, consumer: `nala_${channel}`, conversationId: params.conversationId, locale,
    });
    const hadPendingAction = Boolean(conversation.memory.pendingAction);

    const smallTalk = hadPendingAction ? null : matchSmallTalk(message, tenant.name);
    if (smallTalk) {
      await finishConversation(conversation, {
        message, reply: smallTalk, memory: { ...conversation.memory, activeIntent: 'small_talk', locale },
        provider: null, model: null, confidence: null, commerceMode: 'none',
      });
      return { status: 'answered', reply: smallTalk, intent: 'small_talk', confidence: 1, conversationId: conversation.id, provider: 'lepefy', model: 'small_talk' };
    }

    const memory = hadPendingAction ? null : await resolveNalaResponseMemory({ supabase, tenant, locale, message });
    if (memory) {
      await logAiUsage({ tenantId: tenant.id, endpoint, provider: 'lepefy', model: 'response_memory_v1', consumer: 'nala', capability: 'deterministic', status: 'success' });
      await finishConversation(conversation, {
        message, reply: memory.reply, memory: memoryFromDecision(memory.decision, locale),
        provider: 'lepefy', model: 'response_memory_v1', confidence: memory.matchScore, commerceMode: 'none',
      });
      return {
        status: 'answered', reply: memory.reply, intent: memory.decision.intent, confidence: memory.decision.confidence ?? memory.matchScore,
        conversationId: conversation.id, provider: 'lepefy', model: 'response_memory_v1',
      };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const retrieval = await Promise.race([
      embedText(message).catch(() => null),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 4000); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    const vector = retrieval?.vector;
    if (retrieval?.tokenCount) await logNalaEmbeddingUsage(tenant.id, retrieval.tokenCount);
    const [{ data: products }, { data: knowledge }] = vector ? await Promise.all([
      supabase.rpc('match_products', { query_embedding: vector, p_tenant_id: tenant.id, match_count: 6, min_similarity: 0.3 }),
      supabase.rpc('match_knowledge_base', { query_embedding: vector, p_tenant_id: tenant.id, match_count: 3, min_similarity: 0.35 }),
    ]) : [{ data: [] }, { data: [] }];
    const productRows = (products ?? []) as MatchProductsRow[];
    const knowledgeRows = (knowledge ?? []) as Array<{ id: string; category: string; content: string }>;
    const matchedProducts: MatchedProductContext[] = productRows.map((row) => ({
      name: row.name.slice(0, 150), price: row.price, stock: row.stock, weightGrams: row.weight_grams,
      storageType: row.storage_type, categoryName: row.category_name,
    }));
    const knowledgeSnippets: KnowledgeSnippet[] = knowledgeRows.map((row) => ({ category: row.category, content: row.content.slice(0, 1000) }));
    const extraContext = await getNalaExtraContext(supabase, tenant.id, tenant.chatbox_extra_context);

    const system = buildSystemPrompt({
      tenantName: tenant.name,
      locales: tenant.locales ?? ['fr'],
      // Le client écrit déjà sur WhatsApp : pas de renvoi vers un autre numéro.
      whatsappNumber: null,
      extraContext: extraContext?.slice(0, 4000) ?? null,
      matchedProducts,
      knowledgeSnippets,
    });
    const response = await runAi({
      tenantId: tenant.id, endpoint, consumer: 'nala', capability: 'structured_chat',
      request: {
        ...boundedContext({
          system: system + CHANNEL_INSTRUCTIONS[channel] + NALA_DECISION_INSTRUCTIONS,
          memory: conversation.memory, summary: conversation.summary, turns: conversation.turns, message,
        }),
        responseSchema: nalaResponseSchema,
        validate: (value) => nalaResponseValidator.parse(value),
        temperature: 0.3,
        maxOutputTokens: 800,
      },
    });
    const { reply, decision, cartPlan } = response.structured;
    await finishConversation(conversation, {
      message, reply, memory: memoryFromDecision(decision, locale), provider: response.provider, model: response.model,
      confidence: decision.confidence, commerceMode: decision.commerceMode,
    });
    await persistNalaResponseMemory({
      supabase, tenant, locale, message, reply, decision, cartPlan, hadPendingAction,
      matchedProductIds: productRows.length ? productRows.map((row) => row.id) : null,
      matchedKbIds: knowledgeRows.length ? knowledgeRows.map((row) => row.id) : null,
      interactionId: null, sourceProvider: response.provider, sourceModel: response.model,
    });
    return {
      status: 'answered', reply, intent: decision.intent, confidence: decision.confidence,
      conversationId: conversation.id, provider: response.provider, model: response.model,
    };
  } catch (error) {
    await releaseConversation(conversation).catch(() => undefined);
    throw error;
  }
}
