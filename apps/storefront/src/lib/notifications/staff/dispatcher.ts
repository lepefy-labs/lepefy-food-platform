import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { attemptQueuedDelivery, type DeliveryOutcome, type RawSend } from '@/lib/notifications/deliveryLedger';
import { getTenantNotificationContext, type TenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { emailRequest } from '@/lib/notifications/sendEmail';
import { staffAlertEmail } from '@/lib/notifications/operationalEmails';
import { GREEN_API_DELIVERY_PATH } from '@/lib/notifications/providers/greenApiOutbound';
import { routeDelivery } from '@/lib/notifications/deliveryRouter';
import { NOTIFICATION_TYPES, type NotificationChannel, type NotificationTypeDefinition } from '@/lib/notifications/notificationTypes';
import { renderStaffWhatsapp, type StaffAlert } from './staffMessages';
import { maskWhatsappPhone, STAFF_WHATSAPP_FLAG } from './staffWhatsapp';
import type { StaffPriority } from './orderSignals';

/**
 * Central dispatcher of internal (staff) notifications.
 *
 *   dispatchTenantNotification({ tenantId, eventType, entityType, entityId, occurrenceId, alert, … })
 *
 * 1. records the domain event once (tenant_notification_events, unique per
 *    transition: a replayed webhook gets the same row);
 * 2. resolves the subscribed recipients per channel (RPC
 *    notification_recipient_targets: active, team member still active,
 *    WhatsApp number confirmed);
 * 3. queues one row per recipient × channel in the delivery ledger with the
 *    key `notif:<event>:<recipient>:<channel>`: never twice, whoever calls;
 * 4. tries those rows now (bounded); failures stay queued for the scheduler.
 *
 * Never throws and never blocks the caller's business write: an order, a
 * payment or a shipment never depends on Green API or the email transport.
 */
export interface DispatchInput {
  tenantId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  occurrenceId: string;
  alert: StaffAlert;
  priority?: StaffPriority;
  /** Subscription keys whose subscribers receive this (default: the event type). */
  audienceTypes?: string[];
  /** Channels to deliver on (default: every channel of the type). */
  channels?: NotificationChannel[];
  source?: 'live' | 'backfill';
  backfillRunId?: string | null;
  /** Catch-up: only these recipient × channel pairs. */
  only?: ReadonlyArray<{ recipientId: string; channel: NotificationChannel }>;
  /** false: queue only (the scheduler or the caller sends later). */
  sendNow?: boolean;
  /** Extra facts kept with the event (ids, flags), never personal data. */
  facts?: Record<string, unknown>;
}

export interface DispatchResult {
  eventId: string | null;
  queued: number;
  /** Ledger rows created by this call (catch-up progress). */
  deliveryIds: string[];
  alreadyQueued: number;
  attempted: number;
  accepted: number;
  /** Recipients per channel that matched. */
  targets: Record<NotificationChannel, number>;
  error?: string;
}

export interface DispatchDeps {
  db: SupabaseClient;
  getContext: (tenantId: string) => Promise<TenantNotificationContext | null>;
  isWhatsappEnabled: (tenantId: string) => Promise<boolean>;
  send: RawSend;
  /** Pause between two immediate WhatsApp sends. */
  pause: (ms: number) => Promise<void>;
}

const IMMEDIATE_LIMIT = 10;
const WHATSAPP_SPACING_MS = 1000;

export function defaultDispatchDeps(): DispatchDeps {
  return {
    db: createServiceClient(),
    getContext: getTenantNotificationContext,
    isWhatsappEnabled: (tenantId) => isFeatureEnabled(tenantId, STAFF_WHATSAPP_FLAG),
    send: routeDelivery,
    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export function deliveryKey(eventId: string, recipientId: string, channel: NotificationChannel): string {
  return `notif:${eventId}:${recipientId}:${channel}`;
}

function typeDefinition(key: string): NotificationTypeDefinition | undefined {
  return (NOTIFICATION_TYPES as ReadonlyArray<NotificationTypeDefinition>).find((type) => type.key === key);
}

/** Records the event once; returns its id (existing row on replay). */
export async function recordNotificationEvent(db: SupabaseClient, input: Pick<DispatchInput, 'tenantId' | 'eventType' | 'entityType' | 'entityId' | 'occurrenceId' | 'alert' | 'priority' | 'source' | 'backfillRunId' | 'facts'>): Promise<string | null> {
  const identity = {
    tenant_id: input.tenantId, event_type: input.eventType, entity_type: input.entityType,
    entity_id: input.entityId, occurrence_id: input.occurrenceId,
  };
  const { data, error } = await db.from('tenant_notification_events').upsert({
    ...identity,
    priority: input.priority ?? input.alert.priority,
    source: input.source ?? 'live',
    backfill_run_id: input.backfillRunId ?? null,
    payload: { alert: input.alert, ...(input.facts ? { facts: input.facts } : {}) },
  }, { onConflict: 'tenant_id,event_type,entity_type,entity_id,occurrence_id', ignoreDuplicates: true }).select('id');
  if (error) throw error;
  const inserted = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (inserted) return inserted;
  const { data: existing, error: readError } = await db.from('tenant_notification_events').select('id').match(identity).maybeSingle();
  if (readError) throw readError;
  return (existing as { id: string } | null)?.id ?? null;
}

interface Target { recipientId: string; channel: NotificationChannel; address: string }

async function resolveTargets(db: SupabaseClient, tenantId: string, audience: string[], channel: NotificationChannel): Promise<Target[]> {
  const { data, error } = await db.rpc('notification_recipient_targets', { p_tenant_id: tenantId, p_type_keys: audience, p_channel: channel });
  if (error) throw error;
  const seen = new Map<string, Target>();
  for (const row of (data ?? []) as Array<{ recipient_id: string; address: string | null }>) {
    if (row.address && !seen.has(row.recipient_id)) seen.set(row.recipient_id, { recipientId: row.recipient_id, channel, address: row.address });
  }
  return Array.from(seen.values());
}

/** Ledger row of one target (pure, unit-tested). */
export function buildDeliveryRow(input: {
  tenantId: string; eventId: string; eventType: string; target: Target; alert: StaffAlert;
  context: TenantNotificationContext; now: Date;
}): Record<string, unknown> {
  const { target, alert, context } = input;
  const base = {
    tenant_id: input.tenantId,
    idempotency_key: deliveryKey(input.eventId, target.recipientId, target.channel),
    notification_type: input.eventType,
    channel: target.channel,
    event_id: input.eventId,
    recipient_id: target.recipientId,
    status: 'pending',
    attempts: 0,
    next_attempt_at: input.now.toISOString(),
    subject: alert.title.slice(0, 300),
  };
  if (target.channel === 'whatsapp') {
    return {
      ...base,
      webhook_path: GREEN_API_DELIVERY_PATH,
      recipients: [maskWhatsappPhone(target.address)],
      payload: {
        tenantId: input.tenantId,
        to: target.address,
        message: renderStaffWhatsapp(alert, { tenantName: context.tenantName, storefrontUrl: context.storefrontUrl, test: alert.kind === 'test' }),
      },
    };
  }
  const [webhookPath, payload] = emailRequest(context, {
    ...staffAlertEmail(context, alert, alert.kind === 'test'),
    notificationType: input.eventType,
    idempotencyKey: base.idempotency_key,
    recipients: [target.address],
  });
  return { ...base, webhook_path: webhookPath, recipients: [target.address], payload };
}

export async function dispatchTenantNotification(input: DispatchInput, deps: DispatchDeps = defaultDispatchDeps()): Promise<DispatchResult> {
  const result: DispatchResult = { eventId: null, queued: 0, deliveryIds: [], alreadyQueued: 0, attempted: 0, accepted: 0, targets: { email: 0, whatsapp: 0 } };
  const tag = `${input.eventType}:${input.entityType}:${input.entityId}`;
  try {
    const definition = typeDefinition(input.eventType);
    const audience = input.audienceTypes?.length ? input.audienceTypes : [input.eventType];
    let channels = input.channels ?? definition?.channels ?? ['email', 'whatsapp'];
    if (channels.includes('whatsapp') && !(await deps.isWhatsappEnabled(input.tenantId).catch(() => false))) {
      channels = channels.filter((channel) => channel !== 'whatsapp');
    }

    result.eventId = await recordNotificationEvent(deps.db, input);
    if (!result.eventId) { result.error = 'event_not_recorded'; return result; }
    if (channels.length === 0) return result;

    let targets: Target[] = [];
    for (const channel of channels) {
      const found = await resolveTargets(deps.db, input.tenantId, audience, channel);
      targets.push(...found);
    }
    if (input.only) {
      const allowed = new Set(input.only.map((pair) => `${pair.recipientId}:${pair.channel}`));
      targets = targets.filter((target) => allowed.has(`${target.recipientId}:${target.channel}`));
    }
    for (const target of targets) result.targets[target.channel] += 1;
    if (targets.length === 0) {
      console.info('[staff-notify] no subscribed recipient —', tag);
      return result;
    }

    const context = await deps.getContext(input.tenantId);
    if (!context) {
      console.error('[staff-notify] tenant context unavailable — not queued —', tag);
      result.error = 'tenant_context_unavailable';
      return result;
    }

    const now = new Date();
    const rows = targets.map((target) => buildDeliveryRow({ tenantId: input.tenantId, eventId: result.eventId!, eventType: input.eventType, target, alert: input.alert, context, now }));
    const { data, error } = await deps.db.from('notification_deliveries')
      .upsert(rows, { onConflict: 'tenant_id,idempotency_key', ignoreDuplicates: true })
      .select('id, channel');
    if (error) throw error;
    const inserted = (data ?? []) as Array<{ id: string; channel: NotificationChannel }>;
    result.queued = inserted.length;
    result.deliveryIds = inserted.map((row) => row.id);
    result.alreadyQueued = rows.length - inserted.length;

    if (input.sendNow === false) return result;
    let lastWhatsapp = 0;
    for (const row of inserted.slice(0, IMMEDIATE_LIMIT)) {
      if (row.channel === 'whatsapp') {
        const wait = lastWhatsapp + WHATSAPP_SPACING_MS - Date.now();
        if (lastWhatsapp && wait > 0) await deps.pause(wait);
        lastWhatsapp = Date.now();
      }
      const outcome: DeliveryOutcome | null = await attemptQueuedDelivery(deps.db, row.id, deps.send);
      if (outcome) { result.attempted += 1; if (outcome.ok) result.accepted += 1; }
    }
    console.info('[staff-notify]', tag, '— queued:', result.queued, '— duplicates:', result.alreadyQueued, '— accepted now:', result.accepted);
    return result;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    console.error('[staff-notify] dispatch failed —', tag, '— code:', code ?? (error instanceof Error ? error.message.slice(0, 120) : 'unknown'));
    result.error = 'dispatch_failed';
    return result;
  }
}
