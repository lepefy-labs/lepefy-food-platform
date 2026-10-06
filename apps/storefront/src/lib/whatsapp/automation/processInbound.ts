import type { Tenant } from '@lepefy/types';
import type { OrderPortalViewModel } from '@/lib/orders/portal/portalViewModel';
import type { WhatsAppLogger } from '@/lib/whatsapp/log';
import type { SendOutcome } from '@/lib/whatsapp/responseService';
import type { WhatsAppChannel, WhatsAppConversation, WhatsAppHandoffReason } from '@/lib/whatsapp/types';
import { decideAutomation, evaluateNalaGuardrails, isHandoffAvailable, type EngineDecision, type EngineInput } from './engine';
import { detectIntents, detectLanguage, extractOrderRef } from './intents';
import {
  catalogReply, fallbackReply, greetingReply, handoffReply, orderNotFoundReply, orderStatusReply, replyLanguage,
  shippingReply, toWhatsAppText, trackingReply, withProductLink, type ReplyLanguage,
} from './replies';
import type { ResolvedRule, RuleCode } from './rules';

/**
 * Pipeline d'un message entrant déjà persisté et « claimé » :
 *
 *   contexte (message, conversation, canal, tenant — tous résolus côté serveur)
 *   -> cliente (téléphone vérifié WhatsApp -> customers.normalized_phone, unique)
 *   -> décision (engine.ts) -> règle déterministe | Nala + garde-fous | handoff | repli
 *   -> réponse depuis le numéro du tenant (responseService.ts)
 *
 * Toutes les I/O passent par ProcessDeps (implémentation Supabase dans
 * server/processingDeps.ts), ce qui rend la pipeline testable sans base.
 */

export interface InboundContext {
  message: { id: string; provider_message_id: string; message_type: string; body: string | null };
  conversation: WhatsAppConversation;
  channel: WhatsAppChannel;
  tenant: Tenant;
  isFirstInbound: boolean;
  isTestTenant: boolean;
}

export interface NalaTurn {
  status: 'answered' | 'unavailable' | 'rate_limited';
  reply: string | null;
  intent: string;
  confidence: number | null;
  conversationId: string | null;
}

export interface ProcessDeps {
  loadContext(messageId: string): Promise<InboundContext | null>;
  finishMessage(tenantId: string, messageId: string, status: 'done' | 'skipped', result: string): Promise<void>;
  isTenantSuspended(tenantId: string): Promise<boolean>;
  canUseNala(tenantId: string): Promise<boolean>;
  loadRules(tenantId: string): Promise<ResolvedRule[]>;
  storeInformation(ctx: InboundContext, text: string, lang: ReplyLanguage): Promise<{ subject: 'opening_hours' | 'location'; reply: string } | null>;
  linkCustomer(ctx: InboundContext): Promise<string | null>;
  findCustomerOrder(ctx: InboundContext, customerId: string, orderRef: string | null): Promise<{ view: OrderPortalViewModel; portalUrl: string | null } | null>;
  productAvailability(ctx: InboundContext, query: string, lang: ReplyLanguage): Promise<{ reply: string; productUrl: string | null } | null>;
  runNala(ctx: InboundContext, text: string, lang: ReplyLanguage): Promise<NalaTurn>;
  updateConversation(ctx: InboundContext, patch: { detected_language?: string; nala_conversation_id?: string; status?: 'automated' }): Promise<void>;
  send(ctx: InboundContext, body: string, author: 'automation' | 'nala', metadata: Record<string, string>): Promise<SendOutcome>;
  requestHandoff(ctx: InboundContext, reason: WhatsAppHandoffReason): Promise<void>;
  markRead(ctx: InboundContext): Promise<void>;
  log: WhatsAppLogger;
}

export interface ProcessOutcome {
  status: 'done' | 'skipped';
  result: string;
}

/** Base canonique de la boutique du tenant (jamais l'URL du déploiement qui traite le webhook). */
export function tenantStorefrontBase(tenant: Pick<Tenant, 'storefront_url'>): string | null {
  const raw = tenant.storefront_url?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url.origin + url.pathname.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

function ruleConfig(rules: ResolvedRule[], code: RuleCode): Record<string, unknown> {
  return rules.find((rule) => rule.code === code)?.configuration ?? {};
}

function configText(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function processInboundMessage(messageId: string, deps: ProcessDeps): Promise<ProcessOutcome> {
  const ctx = await deps.loadContext(messageId);
  if (!ctx) return { status: 'skipped', result: 'not_found' };
  const { tenant, channel, conversation } = ctx;
  const logBase = { tenantId: tenant.id, conversationId: conversation.id, messageId };
  const text = ctx.message.body?.trim() ?? '';

  const detectedLanguage = text ? detectLanguage(text) : null;
  const lang = replyLanguage(detectedLanguage ?? conversation.detected_language ?? channel.default_language);
  if (detectedLanguage && detectedLanguage !== conversation.detected_language) {
    await deps.updateConversation(ctx, { detected_language: detectedLanguage });
  }

  const finish = async (status: ProcessOutcome['status'], result: string): Promise<ProcessOutcome> => {
    await deps.finishMessage(tenant.id, messageId, status, result);
    deps.log(status === 'done' ? 'automation_executed' : 'automation_skipped', { ...logBase, result });
    return { status, result };
  };

  // Pas d'automatisation possible : on évite toute lecture inutile (règles, Nala, commandes).
  if (channel.status !== 'active' || !channel.automation_enabled || conversation.automation_status === 'paused') {
    const decision = decideAutomation({
      channel, conversation: { automation_status: conversation.automation_status, isNew: ctx.isFirstInbound },
      message: { type: ctx.message.message_type, text }, rules: [], detection: { intents: [], productQuery: null, greetingOnly: false },
      storeInfo: null, tenantSuspended: false, nalaAvailable: false,
    });
    return finish('skipped', decision.action === 'skip' ? decision.reason : 'not_automated');
  }

  const [suspended, rules, nalaEntitled, customerId] = await Promise.all([
    deps.isTenantSuspended(tenant.id),
    deps.loadRules(tenant.id),
    channel.ai_enabled ? deps.canUseNala(tenant.id) : Promise.resolve(false),
    conversation.customer_id ? Promise.resolve(conversation.customer_id) : deps.linkCustomer(ctx),
  ]);
  const detection = detectIntents(text);
  const storeInfo = text ? await deps.storeInformation(ctx, text, lang) : null;
  const engineInput: EngineInput = {
    channel,
    conversation: { automation_status: conversation.automation_status, isNew: ctx.isFirstInbound },
    message: { type: ctx.message.message_type, text },
    rules,
    detection,
    storeInfo: storeInfo?.subject ?? null,
    tenantSuspended: suspended,
    nalaAvailable: nalaEntitled,
  };
  const decision = decideAutomation(engineInput);
  if (decision.action === 'skip') return finish('skipped', decision.reason);

  const base = tenantStorefrontBase(tenant);
  let replied = false;
  const send = async (body: string, author: 'automation' | 'nala', rule: string) => {
    const outcome = await deps.send(ctx, body, author, { rule });
    if (outcome.ok) replied = true;
    return outcome;
  };

  if (decision.greeting) {
    await send(greetingReply(lang, tenant.name, configText(ruleConfig(rules, 'greeting'), 'message')), 'automation', 'greeting');
  }

  const escalate = async (reason: WhatsAppHandoffReason): Promise<ProcessOutcome> => {
    await deps.requestHandoff(ctx, reason);
    await send(handoffReply(lang, reason, tenant.name, configText(ruleConfig(rules, 'human_handoff'), 'message')), 'automation', 'human_handoff');
    return finish('done', `handoff:${reason}`);
  };
  const fallback = async (reason: string): Promise<ProcessOutcome> => {
    await send(fallbackReply(lang, tenant.name, base), 'automation', 'fallback');
    return finish('done', `fallback:${reason}`);
  };
  /** Règle déterministe : réponse construite à partir des données Lepefy, ou null si la donnée manque. */
  const runRule = async (code: RuleCode): Promise<string | null> => {
    const config = ruleConfig(rules, code);
    switch (code) {
      case 'greeting':
        return greetingReply(lang, tenant.name, configText(config, 'message'));
      case 'opening_hours':
      case 'location':
        return storeInfo?.subject === code ? storeInfo.reply : null;
      case 'shipping':
        return shippingReply(lang, {
          provider: tenant.shipping_provider,
          flatRateAmount: tenant.flat_rate_amount,
          currency: tenant.currency || 'EUR',
          pickupAddress: tenant.click_collect_enabled ? tenant.click_collect_address : null,
          publicGridUrl: tenant.shipping_public_grid_enabled && base ? `${base}/livraison` : null,
          extraNote: configText(config, 'extra_note'),
        });
      case 'catalog': {
        if (!base) return null;
        const path = configText(config, 'path') ?? '/products';
        return catalogReply(lang, `${base}${path === '/' ? '' : path}`);
      }
      case 'product_availability': {
        if (!detection.productQuery) return null;
        const result = await deps.productAvailability(ctx, detection.productQuery, lang);
        if (!result) return null;
        return config.include_link === false ? result.reply : withProductLink(result.reply, lang, result.productUrl);
      }
      case 'order_status':
      case 'tracking': {
        // Divulgation limitée au titulaire vérifié : seul un client du tenant dont le
        // téléphone correspond exactement au numéro WhatsApp émetteur.
        if (!customerId) return orderNotFoundReply(lang);
        const order = await deps.findCustomerOrder(ctx, customerId, extractOrderRef(text));
        if (!order) return orderNotFoundReply(lang);
        return code === 'tracking' ? trackingReply(lang, order.view, order.portalUrl) : orderStatusReply(lang, order.view, order.portalUrl);
      }
      case 'human_handoff':
        return null;
    }
  };

  /** Une règle n'a pas pu répondre (donnée absente) : Nala, puis opérateur, puis repli. */
  const afterRuleMiss = (): EngineDecision => {
    if (engineInput.nalaAvailable) return { action: 'nala', greeting: false };
    if (isHandoffAvailable(engineInput)) return { action: 'handoff', reason: 'unsupported_intent', greeting: false };
    return { action: 'fallback', reason: 'no_answer', greeting: false };
  };

  let current: EngineDecision = decision;
  if (current.action === 'rule') {
    const reply = await runRule(current.code);
    if (reply) {
      await deps.markRead(ctx);
      await send(reply, 'automation', current.code);
      if (replied) await deps.updateConversation(ctx, { status: 'automated' });
      return finish('done', `rule:${current.code}`);
    }
    current = afterRuleMiss();
  }

  if (current.action === 'nala') {
    let turn: NalaTurn;
    try {
      turn = await deps.runNala(ctx, text, lang);
    } catch (error) {
      deps.log('ai_fallback', { ...logBase, reason: 'nala_error', error: error instanceof Error ? error.name : 'unknown' });
      return isHandoffAvailable(engineInput) ? escalate('automation_error') : fallback('nala_error');
    }
    if (turn.conversationId && turn.conversationId !== conversation.nala_conversation_id) {
      await deps.updateConversation(ctx, { nala_conversation_id: turn.conversationId });
    }
    if (turn.status !== 'answered' || !turn.reply) {
      deps.log('ai_fallback', { ...logBase, reason: turn.status });
      return isHandoffAvailable(engineInput) ? escalate('unsupported_intent') : fallback(turn.status);
    }
    const guard = evaluateNalaGuardrails(turn, engineInput);
    if (guard.kind === 'rule') {
      const reply = await runRule(guard.code);
      if (reply) {
        await deps.markRead(ctx);
        await send(reply, 'automation', guard.code);
        if (replied) await deps.updateConversation(ctx, { status: 'automated' });
        return finish('done', `rule:${guard.code}`);
      }
      return isHandoffAvailable(engineInput) ? escalate('unsupported_intent') : fallback('rule_miss');
    }
    if (guard.kind === 'handoff') {
      deps.log('ai_fallback', { ...logBase, reason: guard.reason, intent: turn.intent });
      return escalate(guard.reason);
    }
    if (guard.kind === 'fallback') return fallback('guardrail');
    await deps.markRead(ctx);
    await send(toWhatsAppText(turn.reply), 'nala', 'nala');
    if (replied) await deps.updateConversation(ctx, { status: 'automated' });
    return finish('done', 'nala');
  }

  if (current.action === 'handoff') return escalate(current.reason);
  if (current.action === 'fallback') return fallback(current.reason);
  return finish('skipped', 'no_decision');
}
