import type { HeroSlideBackgroundVariant } from '@lepefy/types';

/**
 * Rules shared by the slide editor, the slide API and the storefront
 * carousel. A CTA link is either an internal path (« /products ») or an
 * https URL — never javascript:, data:, protocol-relative or plain http.
 */

export const VARIANT_LABELS: Record<HeroSlideBackgroundVariant, string> = {
  primary: 'Couleur principale',
  secondary: 'Couleur secondaire',
  accent: 'Contraste fort',
};
export const VALID_VARIANTS = Object.keys(VARIANT_LABELS) as HeroSlideBackgroundVariant[];

export const SLIDE_LIMITS = { badge: 40, title: 120, subtitle: 240, ctaLabel: 40, url: 500 } as const;

/** Safe href or null. */
export function safeSlideHref(value: unknown): string | null {
  const url = String(value ?? '').trim();
  if (!url || url.length > SLIDE_LIMITS.url) return null;
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null;
  } catch {
    return null;
  }
}

export interface SlideFields {
  badge_text: string;
  title: string;
  subtitle: string;
  cta_primary_label: string;
  cta_primary_url: string;
  cta_secondary_label: string;
  cta_secondary_url: string;
}

/** Blocking issues, in French, shown by the form and returned by the API. */
export function slideIssues(form: Partial<SlideFields>): string[] {
  const issues: string[] = [];
  const text = (key: keyof SlideFields) => String(form[key] ?? '').trim();
  if (!text('title')) issues.push('Le titre est obligatoire.');
  if (text('title').length > SLIDE_LIMITS.title) issues.push(`Le titre dépasse ${SLIDE_LIMITS.title} caractères.`);
  if (text('subtitle').length > SLIDE_LIMITS.subtitle) issues.push(`Le sous-titre dépasse ${SLIDE_LIMITS.subtitle} caractères.`);
  if (text('badge_text').length > SLIDE_LIMITS.badge) issues.push(`Le badge dépasse ${SLIDE_LIMITS.badge} caractères.`);
  for (const [labelKey, urlKey, name] of [
    ['cta_primary_label', 'cta_primary_url', 'principal'],
    ['cta_secondary_label', 'cta_secondary_url', 'secondaire'],
  ] as const) {
    const label = text(labelKey), url = text(urlKey);
    if (Boolean(label) !== Boolean(url)) issues.push(`Le bouton ${name} a besoin d’un libellé et d’un lien (ou d’aucun des deux).`);
    else if (url && !safeSlideHref(url)) issues.push(`Le lien du bouton ${name} doit commencer par « / » (page de la boutique) ou « https:// ».`);
    if (label.length > SLIDE_LIMITS.ctaLabel) issues.push(`Le libellé du bouton ${name} dépasse ${SLIDE_LIMITS.ctaLabel} caractères.`);
  }
  return issues;
}

/** New positions 0..n-1 following the given order; ids not in `current` are rejected. */
export function reorderPositions(currentIds: string[], orderedIds: string[]): Array<{ id: string; position: number }> | null {
  if (orderedIds.length !== currentIds.length) return null;
  const known = new Set(currentIds);
  if (new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !known.has(id))) return null;
  return orderedIds.map((id, position) => ({ id, position }));
}

/** Moves the item at `index` by `direction`, returning the new id order (unchanged at the edges). */
export function moveId(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as string);
  return next;
}
