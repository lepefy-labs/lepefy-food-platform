import { SOCIAL_PLATFORM_REGISTRY, type SocialPlatform, type TenantSocialLink } from '@lepefy/types';
import { normalizeSocialUrl } from './socialLinkUrl';

/**
 * Server-side validation of POST/PATCH /api/admin/social-links. One link per
 * platform (DB unique), platform fixed after creation, URL normalised by the
 * same rule as the admin editor. Pure; tested in tests/unit/socialLinkUrl.spec.ts.
 */

type Row = Pick<TenantSocialLink, 'platform' | 'url' | 'sort_order' | 'active'>;
export type SocialWriteResult<T> = { ok: true; values: T } | { ok: false; status: 400 | 409; error: string };

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SOCIAL_PLATFORM_REGISTRY, value);
}

export function parseSocialCreate(body: Record<string, unknown>, existing: ReadonlyArray<SocialPlatform>): SocialWriteResult<Row> {
  if (!isSocialPlatform(body.platform)) return { ok: false, status: 400, error: 'Réseau social inconnu.' };
  const platform = body.platform;
  const label = SOCIAL_PLATFORM_REGISTRY[platform].label;
  if (existing.includes(platform)) return { ok: false, status: 409, error: `${label} est déjà configuré : modifiez le lien existant.` };
  const url = normalizeSocialUrl(platform, String(body.url ?? ''), label);
  if (!url.ok) return { ok: false, status: 400, error: url.error };
  return {
    ok: true,
    values: { platform, url: url.url, sort_order: Number.parseInt(String(body.sort_order ?? 0), 10) || 0, active: body.active === undefined ? true : Boolean(body.active) },
  };
}

export function parseSocialUpdate(body: Record<string, unknown>, current: Pick<TenantSocialLink, 'platform'>): SocialWriteResult<Partial<Row>> {
  if ('platform' in body && body.platform !== current.platform) {
    return { ok: false, status: 409, error: 'Le réseau d’un lien ne change pas : ajoutez un nouveau réseau.' };
  }
  const values: Partial<Row> = {};
  if ('url' in body) {
    const url = normalizeSocialUrl(current.platform, String(body.url ?? ''), SOCIAL_PLATFORM_REGISTRY[current.platform].label);
    if (!url.ok) return { ok: false, status: 400, error: url.error };
    values.url = url.url;
  }
  if ('sort_order' in body) values.sort_order = Number.parseInt(String(body.sort_order), 10) || 0;
  if ('active' in body) values.active = Boolean(body.active);
  return { ok: true, values };
}
