/**
 * Normalisation des notifications webhook WhatsApp Cloud API
 * (object = whatsapp_business_account, field = messages).
 *
 * Fonction pure : le payload brut n'est jamais persisté. On ne garde que le
 * strict nécessaire au traitement (texte, type, identifiants techniques) ;
 * localisation, contacts partagés et médias sont réduits à des marqueurs.
 */

export type WhatsAppDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Identité client : numéro (wa_id, absent si le client utilise un username et
 * que le numéro n'est pas disponible) et/ou business-scoped user ID Meta
 * (BSUID, `user_id`, toujours présent dans les webhooks récents). Au moins un.
 */
export interface CustomerIdentity {
  waId: string | null;
  userId: string | null;
}

export interface InboundMessageEvent extends CustomerIdentity {
  kind: 'message';
  phoneNumberId: string;
  profileName: string | null;
  providerMessageId: string;
  timestamp: Date | null;
  messageType: string;
  body: string | null;
  metadata: Record<string, string | number | boolean>;
}

export interface StatusEvent {
  kind: 'status';
  phoneNumberId: string;
  providerMessageId: string;
  status: WhatsAppDeliveryStatus;
  timestamp: Date | null;
  errorCode: string | null;
  errorTitle: string | null;
}

/** Message écrit par l'équipe dans l'app WhatsApp Business (coexistence, champ smb_message_echoes). */
export interface BusinessEchoEvent extends CustomerIdentity {
  kind: 'echo';
  phoneNumberId: string;
  providerMessageId: string;
  timestamp: Date | null;
  messageType: string;
  body: string | null;
  metadata: Record<string, string | number | boolean>;
}

export type WhatsAppWebhookEvent = InboundMessageEvent | StatusEvent | BusinessEchoEvent;

export interface ParsedWebhook {
  /** false si le payload n'est pas une notification WhatsApp Business (ignoré, 200). */
  recognized: boolean;
  events: WhatsAppWebhookEvent[];
  /** Éléments malformés ou hors périmètre, comptés pour l'observabilité. */
  ignored: number;
}

const MAX_BODY = 4096;
const MAX_EVENTS = 200;

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, max = 500): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function digits(value: unknown, min: number, max: number): string | null {
  const raw = str(value, 40);
  return raw && new RegExp(`^[0-9]{${min},${max}}$`).test(raw) ? raw : null;
}

/** BSUID : code pays ISO, point, éventuellement "ENT.", puis jusqu'à 128 caractères alphanumériques. */
export const BSUID_PATTERN = /^[A-Z]{2}(.ENT)?.[A-Za-z0-9]{1,128}$/;

function bsuid(value: unknown): string | null {
  const raw = str(value, 140);
  return raw && BSUID_PATTERN.test(raw) ? raw : null;
}

function epochSeconds(value: unknown): Date | null {
  const raw = str(value, 20);
  if (!raw || !/^\d{9,11}$/.test(raw)) return null;
  const date = new Date(Number(raw) * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

function providerId(value: unknown): string | null {
  const raw = str(value, 200);
  return raw && raw.length >= 8 && /^[A-Za-z0-9._=:+/-]+$/.test(raw) ? raw : null;
}

function messageType(value: unknown): string {
  const raw = str(value, 32)?.toLowerCase() ?? '';
  return /^[a-z_]{2,32}$/.test(raw) ? raw : 'unsupported';
}

function extractContent(message: Json, type: string): { body: string | null; metadata: InboundMessageEvent['metadata'] } {
  const metadata: InboundMessageEvent['metadata'] = {};
  const context = obj(message.context);
  const replyTo = providerId(context?.id);
  if (replyTo) metadata.reply_to = replyTo;

  switch (type) {
    case 'text':
      return { body: str(obj(message.text)?.body, MAX_BODY), metadata };
    case 'button': {
      const button = obj(message.button);
      const payload = str(button?.payload, 128);
      if (payload) metadata.button_payload = payload;
      return { body: str(button?.text, MAX_BODY), metadata };
    }
    case 'interactive': {
      const interactive = obj(message.interactive);
      const reply = obj(interactive?.button_reply) ?? obj(interactive?.list_reply);
      const id = str(reply?.id, 128);
      if (id) metadata.interactive_id = id;
      return { body: str(reply?.title, MAX_BODY), metadata };
    }
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker': {
      const media = obj(message[type]);
      const mediaId = str(media?.id, 64);
      const mime = str(media?.mime_type, 80);
      if (mediaId) metadata.media_id = mediaId;
      if (mime) metadata.mime_type = mime;
      return { body: str(media?.caption, MAX_BODY), metadata };
    }
    case 'reaction': {
      const reaction = obj(message.reaction);
      const target = providerId(reaction?.message_id);
      if (target) metadata.reaction_to = target;
      const emoji = str(reaction?.emoji, 16);
      if (emoji) metadata.emoji = emoji;
      return { body: null, metadata };
    }
    case 'location':
      // Coordonnées non conservées (minimisation) : seul le fait qu'une position a été partagée.
      metadata.location_shared = true;
      return { body: null, metadata };
    case 'contacts':
      metadata.contacts_shared = true;
      return { body: null, metadata };
    default:
      return { body: null, metadata };
  }
}

export function parseWhatsAppWebhook(payload: unknown): ParsedWebhook {
  const root = obj(payload);
  if (!root || root.object !== 'whatsapp_business_account') return { recognized: false, events: [], ignored: 0 };

  const events: WhatsAppWebhookEvent[] = [];
  let ignored = 0;

  for (const entry of arr(root.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const changeObj = obj(change);
      const value = obj(changeObj?.value);
      const field = changeObj?.field;
      if ((field !== 'messages' && field !== 'smb_message_echoes') || !value) { ignored += 1; continue; }
      const phoneNumberId = digits(obj(value.metadata)?.phone_number_id, 5, 32);
      if (!phoneNumberId) { ignored += 1; continue; }

      if (field === 'smb_message_echoes') {
        for (const echo of arr(value.message_echoes)) {
          const echoObj = obj(echo);
          const id = providerId(echoObj?.id);
          const waId = digits(echoObj?.to, 6, 20);
          const userId = bsuid(echoObj?.to_user_id ?? echoObj?.recipient_user_id);
          const type = messageType(echoObj?.type);
          // Modifications / suppressions depuis l'app : non reflétées dans cette version.
          if (!echoObj || !id || (!waId && !userId) || type === 'edit' || type === 'revoke') { ignored += 1; continue; }
          const { body, metadata } = extractContent(echoObj, type);
          events.push({ kind: 'echo', phoneNumberId, waId, userId, providerMessageId: id, timestamp: epochSeconds(echoObj.timestamp), messageType: type, body, metadata });
        }
        continue;
      }

      const names = new Map<string, string>();
      for (const contact of arr(value.contacts)) {
        const contactObj = obj(contact);
        const name = str(obj(contactObj?.profile)?.name, 120);
        if (!name) continue;
        const waId = digits(contactObj?.wa_id, 6, 20);
        const userId = bsuid(contactObj?.user_id);
        if (waId) names.set(waId, name);
        if (userId) names.set(userId, name);
      }

      for (const message of arr(value.messages)) {
        const messageObj = obj(message);
        const waId = digits(messageObj?.from, 6, 20);
        const userId = bsuid(messageObj?.from_user_id);
        const id = providerId(messageObj?.id);
        if (!messageObj || (!waId && !userId) || !id) { ignored += 1; continue; }
        const type = messageType(messageObj.type);
        const { body, metadata } = extractContent(messageObj, type);
        events.push({
          kind: 'message',
          phoneNumberId,
          waId,
          userId,
          profileName: (userId && names.get(userId)) || (waId && names.get(waId)) || null,
          providerMessageId: id,
          timestamp: epochSeconds(messageObj.timestamp),
          messageType: type,
          body,
          metadata,
        });
      }

      for (const status of arr(value.statuses)) {
        const statusObj = obj(status);
        const id = providerId(statusObj?.id);
        const state = str(statusObj?.status, 20);
        if (!statusObj || !id || !state || !['sent', 'delivered', 'read', 'failed'].includes(state)) { ignored += 1; continue; }
        const error = obj(arr(statusObj.errors)[0]);
        events.push({
          kind: 'status',
          phoneNumberId,
          providerMessageId: id,
          status: state as WhatsAppDeliveryStatus,
          timestamp: epochSeconds(statusObj.timestamp),
          errorCode: str(error?.code, 32),
          errorTitle: str(error?.title ?? error?.message, 200),
        });
      }
    }
  }

  if (events.length > MAX_EVENTS) {
    ignored += events.length - MAX_EVENTS;
    events.length = MAX_EVENTS;
  }
  return { recognized: true, events, ignored };
}
