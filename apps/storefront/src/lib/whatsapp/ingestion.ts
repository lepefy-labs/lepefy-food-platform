import type { WhatsAppLogger } from './log';
import type { BusinessEchoEvent, InboundMessageEvent, StatusEvent, WhatsAppWebhookEvent } from './webhookPayload';
import type { WhatsAppChannelStatus } from './types';

/**
 * Ingestion des événements webhook : résolution du tenant UNIQUEMENT par le
 * numéro destinataire (phone_number_id -> canal -> tenant), idempotence,
 * persistance minimale. Aucune logique métier ici : le traitement (règles,
 * Nala, handoff) est délégué à processInbound.ts, de façon asynchrone.
 */

export interface ResolvedChannel {
  id: string;
  tenantId: string;
  status: WhatsAppChannelStatus;
  autoResumeMinutes: number | null;
}

/**
 * Pause de l'automatisation après une réponse écrite depuis l'app WhatsApp
 * Business (coexistence). L'équipe au téléphone ne passe pas par l'admin pour
 * « Rendre à l'automatisation » : sans réglage du canal, reprise après 60 min.
 */
export const BUSINESS_APP_PAUSE_DEFAULT_MINUTES = 60;

export interface IngestResult {
  messageId: string;
  conversationId: string;
  tenantId: string;
  created: boolean;
}

export interface IngestionStore {
  findChannelByPhoneNumberId(phoneNumberId: string): Promise<ResolvedChannel | null>;
  isFeatureEnabled(tenantId: string): Promise<boolean>;
  ingestInbound(channelId: string, event: InboundMessageEvent): Promise<IngestResult>;
  applyStatus(channelId: string, event: StatusEvent): Promise<{ found: boolean; applied: boolean; tenantId: string | null }>;
  ingestBusinessEcho(channelId: string, event: BusinessEchoEvent, resumeMinutes: number | null): Promise<IngestResult>;
}

export interface IngestionSummary {
  /** Messages créés à traiter (ordre de réception). */
  toProcess: Array<{ messageId: string; tenantId: string }>;
  ingested: number;
  duplicates: number;
  statuses: number;
  echoes: number;
  skipped: number;
}

type ChannelDecision = { channel: ResolvedChannel } | { skip: 'unknown' | 'disabled' | 'feature_disabled' };

export async function ingestWebhookEvents(
  events: WhatsAppWebhookEvent[],
  store: IngestionStore,
  log: WhatsAppLogger,
): Promise<IngestionSummary> {
  const summary: IngestionSummary = { toProcess: [], ingested: 0, duplicates: 0, statuses: 0, echoes: 0, skipped: 0 };
  const decisions = new Map<string, ChannelDecision>();

  async function decide(phoneNumberId: string): Promise<ChannelDecision> {
    const cached = decisions.get(phoneNumberId);
    if (cached) return cached;
    let decision: ChannelDecision;
    const channel = await store.findChannelByPhoneNumberId(phoneNumberId);
    if (!channel) {
      // phone_number_id est l'identifiant Meta du numéro professionnel, pas une donnée client.
      log('unknown_phone_number_id', { phoneNumberId });
      decision = { skip: 'unknown' };
    } else if (channel.status === 'disabled') {
      log('channel_disabled', { channelId: channel.id, tenantId: channel.tenantId });
      decision = { skip: 'disabled' };
    } else if (!(await store.isFeatureEnabled(channel.tenantId))) {
      log('feature_disabled', { channelId: channel.id, tenantId: channel.tenantId });
      decision = { skip: 'feature_disabled' };
    } else {
      log('tenant_resolved', { channelId: channel.id, tenantId: channel.tenantId });
      decision = { channel };
    }
    decisions.set(phoneNumberId, decision);
    return decision;
  }

  for (const event of events) {
    const decision = await decide(event.phoneNumberId);
    if ('skip' in decision) { summary.skipped += 1; continue; }
    const { channel } = decision;

    if (event.kind === 'message') {
      // Une erreur base de données remonte : le webhook répond 500 et Meta réessaie (ingest idempotent).
      const result = await store.ingestInbound(channel.id, event);
      if (result.tenantId !== channel.tenantId) throw new Error('whatsapp_tenant_mismatch');
      if (result.created) {
        summary.ingested += 1;
        summary.toProcess.push({ messageId: result.messageId, tenantId: result.tenantId });
        log('message_ingested', { tenantId: result.tenantId, messageId: result.messageId, conversationId: result.conversationId, type: event.messageType });
      } else {
        summary.duplicates += 1;
        log('duplicate_event', { tenantId: result.tenantId, messageId: result.messageId });
      }
    } else if (event.kind === 'echo') {
      // Réponse humaine depuis le téléphone : enregistrée et automatisation en pause (jamais traitée par le moteur).
      const result = await store.ingestBusinessEcho(channel.id, event, channel.autoResumeMinutes ?? BUSINESS_APP_PAUSE_DEFAULT_MINUTES);
      if (result.tenantId !== channel.tenantId) throw new Error('whatsapp_tenant_mismatch');
      summary.echoes += 1;
      log(result.created ? 'business_echo_ingested' : 'duplicate_event', { tenantId: result.tenantId, messageId: result.messageId, conversationId: result.conversationId });
    } else {
      const result = await store.applyStatus(channel.id, event);
      summary.statuses += 1;
      if (!result.found) log('status_unmatched', { tenantId: channel.tenantId, status: event.status });
      else log('status_applied', { tenantId: channel.tenantId, status: event.status, applied: result.applied, errorCode: event.errorCode });
    }
  }
  return summary;
}
