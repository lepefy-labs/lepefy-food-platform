import { z } from 'zod';

const config = z.object({ thinkingBudget: z.number().int().min(0).max(24576).optional() }).strict();
const key = z.string().regex(/^[a-z][a-z0-9_-]{1,79}$/);
const nullableText = z.string().max(200).nullable();
const provider = z.object({
  key, name: z.string().min(1).max(100),
  provider_type: z.enum(['gemini','openai_compatible','openai','anthropic','lepefy']),
  enabled: z.boolean(), credential_ref: z.string().regex(/^[A-Z][A-Z0-9_]*_API_KEY$/).nullable(),
  base_url: z.string().url().max(500).nullable(), config: z.object({}).strict(),
}).strict().refine(v => !v.enabled || ['gemini', 'openai_compatible'].includes(v.provider_type), {
  message: 'Adapter non disponible en V1.',
}).refine(v => v.provider_type !== 'gemini' || !!v.credential_ref, { message: 'Référence de clé requise.' });
const model = z.object({
  key, provider_id: z.string().uuid(), provider_model_id: z.string().min(1).max(150),
  display_name: z.string().min(1).max(100), enabled: z.boolean(),
  capabilities: z.object({ chat: z.boolean(), structured_output: z.boolean(),
    reasoning: z.boolean().optional(), vision: z.boolean().optional(), classification: z.boolean().optional() }).strict(),
  context_window: z.number().int().positive().nullable(), cost_class: nullableText,
  input_cost_per_million: z.number().nonnegative().nullable(),
  output_cost_per_million: z.number().nonnegative().nullable(), config,
}).strict();
const policy = z.object({
  consumer: key, capability: key, enabled: z.boolean(), config: z.object({}).strict(),
}).strict();
const policyModel = z.object({
  policy_id: z.string().uuid(), model_id: z.string().uuid(), enabled: z.boolean(),
  priority: z.number().int().min(0).max(10000), timeout_ms: z.number().int().min(100).max(18000),
  min_confidence: z.number().min(0).max(1).nullable(),
}).strict();
export const routingMutation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('provider'), id: z.string().uuid().optional(), values: provider }).strict(),
  z.object({ kind: z.literal('model'), id: z.string().uuid().optional(), values: model }).strict(),
  z.object({ kind: z.literal('policy'), id: z.string().uuid().optional(), values: policy }).strict(),
  z.object({ kind: z.literal('policyModel'), values: policyModel }).strict(),
]);
