/**
 * Contrat fournisseur WhatsApp. Meta (Cloud API) est un fournisseur externe :
 * la logique métier vit dans Lepefy et ne dépend que de cette interface.
 * Les routes API n'appellent jamais Graph API directement.
 */

export interface WhatsAppSendResult {
  providerMessageId: string;
}

export interface WhatsAppMediaRef {
  /** Identifiant média Meta (upload préalable) ou URL https publique. */
  id?: string;
  link?: string;
}

export interface WhatsAppTemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'quick_reply' | 'url';
  index?: number;
  parameters: Array<Record<string, unknown>>;
}

export interface WhatsAppProvider {
  readonly kind: 'meta_cloud';
  sendText(to: string, body: string, options?: { previewUrl?: boolean; replyTo?: string }): Promise<WhatsAppSendResult>;
  sendTemplate(to: string, name: string, languageCode: string, components?: WhatsAppTemplateComponent[]): Promise<WhatsAppSendResult>;
  sendInteractive(to: string, interactive: Record<string, unknown>): Promise<WhatsAppSendResult>;
  sendImage(to: string, image: WhatsAppMediaRef & { caption?: string }): Promise<WhatsAppSendResult>;
  sendDocument(to: string, document: WhatsAppMediaRef & { filename?: string; caption?: string }): Promise<WhatsAppSendResult>;
  markAsRead(providerMessageId: string): Promise<void>;
}

export type WhatsAppProviderErrorKind =
  | 'auth'            // jeton invalide/expiré ou permission manquante
  | 'rate_limit'
  | 'outside_window'  // hors fenêtre de 24 h : un template est nécessaire
  | 'recipient'       // destinataire invalide, non autorisé (numéro de test) ou injoignable
  | 'invalid_request'
  | 'transient'       // erreur Meta temporaire (5xx, service indisponible)
  | 'timeout'
  | 'not_configured'  // pas de jeton disponible pour ce canal
  | 'unknown';

/** Erreur fournisseur assainie : jamais de jeton, de payload ni de numéro client. */
export class WhatsAppProviderError extends Error {
  readonly kind: WhatsAppProviderErrorKind;
  readonly code: string | null;
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(params: { kind: WhatsAppProviderErrorKind; code?: string | null; httpStatus?: number | null; message?: string }) {
    super(params.message ?? params.kind);
    this.name = 'WhatsAppProviderError';
    this.kind = params.kind;
    this.code = params.code ?? null;
    this.httpStatus = params.httpStatus ?? null;
    this.retryable = params.kind === 'rate_limit' || params.kind === 'transient';
  }
}
