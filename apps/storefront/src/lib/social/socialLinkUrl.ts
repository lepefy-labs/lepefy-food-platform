import type { SocialPlatform } from '@lepefy/types';

/**
 * One rule for the social links of a shop (admin editor and
 * /api/admin/social-links): accepts a pasted link or « @nom », checks that it
 * belongs to the chosen platform, and removes the sharing/tracking parameters
 * the apps add (igsh, mibextid, utm_*, si…). Pure, client-safe, relative
 * imports only; tested in tests/unit/socialLinkUrl.spec.ts.
 */

interface PlatformRule {
  /** Hostnames without « www. » / « m. ». */
  hosts: string[];
  /** Profile URL for a bare « @nom » (null: a full link is required). */
  fromHandle: ((handle: string) => string) | null;
  /** Query parameters that identify the page and must be kept. */
  keepParams?: string[];
  example: string;
}

const RULES: Record<SocialPlatform, PlatformRule> = {
  instagram: { hosts: ['instagram.com', 'instagr.am'], fromHandle: (h) => `https://www.instagram.com/${h}/`, example: 'https://www.instagram.com/votreboutique' },
  facebook: { hosts: ['facebook.com', 'fb.com', 'fb.me'], fromHandle: (h) => `https://www.facebook.com/${h}`, keepParams: ['id'], example: 'https://www.facebook.com/votreboutique' },
  tiktok: { hosts: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'], fromHandle: (h) => `https://www.tiktok.com/@${h}`, example: 'https://www.tiktok.com/@votreboutique' },
  youtube: { hosts: ['youtube.com', 'youtu.be'], fromHandle: (h) => `https://www.youtube.com/@${h}`, example: 'https://www.youtube.com/@votreboutique' },
  linkedin: { hosts: ['linkedin.com', 'lnkd.in'], fromHandle: null, example: 'https://www.linkedin.com/company/votreboutique' },
  x: { hosts: ['x.com', 'twitter.com'], fromHandle: (h) => `https://x.com/${h}`, example: 'https://x.com/votreboutique' },
};

const HANDLE = /^@?([A-Za-z0-9._-]{1,60})$/;
const MAX_URL = 500;

export type SocialUrlResult =
  | { ok: true; url: string; /** Tracking parameters were removed. */ cleaned: boolean }
  | { ok: false; error: string };

export function socialUrlExample(platform: SocialPlatform): string {
  return RULES[platform].example;
}

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, '');
}

export function normalizeSocialUrl(platform: SocialPlatform, input: string, platformLabel: string = platform): SocialUrlResult {
  const rule = RULES[platform];
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'Collez le lien de votre page.' };
  if (raw.length > MAX_URL) return { ok: false, error: 'Ce lien est trop long.' };

  const handle = raw.match(HANDLE);
  if (handle && !raw.includes('.') && !raw.includes('/')) {
    if (!rule.fromHandle) return { ok: false, error: `Collez le lien complet de votre page ${platformLabel} (ex. ${rule.example}).` };
    return { ok: true, url: rule.fromHandle(handle[1]!), cleaned: false };
  }

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: `Ce n’est pas un lien valide (ex. ${rule.example}).` };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'Le lien doit commencer par https://.' };
  const host = bareHost(url.hostname);
  if (!rule.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { ok: false, error: `Ce lien n’est pas une page ${platformLabel} (ex. ${rule.example}).` };
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (!path && !rule.keepParams?.some((p) => url.searchParams.has(p))) {
    return { ok: false, error: `Ce lien mène à l’accueil de ${platformLabel}, pas à votre page.` };
  }

  const kept = new URLSearchParams();
  for (const key of rule.keepParams ?? []) {
    const value = url.searchParams.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  const clean = `https://${url.hostname.toLowerCase()}${url.pathname}${query ? `?${query}` : ''}`;
  const before = `https://${url.hostname.toLowerCase()}${url.pathname}${url.search}${url.hash}`;
  return { ok: true, url: clean, cleaned: clean !== before };
}

/** Short label for the admin list: « @nom » when the URL has one, else host + path. */
export function socialDisplayName(platform: SocialPlatform, url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return url; }
  const segments = parsed.pathname.split('/').filter(Boolean);
  const first = segments[0] ?? '';
  if (first.startsWith('@')) return first;
  if ((platform === 'instagram' || platform === 'x') && segments.length === 1) return `@${first}`;
  if (platform === 'facebook' && segments.length === 1 && first !== 'profile.php') return `@${first}`;
  return `${bareHost(parsed.hostname)}${parsed.pathname.replace(/\/+$/, '')}`;
}
