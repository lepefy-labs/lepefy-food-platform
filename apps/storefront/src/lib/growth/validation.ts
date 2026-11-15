import { z } from 'zod';
import { TOUCH_CHANNELS, TOUCH_OUTCOMES } from './types';

export const GROWTH_ID = z.string().regex(/^[a-z0-9][a-z0-9-]{1,119}$/);

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const instant = z.string().datetime({ offset: true }).optional().nullable();

export const prospectPatchSchema = z.object({
  expectedUpdatedAt: z.string().min(1),
  messageDraft: z.string().max(2000).optional().nullable(),
  nextActionAt: instant,
  doNotContact: z.boolean().optional(),
  doNotContactReason: optionalText(500),
}).strict();

export const touchSchema = z.object({
  channel: z.enum(TOUCH_CHANNELS),
  outcome: z.enum(TOUCH_OUTCOMES),
  reason: optionalText(500),
  note: optionalText(2000),
  messageText: optionalText(2000),
  nextActionAt: instant,
  /** After a refusal: also stop every future contact (suppression list). */
  doNotContact: z.boolean().optional(),
  requestKey: z.string().max(100).optional(),
}).strict();

/** French reasons for refused inputs, checked on the server and in the form. */
export function touchIssues(input: z.infer<typeof touchSchema>): string[] {
  const issues: string[] = [];
  if (input.outcome === 'rifiuto' && !input.reason) issues.push('Indiquez le motif du refus.');
  if (input.doNotContact && input.outcome !== 'rifiuto') issues.push('« Ne plus contacter » accompagne un refus.');
  return issues;
}
