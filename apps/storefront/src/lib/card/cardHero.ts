import { z } from 'zod';

/**
 * Photo de la hero /card, personnalisable par tenant sans migration :
 *   1. `tenant_feature_settings('digital_card').config.hero_image_url` (+
 *      `hero_image_position`, CSS object-position), lu par getCardHeroImage ;
 *   2. sinon l'asset du tenant livré avec le code (CARD_HERO_ASSETS) ;
 *   3. sinon aucune photo : la hero garde un dégradé aux couleurs du tenant.
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

export const digitalCardConfigSchema = z.object({
  hero_image_url: z.string().trim().max(500).nullable(),
  hero_image_position: z.string().trim().max(40).nullable(),
});

export type DigitalCardConfig = z.infer<typeof digitalCardConfigSchema>;

export const DIGITAL_CARD_DEFAULTS: DigitalCardConfig = { hero_image_url: null, hero_image_position: null };

export interface CardHeroImageSource {
  type: 'image/avif' | 'image/webp';
  srcSet: string;
}

export interface CardHeroImage {
  /** Image de repli du `<img>` (navigateur sans `<picture>`/AVIF). */
  src: string;
  /** Valeur CSS `object-position` : garde le sujet visible sur mobile comme sur desktop. */
  position: string;
  /** Variantes statiques pré-générées, de la plus compacte à la plus compatible. */
  sources?: CardHeroImageSource[];
}

/** Asset public décliné en `<base>-<largeur>.avif|webp` (jamais agrandi au-delà de l'original). */
export function staticHeroAsset(base: string, widths: readonly number[], position: string): CardHeroImage {
  const srcSet = (ext: string) => widths.map((w) => `${base}-${w}.${ext} ${w}w`).join(', ');
  const fallback = widths[Math.min(1, widths.length - 1)];
  return {
    src: `${base}-${fallback}.webp`,
    position,
    sources: [{ type: 'image/avif', srcSet: srcSet('avif') }, { type: 'image/webp', srcSet: srcSet('webp') }],
  };
}

const DEFAULT_POSITION = 'center';

/** Assets livrés avec le code, par slug : photo réelle d'un client qui paie, sujet à droite. */
export const CARD_HERO_ASSETS: Record<string, CardHeroImage> = {
  chloefood: staticHeroAsset('/images/card/chloefood-hero-payment', [480, 800, 1122], '72% 28%'),
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
  if (configured && isAllowedHeroImageUrl(configured, input.supabaseUrl)) {
    return { src: configured.trim(), position: normalizeHeroPosition(input.config?.hero_image_position) ?? DEFAULT_POSITION };
  }
  const asset = CARD_HERO_ASSETS[input.slug];
  if (!asset) return null;
  return { ...asset, position: normalizeHeroPosition(input.config?.hero_image_position) ?? asset.position };
}
