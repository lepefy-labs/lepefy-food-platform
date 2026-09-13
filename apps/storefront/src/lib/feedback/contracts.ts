import { z } from 'zod';

export const FEEDBACK_REACTIONS = ['great', 'good', 'neutral', 'difficult', 'bad'] as const;
export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'confusing', 'like', 'other'] as const;
export const FEEDBACK_STATUSES = ['new', 'review', 'planned', 'resolved', 'archived'] as const;
export const FEEDBACK_PRIORITIES = ['normal', 'important', 'blocking'] as const;

export const REACTION_LABELS: Record<(typeof FEEDBACK_REACTIONS)[number], string> = {
  great: 'Super',
  good: 'Bien',
  neutral: 'Moyen',
  difficult: 'Difficile',
  bad: 'Mauvais',
};
export const REACTION_EMOJI: Record<(typeof FEEDBACK_REACTIONS)[number], string> = {
  great: '😍',
  good: '🙂',
  neutral: '😐',
  difficult: '😕',
  bad: '😣',
};
export const CATEGORY_LABELS: Record<(typeof FEEDBACK_CATEGORIES)[number], string> = {
  bug: 'Bug',
  idea: 'Idée',
  confusing: 'Confus',
  like: 'J’aime',
  other: 'Autre',
};
export const STATUS_LABELS: Record<(typeof FEEDBACK_STATUSES)[number], string> = {
  new: 'Nouveau',
  review: 'À analyser',
  planned: 'Planifié',
  resolved: 'Résolu',
  archived: 'Archivé',
};
export const PRIORITY_LABELS: Record<(typeof FEEDBACK_PRIORITIES)[number], string> = {
  normal: 'Normal',
  important: 'Important',
  blocking: 'Bloquant',
};

const contextSchema = z.object({
  pathname: z.string().trim().max(200).optional(),
  language: z.string().trim().max(24).optional(),
  viewportWidth: z.number().int().min(240).max(10000).optional(),
  viewportHeight: z.number().int().min(240).max(10000).optional(),
  standalone: z.boolean().optional(),
}).strict().optional();

export const publicFeedbackSchema = z.object({
  message: z.string().max(4000),
  reaction: z.enum(FEEDBACK_REACTIONS).nullable().optional(),
  category: z.enum(FEEDBACK_CATEGORIES).nullable().optional(),
  contactAllowed: z.boolean().default(false),
  contactEmail: z.string().trim().max(254).email().nullable().optional(),
  website: z.string().max(200).optional().default(''),
  dwellMs: z.number().int().min(0).max(60 * 60 * 1000),
  context: contextSchema,
}).strict().superRefine((value, issue) => {
  if (!value.message.trim()) {
    issue.addIssue({ code: z.ZodIssueCode.custom, path: ['message'], message: 'Message requis.' });
  }
  if (value.contactAllowed && !value.contactEmail) {
    issue.addIssue({ code: z.ZodIssueCode.custom, path: ['contactEmail'], message: 'Adresse e-mail requise.' });
  }
});

export function buildFeedbackInsert(input: z.infer<typeof publicFeedbackSchema>, versionLabel: string | null) {
  return {
    message: input.message.trim(),
    reaction: input.reaction ?? null,
    category: input.category ?? null,
    contact_allowed: input.contactAllowed,
    contact_email: input.contactAllowed ? input.contactEmail?.trim().toLowerCase() ?? null : null,
    context: {
      ...(input.context?.pathname ? { pathname: input.context.pathname } : {}),
      ...(input.context?.language ? { language: input.context.language } : {}),
      ...(input.context?.viewportWidth ? { viewport_width: input.context.viewportWidth } : {}),
      ...(input.context?.viewportHeight ? { viewport_height: input.context.viewportHeight } : {}),
      ...(typeof input.context?.standalone === 'boolean' ? { standalone: input.context.standalone } : {}),
      ...(versionLabel ? { campaign_version: versionLabel } : {}),
    },
  };
}

const campaignFields = {
  tenantId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  versionLabel: z.string().trim().max(80).nullable(),
  headline: z.string().trim().min(1).max(240),
  intro: z.string().trim().max(2000).nullable(),
  thankYouMessage: z.string().trim().max(1000).nullable(),
  active: z.boolean(),
};

export const campaignCreateSchema = z.object(campaignFields).strict();
export const campaignPatchSchema = z.object({
  name: campaignFields.name.optional(),
  versionLabel: campaignFields.versionLabel.optional(),
  headline: campaignFields.headline.optional(),
  intro: campaignFields.intro.optional(),
  thankYouMessage: campaignFields.thankYouMessage.optional(),
  active: campaignFields.active.optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Aucune modification.');
export const feedbackUpdateSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  priority: z.enum(FEEDBACK_PRIORITIES).optional(),
  internalNote: z.string().trim().max(4000).nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Aucune modification.');
