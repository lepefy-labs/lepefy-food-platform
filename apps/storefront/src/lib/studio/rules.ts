import {
  STUDIO_LIMITS,
  type StudioAssetStatus,
  type StudioCrop,
  type StudioLibraryView,
  type StudioQuotaView,
} from './domain';

/**
 * Pure rules of the Studio (shared by API, worker and UI; unit-tested).
 * The state machine itself lives in the 183 RPCs; these helpers mirror it for
 * the interface and never replace the server check.
 */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);

/** Client request keys (idempotent retries): 8–100 safe characters. */
export const REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
export const isRequestKey = (value: unknown): value is string => typeof value === 'string' && REQUEST_KEY_PATTERN.test(value);

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // Control characters out, spaces collapsed, never longer than the column.
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

/** Title proposed from the request when the user gave none. */
export function defaultTitle(origin: 'photo' | 'prompt', request: string | null, now = new Date()): string {
  const words = (request ?? '').split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  if (words) return words.charAt(0).toUpperCase() + words.slice(1, STUDIO_LIMITS.titleChars);
  const date = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }).format(now);
  return (origin === 'photo' ? 'Photo du ' : 'Idée du ') + date;
}

// ─── Library views ────────────────────────────────────────────────────────────

export const STUDIO_VIEW_LABELS: Record<StudioLibraryView, string> = {
  'a-valider': 'À valider',
  pretes: 'Prêtes',
  utilisees: 'Utilisées',
  'en-cours': 'En cours',
  toutes: 'Toutes',
  ecartees: 'Écartées',
};

/** Statuses of a view; `utilisees`/`pretes` also split on active usages (server side). */
export function viewStatuses(view: StudioLibraryView): StudioAssetStatus[] {
  switch (view) {
    case 'a-valider': return ['review'];
    case 'pretes':
    case 'utilisees': return ['approved'];
    case 'en-cours': return ['processing', 'failed'];
    case 'ecartees': return ['discarded', 'archived'];
    case 'toutes': return ['processing', 'review', 'approved', 'failed'];
  }
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/** SQL exceptions of the 183 RPCs → HTTP status + French message. */
export const STUDIO_ERRORS: Record<string, { status: number; message: string }> = {
  studio_quota_exceeded: { status: 429, message: 'Vous avez utilisé toutes les créations du mois. Elles reviennent le 1er du mois prochain.' },
  studio_budget_exceeded: { status: 429, message: 'Le budget de création du mois est atteint. Les créations reprennent le 1er du mois prochain.' },
  studio_invalid_request: { status: 400, message: 'La demande est incomplète. Vérifiez la photo ou le texte puis réessayez.' },
  studio_invalid_transition: { status: 409, message: 'Cette action n’est plus possible : l’image a changé. Rechargez la page.' },
  studio_not_found: { status: 404, message: 'Image introuvable.' },
  studio_busy: { status: 409, message: 'Une création est déjà en cours pour cette image. Attendez la fin avant de demander autre chose.' },
  studio_in_use: { status: 409, message: 'Cette image est utilisée. Retirez-la de ses emplacements avant de l’écarter.' },
  studio_not_approved: { status: 409, message: 'Approuvez d’abord une version de l’image.' },
  studio_style_changed: { status: 409, message: 'Le style de la boutique vient de changer. Rechargez la page puis réessayez.' },
  studio_style_immutable: { status: 409, message: 'Un style publié ne se modifie pas : publiez une nouvelle version.' },
  studio_forbidden_destination: { status: 403, message: 'Vous n’avez pas le droit de modifier cet emplacement.' },
  studio_unknown_destination: { status: 400, message: 'Cet emplacement n’existe pas.' },
  studio_events_disabled: { status: 404, message: 'Le module Événementiel n’est pas activé pour cette boutique.' },
  studio_target_missing: { status: 404, message: 'L’élément choisi n’existe plus.' },
  studio_target_conflict: { status: 409, message: 'L’emplacement vient d’être modifié par quelqu’un d’autre. Rien n’a été remplacé : réessayez.' },
  studio_gallery_full: { status: 409, message: 'La galerie de ce produit est complète (8 images). Retirez une image puis réessayez.' },
  studio_image_too_small: { status: 400, message: 'L’image est trop petite pour cet emplacement.' },
  studio_ambiance_confirmation: { status: 409, message: 'Cette image a été créée sans photo : confirmez qu’elle n’est qu’une illustration avant de l’utiliser ici.' },
  studio_publish_failed: { status: 502, message: 'La publication n’a pas abouti. Rien n’a été modifié sur la boutique : réessayez.' },
  studio_upload_invalid: { status: 400, message: 'Photo illisible. Choisissez une photo JPEG, PNG ou WebP.' },
  studio_upload_small: { status: 400, message: 'Photo trop petite : 320 px minimum sur le plus petit côté.' },
  studio_upload_missing: { status: 400, message: 'La photo n’a pas été reçue. Choisissez-la à nouveau.' },
};

export function studioErrorCode(error: unknown): string | null {
  const message = (error as { message?: string } | null)?.message ?? '';
  const code = message.match(/studio_[a-z_]+/)?.[0] ?? null;
  return code && code in STUDIO_ERRORS ? code : null;
}

/** Job error codes → explanation shown with « Réessayer » (never a provider detail). */
export const STUDIO_JOB_ERROR_MESSAGES: Record<string, string> = {
  provider_timeout: 'Le service d’images n’a pas répondu à temps.',
  rate_limit: 'Le service d’images est très sollicité en ce moment.',
  provider_billing: 'Le service d’images est momentanément indisponible. Lepefy a été prévenu ; réessayez plus tard.',
  safety_blocked: 'Le service d’images a refusé cette demande. Reformulez-la (sans personne réelle, marque ou contenu sensible).',
  no_image: 'Le service d’images n’a pas renvoyé d’image pour cette demande. Reformulez-la plus simplement.',
  invalid_output: 'L’image reçue était illisible.',
  source_missing: 'La photo d’origine n’est plus disponible. Créez une nouvelle image.',
  missing_credential: 'Le service d’images n’est pas configuré. Lepefy a été prévenu.',
  model_unavailable: 'Le service d’images est indisponible pour le moment.',
  no_enabled_model: 'Le service d’images n’est pas configuré. Lepefy a été prévenu.',
  worker_interrupted: 'La création a été interrompue.',
  provider_error: 'Le service d’images a rencontré une erreur.',
};

export function jobErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return STUDIO_JOB_ERROR_MESSAGES[code] ?? STUDIO_JOB_ERROR_MESSAGES.provider_error!;
}

/** Retrying the same call can succeed (else: the request must change). */
export function isRetryableJobError(code: string): boolean {
  return code === 'provider_timeout' || code === 'rate_limit' || code === 'provider_error' || code === 'model_unavailable' || code === 'invalid_output';
}

// ─── Quota ────────────────────────────────────────────────────────────────────

export function quotaView(row: { out_used?: number | null; out_limit?: number | null; out_cost_usd?: number | string | null; out_budget_usd?: number | string | null } | null): StudioQuotaView {
  const used = Number(row?.out_used ?? 0);
  const limit = Number(row?.out_limit ?? STUDIO_LIMITS.defaultMonthlyRevisions);
  const costUsd = Number(row?.out_cost_usd ?? 0);
  const budgetUsd = Number(row?.out_budget_usd ?? STUDIO_LIMITS.defaultMonthlyBudgetUsd);
  const remaining = costUsd >= budgetUsd ? 0 : Math.max(0, limit - used);
  return { used, limit, costUsd, budgetUsd, remaining };
}

// ─── Formats ──────────────────────────────────────────────────────────────────

/** `w:h` → ratio; null = free format (the image keeps its own proportions). */
export function aspectValue(aspect: string | null): number | null {
  if (!aspect) return null;
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(aspect);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? w / h : null;
}

/** Largest centred crop of the given ratio (fractions of the image). */
export function centeredCrop(width: number, height: number, ratio: number | null): StudioCrop {
  if (!ratio || width <= 0 || height <= 0) return { x: 0, y: 0, width: 1, height: 1 };
  const imageRatio = width / height;
  if (Math.abs(imageRatio - ratio) < 0.005) return { x: 0, y: 0, width: 1, height: 1 };
  if (imageRatio > ratio) {
    const w = ratio / imageRatio;
    return { x: round4((1 - w) / 2), y: 0, width: round4(w), height: 1 };
  }
  const h = imageRatio / ratio;
  return { x: 0, y: round4((1 - h) / 2), width: 1, height: round4(h) };
}

/**
 * Validates a crop chosen in the preview (the user moved the frame): inside
 * the image and of the destination ratio. Anything else falls back to the
 * centred crop, so the server never trusts a browser rectangle blindly.
 */
export function sanitizeCrop(input: unknown, width: number, height: number, ratio: number | null): StudioCrop {
  const fallback = centeredCrop(width, height, ratio);
  if (!ratio || !input || typeof input !== 'object') return fallback;
  const crop = input as Record<string, unknown>;
  const values = [crop.x, crop.y, crop.width, crop.height].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return fallback;
  const [x, y, w, h] = values as [number, number, number, number];
  if (w <= 0.05 || h <= 0.05 || x < -0.001 || y < -0.001 || x + w > 1.001 || y + h > 1.001) return fallback;
  const pixelRatio = (w * width) / (h * height);
  if (Math.abs(pixelRatio - ratio) / ratio > 0.02) return fallback;
  // Moving the frame never changes its size: only the centred size is accepted.
  if (Math.abs(w - fallback.width) > 0.01 || Math.abs(h - fallback.height) > 0.01) return fallback;
  return { x: round4(clamp(x, 0, 1 - fallback.width)), y: round4(clamp(y, 0, 1 - fallback.height)), width: fallback.width, height: fallback.height };
}

/** Crop fractions → integer pixel rectangle inside the image. */
export function cropToPixels(crop: StudioCrop, width: number, height: number): { left: number; top: number; width: number; height: number } {
  const left = clamp(Math.round(crop.x * width), 0, width - 1);
  const top = clamp(Math.round(crop.y * height), 0, height - 1);
  return {
    left,
    top,
    width: clamp(Math.round(crop.width * width), 1, width - left),
    height: clamp(Math.round(crop.height * height), 1, height - top),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
