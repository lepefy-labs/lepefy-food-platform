import { z } from 'zod';
import { openingHoursSchema } from './openingHours';

/**
 * Réglages de la carte digitale, une ligne `tenant_feature_settings
 * ('digital_card')` (aucune migration ; son `enabled` n'est lu par rien) :
 * photo de la hero et horaires structurés (`opening_hours`, lib/card/openingHours.ts).
 *
 * Photo de la hero /card, par ordre de priorité :
 *   1. photo téléversée depuis l'admin (Contenu public) : variantes
 *      `${hero_image_base}-${largeur}.avif|webp` dans le stockage Supabase ;
 *   2. `hero_image_url` (URL unique, réglage technique antérieur) ;
 *   3. l'asset du tenant livré avec le code (CARD_HERO_ASSETS) ;
 *   4. aucune photo : la hero garde un dégradé aux couleurs du tenant.
 * `hero_image_position` (CSS object-position) s'applique à chacune.
 * Seules deux origines sont acceptées : un fichier du dossier public
 * `/images/…` ou le stockage public Supabase du projet, jamais une URL tierce
 * arbitraire. La photo n'utilise jamais `/_next/image` : la quota Vercel Image
 * Optimization est épuisée (docs/IMAGE_OPTIMIZATION_AUDIT.md) et toute
 * transformation non encore en cache répond 402. Les assets du code sont donc
 * livrés pré-déclinés en AVIF/WebP à plusieurs largeurs (`<picture>` +
 * `srcset`), une URL configurée est servie telle quelle. Pur, testé dans
 * tests/unit/cardLanding.spec.ts.
 */
export const DIGITAL_CARD_FEATURE_KEY = 'digital_card';

export const HERO_UPLOAD_WIDTHS = [480, 800, 1200] as const;

export const digitalCardConfigSchema = z.object({
  hero_image_url: z.string().trim().max(500).nullable(),
  hero_image_position: z.string().trim().max(40).nullable(),
  hero_image_base: z.string().trim().max(500).nullable(),
  hero_image_widths: z.array(z.number().int().min(160).max(2400)).min(1).max(6).nullable(),
  opening_hours: openingHoursSchema.nullable(),
});

export type DigitalCardConfig = z.infer<typeof digitalCardConfigSchema>;

export const DIGITAL_CARD_DEFAULTS: DigitalCardConfig = {
  hero_image_url: null, hero_image_position: null, hero_image_base: null, hero_image_widths: null, opening_hours: null,
};

export interface CardHeroImageSource {
  type: 'image/avif' | 'image/webp';
  srcSet: string;
}

export interface CardHeroImage {
  /** Image de repli du `<img>` (navigateur sans `<picture>`/AVIF). */
  src: string;
  /** Valeur CSS `object-position` côte à côte (≥ 540 px) : garde le sujet visible. */
  position: string;
  /** Cadrage de la bande photo mobile (4:3) ; par défaut `position`. */
  mobilePosition?: string;
  /** Variantes statiques pré-générées, de la plus compacte à la plus compatible. */
  sources?: CardHeroImageSource[];
}

/** Asset public décliné en `<base>-<largeur>.avif|webp` (jamais agrandi au-delà de l'original). */
export function staticHeroAsset(base: string, widths: readonly number[], position: string, mobilePosition?: string): CardHeroImage {
  const srcSet = (ext: string) => widths.map((w) => `${base}-${w}.${ext} ${w}w`).join(', ');
  const fallback = widths[Math.min(1, widths.length - 1)];
  return {
    src: `${base}-${fallback}.webp`,
    position,
    ...(mobilePosition ? { mobilePosition } : {}),
    sources: [{ type: 'image/avif', srcSet: srcSet('avif') }, { type: 'image/webp', srcSet: srcSet('webp') }],
  };
}

const DEFAULT_POSITION = 'center';

/** Assets livrés avec le code, par slug : photo réelle d'un client qui paie, sujet à droite. */
export const CARD_HERO_ASSETS: Record<string, CardHeroImage> = {
  chloefood: staticHeroAsset('/images/card/chloefood-hero-payment', [480, 800, 1122], '72% 28%', '74% 52%'),
};

const POSITION_TOKEN = /^(?:left|center|right|top|bottom|\d{1,3}%)$/;

export function normalizeHeroPosition(value: string | null | undefined): string | null {
  const tokens = value?.trim().split(/\s+/) ?? [];
  if (tokens.length === 0 || tokens.length > 2 || !tokens.every((token) => POSITION_TOKEN.test(token))) return null;
  return tokens.join(' ');
}

export function isAllowedHeroImageUrl(url: string | null | undefined, supabaseUrl: string | null | undefined): boolean {
  const value = url?.trim();
  if (!value) return false;
  if (value.startsWith('/images/')) return !value.includes('..') && !value.includes('//') && !/[?#\\]/.test(value);
  const base = supabaseUrl?.trim().replace(/\/+$/, '');
  if (!base || !/^https:\/\//i.test(base)) return false;
  return value.startsWith(`${base}/storage/v1/object/public/`) && !value.includes('..');
}

export function resolveCardHeroImage(input: {
  slug: string;
  config?: Partial<DigitalCardConfig> | null;
  supabaseUrl?: string | null;
}): CardHeroImage | null {
  const configured = input.config?.hero_image_url;
  const configuredPosition = normalizeHeroPosition(input.config?.hero_image_position);
  const base = input.config?.hero_image_base;
  const widths = input.config?.hero_image_widths;
  if (base && widths?.length && isAllowedHeroImageUrl(base, input.supabaseUrl) && !/[?#]/.test(base)) {
    return staticHeroAsset(base, [...widths].sort((a, b) => a - b), configuredPosition ?? DEFAULT_POSITION);
  }
  if (configured && isAllowedHeroImageUrl(configured, input.supabaseUrl)) {
    return { src: configured.trim(), position: configuredPosition ?? DEFAULT_POSITION };
  }
  const asset = CARD_HERO_ASSETS[input.slug];
  if (!asset) return null;
  // Un cadrage configuré s'applique partout (mobile compris).
  return configuredPosition ? { src: asset.src, sources: asset.sources, position: configuredPosition } : asset;
}
