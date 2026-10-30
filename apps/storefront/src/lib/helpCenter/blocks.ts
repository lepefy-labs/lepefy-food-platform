import { z } from 'zod';
import { HELP_LIMITS, type HelpBlock } from './domain';

/**
 * Article content is a list of structured blocks validated here, never HTML:
 * the renderer maps each block to a React element (no dangerouslySetInnerHTML)
 * and the only inline markup is **bold** (rules.parseInline).
 */

const text = z.string().trim().min(1).max(HELP_LIMITS.maxTextLength);

/** Video providers allowed in an embed (privacy-friendly player hosts). */
export const HELP_VIDEO_HOSTS = ['www.youtube-nocookie.com', 'player.vimeo.com', 'www.loom.com'] as const;

export function isAllowedVideoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (!(HELP_VIDEO_HOSTS as readonly string[]).includes(url.hostname)) return false;
    if (url.hostname === 'www.youtube-nocookie.com') return url.pathname.startsWith('/embed/');
    if (url.hostname === 'www.loom.com') return url.pathname.startsWith('/embed/');
    return url.pathname.startsWith('/video/');
  } catch {
    return false;
  }
}

/**
 * Image source: https URL (storage or CDN) or a root-relative path under /help/.
 * Never data:, javascript: or protocol-relative URLs.
 */
export function isAllowedImageSrc(value: string): boolean {
  if (value.startsWith('/help/') && !value.includes('..') && !value.includes('//')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: text.max(160) }).strict(),
  z.object({ type: z.literal('paragraph'), text }).strict(),
  z.object({ type: z.literal('steps'), items: z.array(text).min(1).max(HELP_LIMITS.maxStepsPerBlock) }).strict(),
  z.object({ type: z.literal('callout'), tone: z.enum(['info', 'warning']), text }).strict(),
  z.object({
    type: z.literal('image'),
    src: z.string().max(500).refine(isAllowedImageSrc, 'Image : URL https ou chemin /help/ requis.'),
    alt: text.max(200),
    caption: z.string().trim().max(200).optional(),
  }).strict(),
  z.object({
    type: z.literal('video'),
    url: z.string().max(500).refine(isAllowedVideoUrl, 'Vidéo : hôte non autorisé.'),
    title: text.max(200),
  }).strict(),
  z.object({ type: z.literal('related'), slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80) }).strict(),
]);

const blocksSchema = z.array(blockSchema).max(HELP_LIMITS.maxBlocks);

export type BlocksResult = { ok: true; blocks: HelpBlock[] } | { ok: false; error: string };

export function parseBlocks(input: unknown): BlocksResult {
  const parsed = blocksSchema.safeParse(input);
  if (parsed.success) return { ok: true, blocks: parsed.data as HelpBlock[] };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? ` (bloc ${Number(issue.path[0]) + 1})` : '';
  return { ok: false, error: `${issue?.message ?? 'Contenu invalide.'}${where}` };
}

/** Number of steps of an article (shown as « 3 étapes » in lists). */
export function countSteps(blocks: readonly HelpBlock[]): number {
  return blocks.reduce((total, block) => total + (block.type === 'steps' ? block.items.length : 0), 0);
}
