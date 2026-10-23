/**
 * Mise en forme des messages simulés de la démo (pur, testé) : le destinataire
 * est masqué, le contenu réduit à un aperçu texte. Rien n'est envoyé.
 */

export function maskRecipient(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const at = raw.indexOf('@');
  if (at > 0) {
    const local = raw.slice(0, at);
    const domain = raw.slice(at + 1);
    return `${local[0]}***@${domain}`.slice(0, 120);
  }
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.replace('+', '').length >= 6) return `${digits.slice(0, 4)}…${digits.slice(-2)}`;
  return '***';
}

export function htmlToPreview(html: unknown, max = 600): string | null {
  if (typeof html !== 'string' || !html.trim()) return null;
  const text = html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface SimulatedMessageDraft {
  channel: 'email' | 'whatsapp' | 'n8n' | 'shipping';
  kind: string;
  recipientHint: string | null;
  subject: string | null;
  preview: string | null;
}

/** Ce que la démo garde d'une notification qui serait partie par sendNotification(). */
export function draftFromNotification(webhookPath: string, payload: Record<string, unknown>): SimulatedMessageDraft {
  const recipients = Array.isArray(payload.recipients) ? payload.recipients : [];
  const firstRecipient = recipients[0] ?? payload.customerEmail ?? payload.email ?? payload.to ?? null;
  const isEmail = typeof payload.html === 'string' || typeof payload.subject === 'string';
  const kind = typeof payload.notificationType === 'string' ? payload.notificationType : webhookPath.replace(/^\/webhook\//, '');
  return {
    channel: isEmail ? 'email' : 'n8n',
    kind: kind.slice(0, 120) || 'notification',
    recipientHint: maskRecipient(firstRecipient),
    subject: typeof payload.subject === 'string' ? payload.subject.slice(0, 300) : null,
    preview: htmlToPreview(payload.html) ?? null,
  };
}
