/**
 * Domain constants of the Help Center (docs/HELP_CENTER.md). No server
 * dependency: importable by the admin UI, the API and the unit tests.
 */

/** Capability to read the guides (migration 174). */
export const HELP_PERMISSION = 'help.view';

/** Commercial entitlements (platform_features). The flag below is NOT one of them. */
export const HELP_FEATURE_STANDARD = 'help_center';
export const HELP_FEATURE_ADVANCED = 'help_center_advanced';

/** Administrative kill-switch (tenant_feature_flags): enabled = Help Center OFF for this tenant. */
export const HELP_DISABLED_FLAG = 'help_center_disabled';

export const HELP_LEVELS = ['disabled', 'standard', 'advanced'] as const;
export type HelpLevel = (typeof HELP_LEVELS)[number];
/** Level an article requires. */
export type HelpArticleLevel = Exclude<HelpLevel, 'disabled'>;

export const HELP_STATUSES = ['draft', 'review', 'published', 'archived'] as const;
export type HelpStatus = (typeof HELP_STATUSES)[number];

export const HELP_LOCALES = ['fr', 'it', 'en'] as const;
export type HelpLocale = (typeof HELP_LOCALES)[number];
export const HELP_DEFAULT_LOCALE: HelpLocale = 'fr';

export const HELP_EVENTS = ['view', 'helpful', 'not_helpful', 'support_opened'] as const;
export type HelpEvent = (typeof HELP_EVENTS)[number];

export const HELP_STATUS_LABELS: Record<HelpStatus, string> = {
  draft: 'Brouillon',
  review: 'En relecture',
  published: 'Publié',
  archived: 'Archivé',
};

export const HELP_LEVEL_LABELS: Record<HelpArticleLevel, string> = { standard: 'Standard', advanced: 'Avancé' };

export const HELP_LIMITS = {
  searchMinChars: 2,
  searchMaxChars: 80,
  searchResults: 20,
  /** Per client IP and per minute (in-memory, per instance). */
  searchPerMinute: 30,
  eventsPerMinute: 60,
  metricsRetentionDays: 180,
  maxBlocks: 80,
  maxStepsPerBlock: 30,
  maxTextLength: 1200,
} as const;

/** Modules offered in the console (key stored in help_articles.module). */
export const HELP_MODULES: Record<string, string> = {
  commandes: 'Commandes',
  catalogue: 'Catalogue',
  promotions: 'Promotions et nouveautés',
  livraison: 'Livraison',
  paiements: 'Paiements',
  evenementiel: 'Événementiel',
  parametres: 'Paramètres et notifications',
  gestion: 'Gestion',
  general: 'Général',
};

export function helpModuleLabel(module: string): string {
  return HELP_MODULES[module] ?? module;
}

/** Article as served to a tenant (published revision only). */
export interface HelpArticleView {
  id: string;
  slug: string;
  module: string;
  minLevel: HelpArticleLevel;
  requiredPermission: string | null;
  requiredFlag: string | null;
  position: number;
  version: number;
  updatedAt: string | null;
  /** Language actually served; differs from the requested one on fallback. */
  localeUsed: HelpLocale;
  title: string;
  summary: string;
  blocks: HelpBlock[];
}

export interface HelpArticleSummary {
  slug: string;
  module: string;
  title: string;
  summary: string;
  localeUsed: HelpLocale;
  stepCount: number;
}

export interface HelpContextRow {
  articleId: string;
  routePattern: string;
  action: string | null;
  priority: number;
}

// ─── Content blocks (structured, never HTML) ─────────────────────────────────

export type HelpBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'callout'; tone: 'info' | 'warning'; text: string }
  | { type: 'image'; src: string; alt: string; caption?: string }
  | { type: 'video'; url: string; title: string }
  | { type: 'related'; slug: string };
