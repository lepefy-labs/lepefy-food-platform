import { z } from 'zod';
import { CHANNEL_TOKEN_ENV_PATTERN } from './config';
import type { WhatsAppChannel } from './types';

/** Identité du numéro (platform owner uniquement) : jamais de jeton, seulement le nom de la variable serveur. */
export const channelIdentitySchema = z.object({
  environment: z.enum(['test', 'production']),
  waba_id: z.string().trim().regex(/^[0-9]{5,32}$/, 'WABA ID numérique attendu.'),
  phone_number_id: z.string().trim().regex(/^[0-9]{5,32}$/, 'Phone number ID numérique attendu.'),
  display_phone_number: z.string().trim().max(32).nullable().optional().transform((value) => value || null),
  verified_name: z.string().trim().max(120).nullable().optional().transform((value) => value || null),
  status: z.enum(['pending', 'active', 'disabled']),
  access_token_env: z.string().trim().regex(CHANNEL_TOKEN_ENV_PATTERN, 'Nom de variable META_WHATSAPP_<X>_TOKEN attendu.')
    .nullable().optional().transform((value) => value || null),
}).strict();
export type ChannelIdentityInput = z.infer<typeof channelIdentitySchema>;

/** Réglages opérationnels du tenant (whatsapp.manage). */
export const channelSettingsSchema = z.object({
  automation_enabled: z.boolean().optional(),
  ai_enabled: z.boolean().optional(),
  human_handoff_enabled: z.boolean().optional(),
  default_language: z.enum(['fr', 'it', 'en']).optional(),
  auto_resume_minutes: z.number().int().min(15).max(10080).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Aucune modification.');

export const testMessageSchema = z.object({
  to: z.string().trim().transform((value) => value.replace(/[^0-9]/g, '')).pipe(z.string().regex(/^[0-9]{6,20}$/, 'Numéro international attendu.')),
  template: z.string().trim().regex(/^[a-z0-9_]{1,512}$/).default('hello_world'),
  language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default('en_US'),
}).strict();

export const agentMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message vide.').max(4096),
}).strict();

export const conversationActionSchema = z.object({
  action: z.enum(['take_over', 'resume', 'close', 'mark_read']),
}).strict();

export interface ChannelView {
  id: string;
  environment: 'test' | 'production';
  status: WhatsAppChannel['status'];
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  automationEnabled: boolean;
  aiEnabled: boolean;
  humanHandoffEnabled: boolean;
  defaultLanguage: string;
  autoResumeMinutes: number | null;
  tokenConfigured: boolean;
  /** Identifiants techniques Meta : platform owner uniquement. */
  technical: { wabaId: string; phoneNumberId: string; accessTokenEnv: string | null } | null;
}

export function toChannelView(channel: WhatsAppChannel, options: { isPlatformOwner: boolean; tokenConfigured: boolean }): ChannelView {
  return {
    id: channel.id,
    environment: channel.environment,
    status: channel.status,
    displayPhoneNumber: channel.display_phone_number,
    verifiedName: channel.verified_name,
    automationEnabled: channel.automation_enabled,
    aiEnabled: channel.ai_enabled,
    humanHandoffEnabled: channel.human_handoff_enabled,
    defaultLanguage: channel.default_language,
    autoResumeMinutes: channel.auto_resume_minutes,
    tokenConfigured: options.tokenConfigured,
    technical: options.isPlatformOwner
      ? { wabaId: channel.waba_id, phoneNumberId: channel.phone_number_id, accessTokenEnv: channel.access_token_env }
      : null,
  };
}
