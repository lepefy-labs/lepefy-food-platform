import type { ReviewReasonCode } from './reviewModeration';

/** Admin-side wording and rules of review moderation (no I/O). */

export type ReviewStatus = 'pending_moderation' | 'published' | 'rejected' | 'hidden';
export type ModerationAction = 'publish' | 'reject' | 'hide' | 'restore';

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending_moderation: 'À modérer',
  published: 'Publié',
  rejected: 'Rejeté',
  hidden: 'Masqué',
};

export const REASON_LABELS: Record<ReviewReasonCode, string> = {
  spam: 'Spam',
  personal_data: 'Données personnelles',
  abuse: 'Abus / insultes',
  threats: 'Menaces',
  hate: 'Haine',
  illegal: 'Contenu illicite',
  irrelevant: 'Hors sujet',
  duplicate: 'Doublon',
  other: 'Autre',
};

export const ACTION_LABELS: Record<ModerationAction, string> = {
  publish: 'Publier',
  reject: 'Rejeter',
  hide: 'Masquer',
  restore: 'Republier',
};

/** Actions available from a status (restore republishes a rejected or hidden review). */
export function actionsFor(status: ReviewStatus): ModerationAction[] {
  if (status === 'pending_moderation') return ['publish', 'reject'];
  if (status === 'published') return ['hide'];
  return ['restore'];
}

export const needsReason = (action: ModerationAction) => action === 'reject' || action === 'hide';
export const REASON_TEXT_MIN = 3;

/** Blocking issues for a moderation request, in French. */
export function moderationIssues(action: ModerationAction, reasonCode: string | null | undefined, reasonText: string | null | undefined): string[] {
  if (!needsReason(action)) return [];
  if (!reasonCode) return ['Choisissez un motif.'];
  if (reasonCode === 'other' && (reasonText?.trim().length ?? 0) < REASON_TEXT_MIN) return ['Précisez le motif « Autre ».'];
  return [];
}

/** Human label of an automatic flag. */
export function flagLabel(flag: string): string {
  if (flag.startsWith('blocked_term:')) return `terme de la liste de vigilance « ${flag.slice('blocked_term:'.length)} »`;
  const labels: Record<string, string> = {
    contains_url: 'lien dans le texte',
    possible_personal_data: 'e-mail ou téléphone possible',
    spam_pattern: 'caractères répétés (spam ?)',
  };
  return labels[flag] ?? flag.replaceAll('_', ' ');
}

/** What the public sees of the average rating, given the settings. */
export function publicRatingState(publishedCount: number, minPublicCount: number, publicDisplay: boolean): { visible: boolean; text: string } {
  if (!publicDisplay) return { visible: false, text: 'Affichage public désactivé : ni la note ni les avis ne sont visibles sur la boutique.' };
  if (publishedCount >= minPublicCount) {
    return { visible: true, text: `La note moyenne est affichée sur la boutique (${publishedCount} avis publié${publishedCount > 1 ? 's' : ''}, seuil ${minPublicCount}).` };
  }
  const missing = minPublicCount - publishedCount;
  return { visible: false, text: `La note moyenne s’affichera à partir de ${minPublicCount} avis publiés : encore ${missing} avis.` };
}
