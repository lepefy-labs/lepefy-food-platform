import 'server-only';
import type { Tenant } from '@lepefy/types';
import { runNalaChannelTurn } from '@/lib/ai/nalaChannelTurn';
import { getNalaExtraContext } from '@/lib/ai/aiSettings';
import { resolveNalaFastStoreInformation } from '@/lib/ai/nalaFastResolver';
import { resolveNalaFastProductAvailability, type NalaFastProductCandidate } from '@/lib/ai/nalaFastProductResolver';
import { getTenantServiceState } from '@/lib/billing/tenantServiceState';
import { canUseNala } from '@/lib/entitlements/tenantEntitlements';
import { orderShortRef } from '@/lib/orders/documents/documentHtml';
import { getOrCreateOrderPublicTokens, orderPortalUrl } from '@/lib/orders/portal/orderPublicToken';
import { buildOrderPortalViewModel, type PortalOrderRow } from '@/lib/orders/portal/portalViewModel';
import { createServiceClient } from '@/lib/supabase/server';
import { isTestTenantId } from '@/lib/tenant/testTenant';
import { processInboundMessage, tenantStorefrontBase, type InboundContext, type ProcessDeps } from '@/lib/whatsapp/automation/processInbound';
import { resolveRules, type AutomationRuleRow } from '@/lib/whatsapp/automation/rules';
import { testRecipientAllowList } from '@/lib/whatsapp/config';
import { requestHandoff } from '@/lib/whatsapp/handoff';
import { whatsappLog } from '@/lib/whatsapp/log';
import { createChannelProvider } from '@/lib/whatsapp/provider/credentials';
import { sendConversationText } from '@/lib/whatsapp/responseService';
import { CHANNEL_COLUMNS, CONVERSATION_COLUMNS, type WhatsAppChannel, type WhatsAppConversation } from '@/lib/whatsapp/types';
import { createHandoffStore, createOutboundStore } from './stores';

/**
 * Traitement asynchrone des messages entrants : claim atomique (RPC), puis
 * pipeline processInboundMessage avec les dépendances réelles. Utilisé par le
 * webhook (mode inline), par POST /api/internal/whatsapp/process (n8n) et par
 * le balayage de maintenance. Le tenant de chaque message vient de la base
 * (canal du message), jamais de l'appelant.
 */

type Db = ReturnType<typeof createServiceClient>;

const PORTAL_ORDER_COLUMNS = 'id, created_at, status, fulfillment_type, payment_status, tracking_code, tracking_carrier, shipping_details, shipping_tracking_mode, shipping_normalized_status, shipping_tracking_url, shipping_estimated_delivery_at, shipping_tracking_events';

async function loadTenantById(db: Db, tenantId: string): Promise<Tenant | null> {
  const { data, error } = await db.from('tenants').select('*').eq('id', tenantId).eq('active', true).maybeSingle();
  if (error) throw new Error(`whatsapp_tenant_load_failed:${error.code ?? ''}`);
  return (data as Tenant | null) ?? null;
}

export function createProcessingDeps(db: Db): ProcessDeps {
  const handoffStore = createHandoffStore(db);
  const outboundStore = createOutboundStore(db);
  const extraContextCache = new Map<string, string | null>();

  async function extraContext(tenant: Tenant): Promise<string | null> {
    if (!extraContextCache.has(tenant.id)) {
      extraContextCache.set(tenant.id, await getNalaExtraContext(db, tenant.id, tenant.chatbox_extra_context));
    }
    return extraContextCache.get(tenant.id) ?? null;
  }

  return {
    async loadContext(messageId) {
      const { data: message, error } = await db.from('whatsapp_messages')
        .select('id, tenant_id, conversation_id, channel_id, provider_message_id, message_type, body, direction')
        .eq('id', messageId).maybeSingle();
      if (error) throw new Error(`whatsapp_message_load_failed:${error.code ?? ''}`);
      if (!message || message.direction !== 'inbound') return null;
      const tenantId = message.tenant_id as string;
      const [conversationResult, channelResult, tenant, inboundCount, isTest] = await Promise.all([
        db.from('whatsapp_conversations').select(CONVERSATION_COLUMNS).eq('tenant_id', tenantId).eq('id', message.conversation_id).maybeSingle(),
        db.from('tenant_whatsapp_channels').select(CHANNEL_COLUMNS).eq('tenant_id', tenantId).eq('id', message.channel_id).maybeSingle(),
        loadTenantById(db, tenantId),
        db.from('whatsapp_messages').select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('conversation_id', message.conversation_id).eq('direction', 'inbound'),
        isTestTenantId(tenantId),
      ]);
      if (conversationResult.error || channelResult.error) throw new Error('whatsapp_context_load_failed');
      if (!conversationResult.data || !channelResult.data || !tenant) return null;
      return {
        message: {
          id: message.id as string,
          provider_message_id: message.provider_message_id as string,
          message_type: message.message_type as string,
          body: message.body as string | null,
        },
        conversation: conversationResult.data as unknown as WhatsAppConversation,
        channel: channelResult.data as unknown as WhatsAppChannel,
        tenant,
        isFirstInbound: (inboundCount.count ?? 0) <= 1,
        isTestTenant: isTest || Boolean(tenant.is_test),
      };
    },

    async finishMessage(tenantId, messageId, status, result) {
      const { error } = await db.from('whatsapp_messages')
        .update({ processing_status: status, processing_result: result.slice(0, 64) })
        .eq('tenant_id', tenantId).eq('id', messageId).eq('processing_status', 'processing');
      if (error) throw new Error(`whatsapp_finish_failed:${error.code ?? ''}`);
    },

    isTenantSuspended: async (tenantId) => (await getTenantServiceState(tenantId)).suspended,
    canUseNala,

    async loadRules(tenantId) {
      const { data, error } = await db.from('whatsapp_automation_rules')
        .select('code, enabled, priority, configuration').eq('tenant_id', tenantId);
      if (error) throw new Error(`whatsapp_rules_load_failed:${error.code ?? ''}`);
      return resolveRules((data ?? []) as AutomationRuleRow[]);
    },

    async storeInformation(ctx, text, lang) {
      const resolution = resolveNalaFastStoreInformation({
        message: text,
        locale: lang,
        tenant: { ...ctx.tenant, chatbox_extra_context: await extraContext(ctx.tenant) },
      });
      if (!resolution || resolution.subject === 'whatsapp') return null;
      return { subject: resolution.subject === 'address' ? 'location' : 'opening_hours', reply: resolution.reply };
    },

    async linkCustomer(ctx) {
      // wa_id est le numéro vérifié par WhatsApp : correspondance exacte, unique par tenant (index 109).
      const { data, error } = await db.from('customers').select('id')
        .eq('tenant_id', ctx.tenant.id).eq('normalized_phone', ctx.conversation.customer_phone).limit(2);
      const match = !error && data?.length === 1 ? data[0] : undefined;
      if (!match) return null;
      const customerId = match.id as string;
      const { error: linkError } = await db.from('whatsapp_conversations').update({ customer_id: customerId })
        .eq('tenant_id', ctx.tenant.id).eq('id', ctx.conversation.id).is('customer_id', null);
      if (linkError) return null;
      return customerId;
    },

    async findCustomerOrder(ctx, customerId, orderRef) {
      const { data, error } = await db.from('orders').select(PORTAL_ORDER_COLUMNS)
        .eq('tenant_id', ctx.tenant.id).eq('customer_id', customerId).eq('payment_status', 'paid')
        .order('created_at', { ascending: false }).limit(20);
      if (error || !data || data.length === 0) return null;
      const rows = data as unknown as Array<PortalOrderRow & { payment_status: string }>;
      const order = (orderRef ? rows.find((row) => orderShortRef(row.id) === orderRef) : undefined) ?? rows[0];
      if (!order) return null;
      const { data: items } = await db.from('order_items').select('name, quantity')
        .eq('tenant_id', ctx.tenant.id).eq('order_id', order.id);
      const base = tenantStorefrontBase(ctx.tenant);
      const view = buildOrderPortalViewModel({
        order,
        items: (items ?? []) as Array<{ name: string; quantity: number }>,
        tenant: ctx.tenant,
        shopBaseUrl: base,
        reviewAvailable: false,
        reorderAvailable: false,
      });
      let portalUrl: string | null = null;
      if (base) {
        try {
          const token = (await getOrCreateOrderPublicTokens(db, ctx.tenant.id, [order.id])).get(order.id);
          portalUrl = token ? orderPortalUrl(base, token) : null;
        } catch {
          portalUrl = null;
        }
      }
      return { view, portalUrl };
    },

    async productAvailability(ctx, query, lang) {
      const pattern = `%${query.replace(/[%_]/g, '').slice(0, 80)}%`;
      const [byName, byAlt] = await Promise.all([
        db.from('products').select('id, name, name_alt, stock, slug').eq('tenant_id', ctx.tenant.id).eq('active', true).ilike('name', pattern).limit(4),
        db.from('products').select('id, name, name_alt, stock, slug').eq('tenant_id', ctx.tenant.id).eq('active', true).ilike('name_alt', pattern).limit(4),
      ]);
      if (byName.error || byAlt.error) return null;
      const unique = new Map<string, NalaFastProductCandidate & { slug?: string | null }>();
      for (const product of [...(byName.data ?? []), ...(byAlt.data ?? [])] as Array<NalaFastProductCandidate & { slug?: string | null }>) unique.set(product.id, product);
      const resolution = resolveNalaFastProductAvailability({ query, locale: lang, products: [...unique.values()] });
      if (!resolution) return null;
      const slug = unique.get(resolution.product.id)?.slug;
      const base = tenantStorefrontBase(ctx.tenant);
      return { reply: resolution.reply, productUrl: base && slug ? `${base}/products/${encodeURIComponent(slug)}` : null };
    },

    async runNala(ctx, text, lang) {
      return runNalaChannelTurn({
        tenant: ctx.tenant, channel: 'whatsapp', conversationId: ctx.conversation.nala_conversation_id, message: text, locale: lang,
      });
    },

    async updateConversation(ctx, patch) {
      const { error } = await db.from('whatsapp_conversations').update(patch)
        .eq('tenant_id', ctx.tenant.id).eq('id', ctx.conversation.id);
      if (error) throw new Error(`whatsapp_conversation_update_failed:${error.code ?? ''}`);
    },

    send(ctx, body, author, metadata) {
      return sendConversationText({
        channel: ctx.channel, conversation: ctx.conversation, body, authorType: author,
        isTestTenant: ctx.isTestTenant, metadata,
      }, { store: outboundStore, providerFactory: createChannelProvider, log: whatsappLog, testAllowList: testRecipientAllowList() });
    },

    requestHandoff(ctx, reason) {
      return requestHandoff(handoffStore, {
        tenantId: ctx.tenant.id, conversationId: ctx.conversation.id, reason, triggerMessageId: ctx.message.id,
        autoResumeMinutes: ctx.channel.auto_resume_minutes, log: whatsappLog,
      });
    },

    async markRead(ctx: InboundContext) {
      if (ctx.isTestTenant && !testRecipientAllowList().includes(ctx.conversation.wa_id)) return;
      try {
        await createChannelProvider(ctx.channel).markAsRead(ctx.message.provider_message_id);
      } catch {
        // Accusé de lecture : confort uniquement, jamais bloquant.
      }
    },

    log: whatsappLog,
  };
}

export interface ProcessBatchResult {
  claimed: number;
  done: number;
  skipped: number;
  errors: number;
}

/**
 * Claim + traitement. `messageIds` = messages précis (webhook / n8n) ; sinon
 * balayage des messages en attente depuis au moins `minAgeSeconds`.
 */
export async function processPendingWhatsAppMessages(options: { messageIds?: string[]; limit?: number; minAgeSeconds?: number } = {}): Promise<ProcessBatchResult> {
  const db = createServiceClient();
  const { data, error } = await db.rpc('claim_whatsapp_inbound_messages', {
    p_limit: options.limit ?? 20,
    p_message_ids: options.messageIds?.length ? options.messageIds : null,
    p_min_age_seconds: options.minAgeSeconds ?? 0,
    p_max_attempts: 3,
  });
  if (error) throw new Error(`whatsapp_claim_failed:${error.code ?? ''}`);
  const claimed = (data ?? []) as Array<{ out_message_id: string; out_tenant_id: string }>;
  const result: ProcessBatchResult = { claimed: claimed.length, done: 0, skipped: 0, errors: 0 };
  const deps = createProcessingDeps(db);
  // Séquentiel : l'ordre des messages d'une même conversation est conservé.
  for (const row of claimed) {
    try {
      const outcome = await processInboundMessage(row.out_message_id, deps);
      if (outcome.status === 'done') result.done += 1; else result.skipped += 1;
    } catch (processingError) {
      result.errors += 1;
      // Le message reste « processing » : le balayage le reprend après 120 s (3 tentatives max).
      whatsappLog('processing_failed', {
        tenantId: row.out_tenant_id, messageId: row.out_message_id,
        error: processingError instanceof Error ? processingError.message.slice(0, 120) : 'unknown',
      });
    }
  }
  return result;
}
