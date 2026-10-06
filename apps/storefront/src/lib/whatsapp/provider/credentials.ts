import { CHANNEL_TOKEN_ENV_PATTERN, graphApiVersion, PLATFORM_TOKEN_ENV } from '@/lib/whatsapp/config';
import type { WhatsAppChannel } from '@/lib/whatsapp/types';
import { createMetaCloudProvider } from './metaCloudProvider';
import { WhatsAppProviderError, type WhatsAppProvider } from './types';

/**
 * Jeton d'accès d'un canal : jamais en base. Le canal référence au plus le NOM
 * d'une variable d'environnement serveur (access_token_env), sinon le jeton
 * « system user » de la plateforme. Même pattern que les credentials AI Core.
 */
export function resolveChannelAccessToken(
  channel: Pick<WhatsAppChannel, 'access_token_env'>,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const name = channel.access_token_env ?? PLATFORM_TOKEN_ENV;
  if (name !== PLATFORM_TOKEN_ENV && !CHANNEL_TOKEN_ENV_PATTERN.test(name)) return null;
  return env[name]?.trim() || null;
}

export type ProviderFactory = (channel: WhatsAppChannel) => WhatsAppProvider;

export const createChannelProvider: ProviderFactory = (channel) => {
  const accessToken = resolveChannelAccessToken(channel);
  if (!accessToken) throw new WhatsAppProviderError({ kind: 'not_configured', message: 'channel_token_missing' });
  return createMetaCloudProvider({ phoneNumberId: channel.phone_number_id, accessToken, apiVersion: graphApiVersion() });
};
