/**
 * Assistance & suggestions (migration 163, docs/SMART_ASSISTANCE.md) — shared
 * vocabulary. Client-safe: no server imports.
 */

/** Release flag (tenant_feature_flags): absent row = module off for the shop. */
export const SUPPORT_FLAG = 'support_assistance';
/** Capability of the shop team (tenant_admin by default, assignable to custom roles). */
export const SUPPORT_PERMISSION = 'support.use';
export const SUPPORT_ATTACHMENTS_BUCKET = 'support-attachments';

export const SUPPORT_STATUSES = ['new', 'triaged', 'planned', 'in_progress', 'waiting_tenant', 'resolved', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** Simplified status shown to the shop (SQL support_tenant_status). */
export type SupportTenantStatus = 'sent' | 'in_progress' | 'waiting_you' | 'done';

export const SUPPORT_CATEGORIES = ['unspecified', 'problem', 'improvement', 'question'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

/** Channels a request entered by Lepefy can come from; `app` = written in the admin. */
export const SUPPORT_MANUAL_CHANNELS = ['whatsapp', 'phone', 'email', 'internal'] as const;
export type SupportManualChannel = (typeof SUPPORT_MANUAL_CHANNELS)[number];
export type SupportSourceChannel = 'app' | SupportManualChannel;

export type SupportResourceType = 'order' | 'product' | 'customer';
export type SupportLinkKind = 'issue' | 'pull_request' | 'commit' | 'release';

export const SUPPORT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type SupportImageMime = (typeof SUPPORT_IMAGE_MIME_TYPES)[number];

export const SUPPORT_LIMITS = {
  bodyMin: 3,
  bodyMax: 5000,
  attachmentsPerMessage: 5,
  attachmentBytes: 5 * 1024 * 1024,
  /** Uploads per admin and hour (staged + sent). */
  uploadsPerHour: 30,
  similarMinChars: 12,
  improveMinChars: 20,
  improveMaxChars: 2000,
  /** Shop draft kept on the device. */
  draftTtlMs: 24 * 60 * 60 * 1000,
} as const;

/** Choices of the quick panel; `unspecified` = the shop just wrote. */
export const SUPPORT_CATEGORY_CHOICES: ReadonlyArray<{ key: Exclude<SupportCategory, 'unspecified'>; label: string }> = [
  { key: 'problem', label: 'Quelque chose ne fonctionne pas' },
  { key: 'improvement', label: 'Je voudrais améliorer quelque chose' },
  { key: 'question', label: 'J’ai une question' },
];

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  unspecified: 'Non précisée',
  problem: 'Problème',
  improvement: 'Suggestion',
  question: 'Question',
};

export const SUPPORT_CHANNEL_LABELS: Record<SupportSourceChannel, string> = {
  app: 'Administration',
  whatsapp: 'WhatsApp',
  phone: 'Téléphone',
  email: 'E-mail',
  internal: 'Interne',
};

export const SUPPORT_LINK_KIND_LABELS: Record<SupportLinkKind, string> = {
  issue: 'Issue',
  pull_request: 'Pull request',
  commit: 'Commit',
  release: 'Release',
};

export function isSupportCategory(value: unknown): value is SupportCategory {
  return typeof value === 'string' && (SUPPORT_CATEGORIES as readonly string[]).includes(value);
}

export function isSupportStatus(value: unknown): value is SupportStatus {
  return typeof value === 'string' && (SUPPORT_STATUSES as readonly string[]).includes(value);
}

export function isSupportPriority(value: unknown): value is SupportPriority {
  return typeof value === 'string' && (SUPPORT_PRIORITIES as readonly string[]).includes(value);
}

export function isSupportManualChannel(value: unknown): value is SupportManualChannel {
  return typeof value === 'string' && (SUPPORT_MANUAL_CHANNELS as readonly string[]).includes(value);
}

/** « n° 1042 » — the reference the shop and Lepefy quote. */
export function supportReference(number: number | string): string {
  return `n° ${number}`;
}
