import { z } from 'zod';
import type { StudioOrigin, StudioStyleInstructions } from './domain';

/**
 * Visual pattern of the shop (« style de la boutique ») and the prompts sent
 * to the image provider. Versioned in `studio_style_versions` (immutable rows):
 * every proposal records the version it was made with.
 *
 * The default follows docs/STOREFRONT_PRODUCT_IMAGE_RUNBOOK.md (square,
 * seamless warm off-white background, soft diffused light, grounded shadow,
 * 10–12 % safe margin, no invented label facts, no props/people/watermark).
 */

const text = (max: number) => z.string().trim().min(1).max(max);

export const studioStyleSchema = z.object({
  version: z.literal(1),
  summary: text(120),
  background: text(400),
  lighting: text(400),
  composition: text(500),
  mood: text(300),
  palette: text(300),
  photoGuidance: text(1200),
  ideaGuidance: text(1200),
  avoid: z.array(text(160)).max(20),
}).strict();

export const DEFAULT_STUDIO_STYLE: StudioStyleInstructions = {
  version: 1,
  summary: 'Fond clair chaud, lumière douce, sujet centré',
  background: 'seamless warm off-white or very light neutral studio background',
  lighting: 'soft diffused studio light with a subtle, physically plausible grounded shadow; natural colours, sRGB',
  composition: 'square 1:1 frame; the subject is centred, fully visible and occupies roughly 55–65 % of the frame height, with a safe margin of at least 10–12 % on every side so nothing is cropped on the storefront',
  mood: 'clean, credible and appetising e-commerce photography; natural textures preserved',
  palette: 'neutral background that lets the real colours of the food and packaging stand out',
  photoGuidance: 'Keep the real subject exactly as it is: same package shape and material, same label, logo and printed text, same visible contents and colours. Only improve background, light, framing and cleanliness, unless the request explicitly asks for a precise change.',
  ideaGuidance: 'Create an appetising, specific and culturally respectful food or ingredient scene, with warm natural light. It is an atmosphere image: it must not depict any branded or packaged product.',
  avoid: [
    'invented or rewritten text, letters or numbers',
    'logos, brand names or labels that were not in the source photo',
    'invented ingredients, certifications, health or origin claims',
    'people, hands or faces',
    'watermarks, frames or borders',
    'cropped subject touching the edges',
    'multiple copies of the same package',
    'floating objects or harsh shadows',
    'stereotyped or decorative cultural clichés',
  ],
};

export function parseStudioStyle(value: unknown): StudioStyleInstructions | null {
  const parsed = studioStyleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface PromptInput {
  origin: StudioOrigin;
  style: StudioStyleInstructions;
  /** Optional request for a photo, required description for an idea. */
  request: string | null;
  /** Correction of an existing proposal (the input image is that proposal). */
  correction: string | null;
}

/**
 * Prompt in English (best followed by the image models). The user's French
 * words are quoted verbatim: the model translates them itself, and nothing the
 * user writes can remove the safety constraints written around them.
 */
export function buildStudioPrompt(input: PromptInput): string {
  const { style } = input;
  const avoid = style.avoid.map((item) => '- ' + item).join('\n');
  const quote = (value: string) => '"' + value.replace(/"/g, '\'') + '"';

  if (input.correction) {
    return [
      'Edit the supplied image. Apply ONLY the following change requested by the shop (written in French), and keep everything else identical: subject, packaging, label, logo, printed text, colours, framing and lighting.',
      'Requested change: ' + quote(input.correction),
      input.origin === 'prompt'
        ? 'This is an atmosphere image: it must still show no packaging, brand, logo, label, written text or numbers.'
        : 'Never invent or alter text, logos or label information on the product.',
      'Keep the composition: ' + style.composition + '.',
      'Avoid:\n' + avoid,
    ].join('\n\n');
  }

  if (input.origin === 'photo') {
    return [
      'Transform the supplied photo into a polished square e-commerce image for an online food shop.',
      style.photoGuidance,
      input.request ? 'Additional request from the shop (written in French), to apply precisely: ' + quote(input.request) : '',
      'Background: ' + style.background + '.',
      'Lighting: ' + style.lighting + '.',
      'Composition: ' + style.composition + '.',
      'Mood: ' + style.mood + '. Palette: ' + style.palette + '.',
      'Avoid:\n' + avoid,
    ].filter(Boolean).join('\n\n');
  }

  return [
    'Create a photorealistic square image for an online food shop.',
    'Description from the shop (written in French): ' + quote(input.request ?? ''),
    style.ideaGuidance,
    'Strict rule: show no packaging, no branded product, no logo, no label, no written text, letters or numbers of any kind, even if the description mentions a brand or a product name.',
    'Background: ' + style.background + '.',
    'Lighting: ' + style.lighting + '.',
    'Composition: ' + style.composition + '.',
    'Mood: ' + style.mood + '. Palette: ' + style.palette + '.',
    'Avoid:\n' + avoid,
  ].join('\n\n');
}
