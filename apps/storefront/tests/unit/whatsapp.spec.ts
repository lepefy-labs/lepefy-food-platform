import { expect, test } from '@playwright/test';
import type { Tenant } from '@lepefy/types';
import { computeMetaSignature, verifyMetaSignature, verifySubscriptionRequest } from '../../src/lib/whatsapp/signature';
import { parseWhatsAppWebhook, type InboundMessageEvent, type StatusEvent } from '../../src/lib/whatsapp/webhookPayload';
import { ingestWebhookEvents, type IngestionStore, type ResolvedChannel } from '../../src/lib/whatsapp/ingestion';
import { decideAutomation, evaluateNalaGuardrails, type EngineInput } from '../../src/lib/whatsapp/automation/engine';
import { detectIntents, detectLanguage, extractOrderRef } from '../../src/lib/whatsapp/automation/intents';
import { resolveRules, parseRuleConfig } from '../../src/lib/whatsapp/automation/rules';
import { shippingReply, toWhatsAppText } from '../../src/lib/whatsapp/automation/replies';
import { processInboundMessage, tenantStorefrontBase, type InboundContext, type ProcessDeps } from '../../src/lib/whatsapp/automation/processInbound';
import { classifyMetaError, createMetaCloudProvider, sanitizeProviderMessage } from '../../src/lib/whatsapp/provider/metaCloudProvider';
import { resolveChannelAccessToken } from '../../src/lib/whatsapp/provider/credentials';
import { WhatsAppProviderError, type WhatsAppProvider } from '../../src/lib/whatsapp/provider/types';
import { sendConversationText, type OutboundInsert, type OutboundStore } from '../../src/lib/whatsapp/responseService';
import { requestHandoff, resumeAutomation, takeOverConversation, type ConversationPatch, type HandoffAuditEvent, type HandoffStore } from '../../src/lib/whatsapp/handoff';
import { listInbox, loadConversationDetail } from '../../src/lib/whatsapp/adminQueries';
import { channelIdentitySchema, toChannelView } from '../../src/lib/whatsapp/adminSchemas';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import type { WhatsAppLogEvent, WhatsAppLogger } from '../../src/lib/whatsapp/log';
import type { WhatsAppChannel, WhatsAppConversation } from '../../src/lib/whatsapp/types';
import { fakeDb } from './helpers/fakeSupabase';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const PHONE_ID_A = '200000000000001';
const PHONE_ID_B = '200000000000002';

function recorder(): { log: WhatsAppLogger; events: Array<{ event: WhatsAppLogEvent; fields: Record<string, unknown> }> } {
  const events: Array<{ event: WhatsAppLogEvent; fields: Record<string, unknown> }> = [];
  return { events, log: (event, fields = {}) => { events.push({ event, fields }); } };
}

function webhookPayload(phoneNumberId: string, parts: { messages?: unknown[]; statuses?: unknown[]; contacts?: unknown[] }) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550000000', phone_number_id: phoneNumberId },
      ...parts,
    } }] }],
  };
}

function textMessage(id: string, from = '393331112222', body = 'Bonjour') {
  return { from, id, timestamp: '1760000000', type: 'text', text: { body } };
}

/** Store en mémoire reproduisant les garanties SQL de la migration 147 (unicité, résolution par canal). */
function memoryIngestionStore(channels: Array<ResolvedChannel & { phoneNumberId: string }>, enabledTenants = new Set([TENANT_A, TENANT_B])) {
  const conversations: Array<{ id: string; tenantId: string; channelId: string; waId: string }> = [];
  const messages: Array<{ id: string; tenantId: string; channelId: string; conversationId: string; providerId: string; direction: 'inbound' | 'outbound'; status: string }> = [];
  let seq = 0;
  const store: IngestionStore = {
    async findChannelByPhoneNumberId(phoneNumberId) {
      const channel = channels.find((candidate) => candidate.phoneNumberId === phoneNumberId);
      return channel ? { id: channel.id, tenantId: channel.tenantId, status: channel.status } : null;
    },
    async isFeatureEnabled(tenantId) { return enabledTenants.has(tenantId); },
    async ingestInbound(channelId, event) {
      const channel = channels.find((candidate) => candidate.id === channelId)!;
      const existing = messages.find((message) => message.channelId === channelId && message.providerId === event.providerMessageId);
      if (existing) return { messageId: existing.id, conversationId: existing.conversationId, tenantId: existing.tenantId, created: false };
      let conversation = conversations.find((row) => row.channelId === channelId && row.waId === event.waId);
      if (!conversation) {
        conversation = { id: `conv-${++seq}`, tenantId: channel.tenantId, channelId, waId: event.waId };
        conversations.push(conversation);
      }
      const message = { id: `msg-${++seq}`, tenantId: channel.tenantId, channelId, conversationId: conversation.id, providerId: event.providerMessageId, direction: 'inbound' as const, status: 'received' };
      messages.push(message);
      return { messageId: message.id, conversationId: conversation.id, tenantId: channel.tenantId, created: true };
    },
    async applyStatus(channelId, event) {
      const message = messages.find((row) => row.channelId === channelId && row.providerId === event.providerMessageId && row.direction === 'outbound');
      if (!message) return { found: false, applied: false, tenantId: null };
      message.status = event.status;
      return { found: true, applied: true, tenantId: message.tenantId };
    },
  };
  return { store, conversations, messages };
}

const CHANNELS = [
  { id: 'channel-a', tenantId: TENANT_A, status: 'active' as const, phoneNumberId: PHONE_ID_A },
  { id: 'channel-b', tenantId: TENANT_B, status: 'active' as const, phoneNumberId: PHONE_ID_B },
];

function channelRow(patch: Partial<WhatsAppChannel> = {}): WhatsAppChannel {
  return {
    id: 'channel-a', tenant_id: TENANT_A, provider: 'meta_cloud', environment: 'test', waba_id: '100000000000001',
    phone_number_id: PHONE_ID_A, display_phone_number: '+1 555 000 0000', verified_name: 'Boutique A', status: 'active',
    automation_enabled: true, ai_enabled: false, human_handoff_enabled: true, default_language: 'fr', timezone: 'Europe/Paris',
    auto_resume_minutes: null, access_token_env: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    ...patch,
  };
}

function conversationRow(patch: Partial<WhatsAppConversation> = {}): WhatsAppConversation {
  return {
    id: 'conv-1', tenant_id: TENANT_A, channel_id: 'channel-a', customer_id: null, wa_id: '393331112222',
    customer_phone: '+393331112222', customer_name: 'Marie', status: 'open', automation_status: 'active', assigned_to: null,
    detected_language: null, nala_conversation_id: null, unread_count: 1, last_message_at: new Date().toISOString(),
    last_inbound_at: new Date().toISOString(), human_handoff_at: null, automation_resume_at: null, created_at: '2026-10-01T00:00:00Z',
    ...patch,
  };
}

const TENANT = {
  id: TENANT_A, name: 'Boutique A', storefront_url: 'https://shop.example.test', currency: 'EUR',
  shipping_provider: 'flat_rate', flat_rate_amount: 5.9, click_collect_enabled: true, click_collect_address: '1 rue de Test, Paris',
  shipping_public_grid_enabled: false, is_test: false,
} as unknown as Tenant;

function engineInput(patch: Partial<EngineInput> = {}, text = 'Bonjour'): EngineInput {
  return {
    channel: { status: 'active', automation_enabled: true, human_handoff_enabled: true },
    conversation: { automation_status: 'active', isNew: false },
    message: { type: 'text', text },
    rules: resolveRules([]),
    detection: detectIntents(text),
    storeInfo: null,
    tenantSuspended: false,
    nalaAvailable: false,
    ...patch,
  };
}

interface FakeRun {
  deps: ProcessDeps;
  sent: Array<{ body: string; author: string; rule: string }>;
  handoffs: string[];
  finished: Array<{ status: string; result: string }>;
  nalaCalls: number;
}

function fakeProcessDeps(options: {
  channel?: Partial<WhatsAppChannel>;
  conversation?: Partial<WhatsAppConversation>;
  text?: string | null;
  type?: string;
  firstInbound?: boolean;
  nala?: { reply: string; intent: string; confidence: number | null } | Error;
  customerId?: string | null;
  canUseNala?: boolean;
} = {}): FakeRun {
  const run: FakeRun = { sent: [], handoffs: [], finished: [], nalaCalls: 0, deps: undefined as unknown as ProcessDeps };
  const ctx: InboundContext = {
    message: { id: 'msg-1', provider_message_id: 'wamid.IN-0001', message_type: options.type ?? 'text', body: options.text === undefined ? 'Bonjour' : options.text },
    conversation: conversationRow(options.conversation),
    channel: channelRow(options.channel),
    tenant: TENANT,
    isFirstInbound: options.firstInbound ?? false,
    isTestTenant: false,
  };
  run.deps = {
    loadContext: async () => ctx,
    finishMessage: async (_tenantId, _messageId, status, result) => { run.finished.push({ status, result }); },
    isTenantSuspended: async () => false,
    canUseNala: async () => options.canUseNala ?? true,
    loadRules: async () => resolveRules([]),
    storeInformation: async (_ctx, text) => /horaire/i.test(text) ? { subject: 'opening_hours', reply: 'Nos horaires sont : 9h-19h' } : null,
    linkCustomer: async () => options.customerId ?? null,
    findCustomerOrder: async () => null,
    productAvailability: async () => null,
    runNala: async () => {
      run.nalaCalls += 1;
      if (options.nala instanceof Error) throw options.nala;
      const nala = options.nala ?? { reply: 'Le ndolé est un plat camerounais.', intent: 'product_information', confidence: 0.9 };
      return { status: 'answered', conversationId: 'ai-conv-1', ...nala };
    },
    updateConversation: async () => undefined,
    send: async (_ctx, body, author, metadata) => {
      run.sent.push({ body, author, rule: metadata.rule ?? '' });
      return { ok: true, messageId: `out-${run.sent.length}`, providerMessageId: `wamid.OUT-${run.sent.length}` };
    },
    requestHandoff: async (_ctx, reason) => { run.handoffs.push(reason); },
    markRead: async () => undefined,
    log: () => undefined,
  };
  return run;
}

// ─── 1–2. Vérification webhook ───────────────────────────────────────────────

test.describe('webhook verification', () => {
  test('1. GET subscription handshake returns the challenge with the right token', () => {
    const params = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '1158201444' });
    expect(verifySubscriptionRequest(params, 'verify-me')).toEqual({ ok: true, challenge: '1158201444' });
  });

  test('2. invalid verification: wrong token, wrong mode, missing configuration, unsafe challenge', () => {
    const base = { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '42' };
    expect(verifySubscriptionRequest(new URLSearchParams({ ...base, 'hub.verify_token': 'nope' }), 'verify-me')).toEqual({ ok: false, status: 403 });
    expect(verifySubscriptionRequest(new URLSearchParams({ ...base, 'hub.mode': 'unsubscribe' }), 'verify-me')).toEqual({ ok: false, status: 400 });
    expect(verifySubscriptionRequest(new URLSearchParams(base), null)).toEqual({ ok: false, status: 503 });
    expect(verifySubscriptionRequest(new URLSearchParams({ ...base, 'hub.challenge': '<script>' }), 'verify-me')).toEqual({ ok: false, status: 400 });
  });

  test('2b. X-Hub-Signature-256: valid, tampered body, wrong secret, rotation', () => {
    const body = Buffer.from(JSON.stringify(webhookPayload(PHONE_ID_A, { messages: [textMessage('wamid.SIG-0001')] })));
    const header = computeMetaSignature(body, 'app-secret');
    expect(verifyMetaSignature(body, header, ['app-secret'])).toBe(true);
    expect(verifyMetaSignature(Buffer.concat([body, Buffer.from(' ')]), header, ['app-secret'])).toBe(false);
    expect(verifyMetaSignature(body, header, ['other-secret'])).toBe(false);
    expect(verifyMetaSignature(body, header, ['old-secret', 'app-secret'])).toBe(true);
    expect(verifyMetaSignature(body, null, ['app-secret'])).toBe(false);
    expect(verifyMetaSignature(body, header, [])).toBe(false);
  });
});

// ─── Parsing ─────────────────────────────────────────────────────────────────

test.describe('webhook payload parsing', () => {
  test('keeps only minimal fields; location coordinates are never retained', () => {
    const parsed = parseWhatsAppWebhook(webhookPayload(PHONE_ID_A, {
      contacts: [{ wa_id: '393331112222', profile: { name: 'Marie' } }],
      messages: [
        textMessage('wamid.TXT-0001'),
        { from: '393331112222', id: 'wamid.LOC-0001', timestamp: '1760000001', type: 'location', location: { latitude: 45.1, longitude: 9.2 } },
        { from: '393331112222', id: 'wamid.BTN-0001', timestamp: '1760000002', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'opt_1', title: 'Oui' } } },
        { from: 'not-a-number', id: 'wamid.BAD-0001', type: 'text', text: { body: 'x' } },
      ],
    }));
    expect(parsed.recognized).toBe(true);
    expect(parsed.ignored).toBe(1);
    const [text, location, button] = parsed.events as InboundMessageEvent[];
    expect(text).toMatchObject({ kind: 'message', phoneNumberId: PHONE_ID_A, waId: '393331112222', profileName: 'Marie', body: 'Bonjour', messageType: 'text' });
    expect(location?.body).toBeNull();
    expect(JSON.stringify(location?.metadata)).not.toContain('45.1');
    expect(button).toMatchObject({ body: 'Oui', metadata: { interactive_id: 'opt_1' } });
  });

  test('non-WhatsApp payloads are not recognized', () => {
    expect(parseWhatsAppWebhook({ object: 'page', entry: [] }).recognized).toBe(false);
    expect(parseWhatsAppWebhook(null).recognized).toBe(false);
  });
});

// ─── 3–6. Ingestion, résolution du tenant, idempotence, isolation ───────────

test.describe('ingestion and tenant resolution', () => {
  test('3. the tenant is resolved from the recipient phone_number_id', async () => {
    const memory = memoryIngestionStore(CHANNELS);
    const logs = recorder();
    const parsed = parseWhatsAppWebhook(webhookPayload(PHONE_ID_B, { messages: [textMessage('wamid.B-0001')] }));
    const summary = await ingestWebhookEvents(parsed.events, memory.store, logs.log);
    expect(summary.toProcess).toEqual([{ messageId: expect.any(String), tenantId: TENANT_B }]);
    expect(memory.conversations[0]?.tenantId).toBe(TENANT_B);
    expect(logs.events.some((entry) => entry.event === 'tenant_resolved' && entry.fields.tenantId === TENANT_B)).toBe(true);
  });

  test('4. an unknown phone_number_id is ignored and logged, nothing persisted', async () => {
    const memory = memoryIngestionStore(CHANNELS);
    const logs = recorder();
    const parsed = parseWhatsAppWebhook(webhookPayload('999999999999999', { messages: [textMessage('wamid.X-0001')] }));
    const summary = await ingestWebhookEvents(parsed.events, memory.store, logs.log);
    expect(summary).toMatchObject({ ingested: 0, skipped: 1, toProcess: [] });
    expect(memory.messages).toHaveLength(0);
    expect(logs.events.map((entry) => entry.event)).toContain('unknown_phone_number_id');
  });

  test('4b. disabled channel and disabled feature flag are ignored', async () => {
    const memory = memoryIngestionStore([{ ...CHANNELS[0]!, status: 'disabled' }, CHANNELS[1]!], new Set([TENANT_A]));
    const logs = recorder();
    const events = [
      ...parseWhatsAppWebhook(webhookPayload(PHONE_ID_A, { messages: [textMessage('wamid.A-0009')] })).events,
      ...parseWhatsAppWebhook(webhookPayload(PHONE_ID_B, { messages: [textMessage('wamid.B-0009')] })).events,
    ];
    const summary = await ingestWebhookEvents(events, memory.store, logs.log);
    expect(summary.skipped).toBe(2);
    expect(memory.messages).toHaveLength(0);
    expect(logs.events.map((entry) => entry.event)).toEqual(expect.arrayContaining(['channel_disabled', 'feature_disabled']));
  });

  test('5. a duplicate webhook (Meta retry) creates nothing and is not reprocessed', async () => {
    const memory = memoryIngestionStore(CHANNELS);
    const logs = recorder();
    const events = parseWhatsAppWebhook(webhookPayload(PHONE_ID_A, { messages: [textMessage('wamid.DUP-0001')] })).events;
    const first = await ingestWebhookEvents(events, memory.store, logs.log);
    const second = await ingestWebhookEvents(events, memory.store, logs.log);
    expect(first.toProcess).toHaveLength(1);
    expect(second).toMatchObject({ ingested: 0, duplicates: 1, toProcess: [] });
    expect(memory.messages).toHaveLength(1);
    expect(logs.events.map((entry) => entry.event)).toContain('duplicate_event');
  });

  test('6. cross-tenant isolation: same customer number on two tenants never shares a conversation', async () => {
    const memory = memoryIngestionStore(CHANNELS);
    const logs = recorder();
    await ingestWebhookEvents([
      ...parseWhatsAppWebhook(webhookPayload(PHONE_ID_A, { messages: [textMessage('wamid.ISO-0001', '393331112222')] })).events,
      ...parseWhatsAppWebhook(webhookPayload(PHONE_ID_B, { messages: [textMessage('wamid.ISO-0001', '393331112222')] })).events,
    ], memory.store, logs.log);
    expect(memory.conversations).toHaveLength(2);
    expect(new Set(memory.conversations.map((row) => row.tenantId))).toEqual(new Set([TENANT_A, TENANT_B]));
    for (const message of memory.messages) {
      const conversation = memory.conversations.find((row) => row.id === message.conversationId)!;
      expect(conversation.tenantId).toBe(message.tenantId);
    }
  });

  test('6b. a store answering with another tenant is rejected (defence in depth)', async () => {
    const memory = memoryIngestionStore(CHANNELS);
    const store: IngestionStore = { ...memory.store, ingestInbound: async () => ({ messageId: 'm', conversationId: 'c', tenantId: TENANT_B, created: true }) };
    const events = parseWhatsAppWebhook(webhookPayload(PHONE_ID_A, { messages: [textMessage('wamid.MIX-0001')] })).events;
    await expect(ingestWebhookEvents(events, store, () => undefined)).rejects.toThrow('whatsapp_tenant_mismatch');
  });

  test('11. delivery status events update the outbound message of the right channel only', async () => {
    const memory = memoryIngestionStore(CHANNELS);
    memory.messages.push({ id: 'out-1', tenantId: TENANT_A, channelId: 'channel-a', conversationId: 'conv-x', providerId: 'wamid.OUT-0001', direction: 'outbound', status: 'sent' });
    const logs = recorder();
    const statusPayload = (phoneNumberId: string, status: string) => webhookPayload(phoneNumberId, {
      statuses: [{ id: 'wamid.OUT-0001', status, timestamp: '1760000100', recipient_id: '393331112222',
        ...(status === 'failed' ? { errors: [{ code: 131026, title: 'Message undeliverable' }] } : {}) }],
    });
    const parsed = parseWhatsAppWebhook(statusPayload(PHONE_ID_A, 'delivered'));
    expect(parsed.events[0]).toMatchObject({ kind: 'status', status: 'delivered' } satisfies Partial<StatusEvent>);
    await ingestWebhookEvents(parsed.events, memory.store, logs.log);
    expect(memory.messages[0]?.status).toBe('delivered');
    // Même wamid annoncé sur le numéro du tenant B : aucune correspondance.
    await ingestWebhookEvents(parseWhatsAppWebhook(statusPayload(PHONE_ID_B, 'read')).events, memory.store, logs.log);
    expect(memory.messages[0]?.status).toBe('delivered');
    expect(logs.events.map((entry) => entry.event)).toContain('status_unmatched');
    const failed = parseWhatsAppWebhook(statusPayload(PHONE_ID_A, 'failed')).events[0] as StatusEvent;
    expect(failed).toMatchObject({ errorCode: '131026', errorTitle: 'Message undeliverable' });
  });
});

// ─── 7–9. Moteur d'automatisation ────────────────────────────────────────────

test.describe('automation engine', () => {
  test('7. automation disabled / channel pending / tenant suspended => no reply', async () => {
    expect(decideAutomation(engineInput({ channel: { status: 'active', automation_enabled: false, human_handoff_enabled: true } }))).toEqual({ action: 'skip', reason: 'automation_disabled' });
    expect(decideAutomation(engineInput({ channel: { status: 'pending', automation_enabled: true, human_handoff_enabled: true } }))).toEqual({ action: 'skip', reason: 'channel_not_active' });
    expect(decideAutomation(engineInput({ tenantSuspended: true }))).toEqual({ action: 'skip', reason: 'tenant_suspended' });

    const run = fakeProcessDeps({ channel: { automation_enabled: false }, text: 'Quels sont vos horaires ?' });
    const outcome = await processInboundMessage('msg-1', run.deps);
    expect(outcome).toEqual({ status: 'skipped', result: 'automation_disabled' });
    expect(run.sent).toHaveLength(0);
    expect(run.nalaCalls).toBe(0);
  });

  test('8. human handoff: sensitive intents escalate, a paused conversation never gets automated replies', async () => {
    for (const [text, reason] of [
      ['Je veux parler à un conseiller', 'customer_request'],
      ['Mon paiement par carte a été refusé', 'payment_issue'],
      ['Je n’ai toujours pas reçu ma commande', 'order_not_received'],
      ['Produit abîmé, c’est inadmissible', 'complaint'],
    ] as const) {
      expect(decideAutomation(engineInput({ nalaAvailable: true }, text))).toMatchObject({ action: 'handoff', reason });
    }
    const run = fakeProcessDeps({ text: 'Je veux parler à un conseiller' });
    expect(await processInboundMessage('msg-1', run.deps)).toEqual({ status: 'done', result: 'handoff:customer_request' });
    expect(run.handoffs).toEqual(['customer_request']);
    expect(run.sent.map((entry) => entry.rule)).toEqual(['human_handoff']);

    const paused = fakeProcessDeps({ conversation: { automation_status: 'paused', status: 'human' }, text: 'Vous livrez en Belgique ?' });
    expect(await processInboundMessage('msg-1', paused.deps)).toEqual({ status: 'skipped', result: 'automation_paused' });
    expect(paused.sent).toHaveLength(0);
    expect(paused.nalaCalls).toBe(0);

    const media = fakeProcessDeps({ text: null, type: 'image' });
    expect(await processInboundMessage('msg-1', media.deps)).toEqual({ status: 'done', result: 'handoff:media_message' });
  });

  test('8b. handoff disabled: sensitive request gets a fallback, never Nala', async () => {
    const run = fakeProcessDeps({ channel: { human_handoff_enabled: false, ai_enabled: true }, text: 'Mon paiement a échoué deux fois' });
    expect(await processInboundMessage('msg-1', run.deps)).toEqual({ status: 'done', result: 'fallback:handoff_disabled' });
    expect(run.nalaCalls).toBe(0);
    expect(run.handoffs).toHaveLength(0);
  });

  test('9. deterministic rules win over Nala when structured data exists', async () => {
    const run = fakeProcessDeps({ channel: { ai_enabled: true }, text: 'Vous livrez à domicile ? quels sont les frais de livraison' });
    expect(await processInboundMessage('msg-1', run.deps)).toEqual({ status: 'done', result: 'rule:shipping' });
    expect(run.nalaCalls).toBe(0);
    expect(run.sent[0]?.body).toContain('5,90');

    const hours = fakeProcessDeps({ channel: { ai_enabled: true }, text: 'Quels sont vos horaires ?' });
    expect(await processInboundMessage('msg-1', hours.deps)).toEqual({ status: 'done', result: 'rule:opening_hours' });
    expect(hours.nalaCalls).toBe(0);

    // Statut de commande sans client vérifié : aucune donnée divulguée, jamais l'IA.
    const order = fakeProcessDeps({ channel: { ai_enabled: true }, text: 'Où en est ma commande ?' });
    expect(await processInboundMessage('msg-1', order.deps)).toEqual({ status: 'done', result: 'rule:order_status' });
    expect(order.sent[0]?.body).toContain('Je ne trouve pas de commande');
    expect(order.nalaCalls).toBe(0);
  });

  test('9b. Nala answers the rest; guardrails reroute transactional or low-confidence answers', async () => {
    const ok = fakeProcessDeps({ channel: { ai_enabled: true }, text: 'C’est quoi le ndolé ?' });
    expect(await processInboundMessage('msg-1', ok.deps)).toEqual({ status: 'done', result: 'nala' });
    expect(ok.sent[0]).toMatchObject({ author: 'nala' });

    const low = fakeProcessDeps({ channel: { ai_enabled: true }, text: 'Une question compliquée', nala: { reply: '?', intent: 'other', confidence: 0.2 } });
    expect(await processInboundMessage('msg-1', low.deps)).toEqual({ status: 'done', result: 'handoff:low_confidence' });

    const delivery = fakeProcessDeps({ channel: { ai_enabled: true }, text: 'Et pour la Belgique ?', nala: { reply: 'Oui, 3 €', intent: 'delivery', confidence: 0.9 } });
    expect(await processInboundMessage('msg-1', delivery.deps)).toEqual({ status: 'done', result: 'rule:shipping' });
    expect(delivery.sent.some((entry) => entry.body.includes('3 €'))).toBe(false);

    const error = fakeProcessDeps({ channel: { ai_enabled: true }, text: 'Une autre question', nala: new Error('provider down') });
    expect(await processInboundMessage('msg-1', error.deps)).toEqual({ status: 'done', result: 'handoff:automation_error' });

    expect(evaluateNalaGuardrails({ intent: 'payment_help', confidence: 1 }, engineInput())).toEqual({ kind: 'handoff', reason: 'payment_issue' });
    expect(evaluateNalaGuardrails({ intent: 'product_information', confidence: null }, engineInput())).toEqual({ kind: 'accept' });
  });

  test('9c. greeting on a new conversation, then the actual answer', async () => {
    const run = fakeProcessDeps({ firstInbound: true, text: 'Bonjour, quels sont vos horaires ?' });
    await processInboundMessage('msg-1', run.deps);
    expect(run.sent.map((entry) => entry.rule)).toEqual(['greeting', 'opening_hours']);
    expect(run.sent[0]?.body).toContain('Boutique A');
  });

  test('9d. without Nala and without matching rule, the request goes to the team', async () => {
    const run = fakeProcessDeps({ text: 'Pouvez-vous préparer un panier cadeau ?' });
    expect(await processInboundMessage('msg-1', run.deps)).toEqual({ status: 'done', result: 'handoff:unsupported_intent' });
  });
});

// ─── 10. Fournisseur Meta et service de réponse ──────────────────────────────

test.describe('Meta provider', () => {
  function fakeFetch(responses: Array<{ status: number; body: unknown } | 'timeout'>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = responses.shift() ?? { status: 500, body: {} };
      if (next === 'timeout') { const error = new Error('aborted'); error.name = 'AbortError'; throw error; }
      return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }
  const provider = (impl: typeof fetch) => createMetaCloudProvider({ phoneNumberId: PHONE_ID_A, accessToken: 'EAAGsecretTOKEN1234567890', apiVersion: 'v23.0', fetchImpl: impl, sleep: async () => undefined });

  test('sends text to the tenant phone_number_id endpoint and returns the wamid', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { messages: [{ id: 'wamid.SENT-0001' }] } }]);
    const result = await provider(impl).sendText('+39 333 111 2222', 'Bonjour');
    expect(result.providerMessageId).toBe('wamid.SENT-0001');
    expect(calls[0]?.url).toBe(`https://graph.facebook.com/v23.0/${PHONE_ID_A}/messages`);
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ messaging_product: 'whatsapp', to: '393331112222', type: 'text', text: { body: 'Bonjour' } });
  });

  test('10. provider errors are classified, sanitized and only explicit transient failures are retried', async () => {
    const outside = fakeFetch([{ status: 400, body: { error: { code: 131047, message: 'Re-engagement message' } } }]);
    await expect(provider(outside.impl).sendText('393331112222', 'x')).rejects.toMatchObject({ kind: 'outside_window', code: '131047' });
    expect(outside.calls).toHaveLength(1);

    const transient = fakeFetch([{ status: 500, body: { error: { code: 1, message: 'unknown' } } }, { status: 200, body: { messages: [{ id: 'wamid.RETRY-001' }] } }]);
    await expect(provider(transient.impl).sendText('393331112222', 'x')).resolves.toEqual({ providerMessageId: 'wamid.RETRY-001' });
    expect(transient.calls).toHaveLength(2);

    const timeout = fakeFetch(['timeout', { status: 200, body: { messages: [{ id: 'wamid.NEVER-001' }] } }]);
    await expect(provider(timeout.impl).sendText('393331112222', 'x')).rejects.toMatchObject({ kind: 'timeout' });
    expect(timeout.calls).toHaveLength(1);

    const auth = fakeFetch([{ status: 401, body: { error: { code: 190, message: 'Invalid OAuth access token EAAGsecretTOKEN1234567890' } } }]);
    const error = await provider(auth.impl).sendText('393331112222', 'x').then(
      () => { throw new Error('expected a provider error'); },
      (caught: unknown) => caught as WhatsAppProviderError,
    );
    expect(error).toBeInstanceOf(WhatsAppProviderError);
    expect(error.kind).toBe('auth');
    expect(error.message).not.toContain('EAAGsecret');

    expect(classifyMetaError(400, '131030')).toBe('recipient');
    expect(classifyMetaError(429, null)).toBe('rate_limit');
    expect(sanitizeProviderMessage('Bearer abc.def to +393331112222')).not.toMatch(/abc\.def|393331112222/);
  });

  test('10b. response service records the failure and never throws on provider errors', async () => {
    const inserted: OutboundInsert[] = [];
    const failed: string[] = [];
    const store: OutboundStore = {
      insertOutbound: async (row) => { inserted.push(row); return `out-${inserted.length}`; },
      markSent: async () => undefined,
      markFailed: async (_tenant, id, code) => { failed.push(`${id}:${code}`); },
      touchConversation: async () => undefined,
    };
    const failingProvider = { sendText: async () => { throw new WhatsAppProviderError({ kind: 'recipient', code: '131030', httpStatus: 400 }); } } as unknown as WhatsAppProvider;
    const logs = recorder();
    const outcome = await sendConversationText(
      { channel: channelRow(), conversation: conversationRow(), body: 'Bonjour', authorType: 'automation', isTestTenant: false },
      { store, providerFactory: () => failingProvider, log: logs.log, testAllowList: [] },
    );
    expect(outcome).toMatchObject({ ok: false, reason: 'provider_error', errorKind: 'recipient' });
    expect(failed).toEqual(['out-1:131030']);
    expect(logs.events.map((entry) => entry.event)).toContain('provider_error');
    expect(JSON.stringify(logs.events)).not.toContain('393331112222');
  });

  test('10c. 24 h window and test-tenant allow-list are enforced before any provider call', async () => {
    let providerCalls = 0;
    const store: OutboundStore = { insertOutbound: async () => 'out-1', markSent: async () => undefined, markFailed: async () => undefined, touchConversation: async () => undefined };
    const deps = { store, providerFactory: () => { providerCalls += 1; return {} as WhatsAppProvider; }, log: () => undefined, testAllowList: ['393330000000'] };
    const old = conversationRow({ last_inbound_at: new Date(Date.now() - 25 * 3600_000).toISOString() });
    expect(await sendConversationText({ channel: channelRow(), conversation: old, body: 'x', authorType: 'agent', isTestTenant: false }, deps))
      .toMatchObject({ ok: false, reason: 'outside_window' });
    expect(await sendConversationText({ channel: channelRow(), conversation: conversationRow(), body: 'x', authorType: 'agent', isTestTenant: true }, deps))
      .toMatchObject({ ok: false, reason: 'test_recipient_blocked' });
    expect(providerCalls).toBe(0);
    await expect(sendConversationText({ channel: channelRow({ tenant_id: TENANT_B }), conversation: conversationRow(), body: 'x', authorType: 'agent', isTestTenant: false }, deps))
      .rejects.toThrow('whatsapp_channel_conversation_mismatch');
  });

  test('tokens come from server env references only', () => {
    const env = { META_WHATSAPP_SYSTEM_USER_TOKEN: 'platform-token', META_WHATSAPP_TENANT_B_TOKEN: 'tenant-b-token', SUPABASE_SERVICE_ROLE_KEY: 'nope' };
    expect(resolveChannelAccessToken({ access_token_env: null }, env)).toBe('platform-token');
    expect(resolveChannelAccessToken({ access_token_env: 'META_WHATSAPP_TENANT_B_TOKEN' }, env)).toBe('tenant-b-token');
    expect(resolveChannelAccessToken({ access_token_env: 'SUPABASE_SERVICE_ROLE_KEY' }, env)).toBeNull();
    expect(channelIdentitySchema.safeParse({ environment: 'test', waba_id: '1234567', phone_number_id: '7654321', status: 'pending', access_token_env: 'EAAGrawtoken' }).success).toBe(false);
  });
});

// ─── Handoff ─────────────────────────────────────────────────────────────────

test.describe('handoff lifecycle', () => {
  function memoryHandoffStore() {
    const patches: ConversationPatch[] = [];
    const audits: HandoffAuditEvent[] = [];
    let open: { reason: string; assignedTo: string | null } | null = null;
    const store: HandoffStore = {
      openHandoff: async (row) => { if (open) return 'exists'; open = { reason: row.reason, assignedTo: row.assignedTo }; return 'created'; },
      acceptOpenHandoff: async (_t, _c, adminId) => { if (open) open.assignedTo = adminId; },
      resolveOpenHandoffs: async () => { const count = open ? 1 : 0; open = null; return count; },
      updateConversation: async (_t, _c, patch) => { patches.push(patch); },
      audit: async (event) => { audits.push(event); },
    };
    return { store, patches, audits, get open() { return open; } };
  }

  test('request pauses automation (with optional auto-resume), take-over assigns, resume reactivates', async () => {
    const memory = memoryHandoffStore();
    const now = Date.parse('2026-10-06T10:00:00Z');
    await requestHandoff(memory.store, { tenantId: TENANT_A, conversationId: 'conv-1', reason: 'complaint', triggerMessageId: 'msg-1', autoResumeMinutes: 60, log: () => undefined, now });
    expect(memory.patches[0]).toMatchObject({ status: 'waiting_human', automation_status: 'paused', automation_resume_at: '2026-10-06T11:00:00.000Z' });
    await requestHandoff(memory.store, { tenantId: TENANT_A, conversationId: 'conv-1', reason: 'complaint', triggerMessageId: 'msg-2', autoResumeMinutes: null, log: () => undefined, now });
    expect(memory.audits.filter((event) => event.eventType === 'handoff_requested')).toHaveLength(1);

    await takeOverConversation(memory.store, { tenantId: TENANT_A, conversationId: 'conv-1', adminId: 'admin-1', now });
    expect(memory.open?.assignedTo).toBe('admin-1');
    expect(memory.patches.at(-1)).toMatchObject({ status: 'human', automation_status: 'paused', assigned_to: 'admin-1', automation_resume_at: null });

    await resumeAutomation(memory.store, { tenantId: TENANT_A, conversationId: 'conv-1', adminId: 'admin-1', log: () => undefined, now });
    expect(memory.open).toBeNull();
    expect(memory.patches.at(-1)).toMatchObject({ status: 'open', automation_status: 'active' });
    expect(memory.audits.map((event) => event.eventType)).toEqual(['handoff_requested', 'agent_takeover', 'automation_resumed']);
  });
});

// ─── 12. Lecture admin : tenant A ne lit jamais tenant B ─────────────────────

test.describe('admin reads are tenant-scoped', () => {
  function seededDb() {
    return fakeDb({
      whatsapp_conversations: [
        conversationRow({ id: 'conv-a', tenant_id: TENANT_A, channel_id: 'channel-a' }),
        conversationRow({ id: 'conv-b', tenant_id: TENANT_B, channel_id: 'channel-b', customer_name: 'Client B' }),
      ],
      whatsapp_messages: [
        { id: 'm-a', tenant_id: TENANT_A, conversation_id: 'conv-a', direction: 'inbound', author_type: 'customer', message_type: 'text', body: 'Message A', status: 'received', created_at: '2026-10-06T10:00:00Z' },
        { id: 'm-b', tenant_id: TENANT_B, conversation_id: 'conv-b', direction: 'inbound', author_type: 'customer', message_type: 'text', body: 'Message B secret', status: 'received', created_at: '2026-10-06T10:00:00Z' },
      ],
      whatsapp_handoffs: [],
    });
  }

  test('12. tenant A cannot list or open a tenant B conversation', async () => {
    const db = seededDb();
    const inbox = await listInbox(db as never, TENANT_A, 'all');
    expect(inbox.map((item) => item.id)).toEqual(['conv-a']);
    expect(JSON.stringify(inbox)).not.toContain('Message B');
    expect(await loadConversationDetail(db as never, TENANT_A, 'conv-b')).toBeNull();
    const own = await loadConversationDetail(db as never, TENANT_A, 'conv-a');
    expect(own?.messages.map((message) => message.body)).toEqual(['Message A']);
  });

  test('admin API capabilities are mapped fail-closed', () => {
    expect(permissionForAdminApi('/api/admin/whatsapp/conversations', 'GET')).toBe('whatsapp.view');
    expect(permissionForAdminApi('/api/admin/whatsapp/conversations/abc/messages', 'POST')).toBe('whatsapp.reply');
    expect(permissionForAdminApi('/api/admin/whatsapp/conversations/abc/messages', 'GET')).toBeNull();
    expect(permissionForAdminApi('/api/admin/whatsapp/conversations/abc', 'DELETE')).toBe('whatsapp.manage');
    expect(permissionForAdminApi('/api/admin/whatsapp/rules', 'PUT')).toBe('whatsapp.manage');
    expect(permissionForAdminApi('/api/admin/whatsapp/channel/test', 'GET')).toBeNull();
  });

  test('Meta technical identifiers are only exposed to the platform owner', () => {
    expect(toChannelView(channelRow({ access_token_env: 'META_WHATSAPP_A_TOKEN' }), { isPlatformOwner: false, tokenConfigured: true }).technical).toBeNull();
    expect(toChannelView(channelRow(), { isPlatformOwner: true, tokenConfigured: false }).technical?.phoneNumberId).toBe(PHONE_ID_A);
  });
});

// ─── Intentions, langues, réponses ───────────────────────────────────────────

test.describe('intents and replies', () => {
  test('multilingual detection', () => {
    expect(detectIntents('Dov’è il mio pacco?').intents).toContain('tracking');
    expect(detectIntents('Can I talk to a human please').intents).toContain('human_request');
    expect(detectIntents('Avez-vous du manioc ?')).toMatchObject({ intents: ['product_availability'], productQuery: expect.any(String) });
    expect(detectIntents('Bonjour').greetingOnly).toBe(true);
    expect(detectIntents('Bonjour, vous livrez ?').greetingOnly).toBe(false);
    expect(detectLanguage('Ciao, vorrei sapere quando arriva il mio ordine')).toBe('it');
    expect(detectLanguage('Hello, where is my order please')).toBe('en');
    expect(extractOrderRef('Commande #3F2A9C1B toujours pas là')).toBe('3F2A9C1B');
  });

  test('shipping reply never invents a price', () => {
    const packlink = shippingReply('fr', { provider: 'packlink', flatRateAmount: null, currency: 'EUR', pickupAddress: null, publicGridUrl: null });
    expect(packlink).not.toMatch(/\d+[,.]\d{2}/);
    expect(shippingReply('fr', { provider: 'pickup_only', flatRateAmount: null, currency: 'EUR', pickupAddress: '1 rue X', publicGridUrl: null })).toContain('1 rue X');
  });

  test('rule configuration is validated per code; storefront base never falls back to the deployment URL', () => {
    expect(parseRuleConfig('catalog', { path: '/products' })).toEqual({ path: '/products' });
    expect(parseRuleConfig('catalog', { path: 'https://evil.example' })).toBeNull();
    expect(parseRuleConfig('greeting', { message: 'x', price: 3 })).toBeNull();
    expect(resolveRules([{ code: 'shipping', enabled: false, priority: 5, configuration: {} }]).find((rule) => rule.code === 'shipping')).toMatchObject({ enabled: false, priority: 5, customized: true });
    expect(tenantStorefrontBase({ storefront_url: 'https://shop.example.test/' })).toBe('https://shop.example.test');
    expect(tenantStorefrontBase({ storefront_url: null })).toBeNull();
    expect(toWhatsAppText('**Ndolé** [voir](https://shop.example.test/p)')).toBe('*Ndolé* voir : https://shop.example.test/p');
  });
});
