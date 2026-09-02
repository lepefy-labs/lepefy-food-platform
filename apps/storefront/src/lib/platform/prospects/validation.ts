import { z } from 'zod';
import { CONFIG, FOOD_CODES, REGIONS } from './config';
import { STATUSES } from './types';
export const discoverySchema = z.object({
  country: z.literal('FR').default('FR'),
  region: z.string().refine(v => !v || Boolean(REGIONS[v])).default(''),
  department: z.string().regex(/^$|^(?:\d{2,3}|2A|2B)$/).default(''),
  city: z.string().trim().max(100).default(''),
  codes: z.array(z.string().refine(v => Boolean(FOOD_CODES[v]))).min(1).max(20).transform(v => [...new Set(v)].sort()),
  activeOnly: z.boolean().default(true), limit: z.number().int().min(1).max(CONFIG.maxDiscovery),
});
const date = z.string().datetime({ offset: true }).nullable();
export const salesSchema = z.object({
  status: z.enum(STATUSES), last_contact_at: date, next_action_at: date,
  notes: z.string().max(10000).nullable(), lost_reason: z.string().max(1000).nullable(),
  do_not_contact: z.boolean(), suppression_reason: z.string().max(1000).nullable(),
  website_url: z.string().max(2048).nullable(),
}).strict();
export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action:z.literal('discover'), filters:discoverySchema }),
  z.object({ action:z.literal('enrich'), ids:z.array(z.string().uuid()).min(1).max(CONFIG.enrichmentBatch).optional(),
    qualified:z.boolean().optional(), osm:z.boolean().default(true) }),
  z.object({ action:z.literal('step'), runId:z.string().uuid() }),
]);
