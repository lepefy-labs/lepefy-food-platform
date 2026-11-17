/**
 * Application installable (PWA) : règles pures partagées par la page /app,
 * les e-mails commande et la mesure (migration 186). Aucune dépendance
 * navigateur ici : le contexte est passé en paramètre, donc testable.
 */

export const APP_EVENTS = ['install_page_view', 'install_prompt', 'install_accepted', 'app_installed', 'standalone_launch'] as const;
export type AppEvent = (typeof APP_EVENTS)[number];

export const APP_SOURCES = ['email_confirmed', 'email_completed', 'banner', 'direct'] as const;
export type AppSource = (typeof APP_SOURCES)[number];

export const APP_INSTALL_PATH = '/app';

export function isAppEvent(value: unknown): value is AppEvent {
  return typeof value === 'string' && (APP_EVENTS as readonly string[]).includes(value);
}

export function isAppSource(value: unknown): value is AppSource {
  return typeof value === 'string' && (APP_SOURCES as readonly string[]).includes(value);
}

/** `?src=` de la page /app → source mesurée ; toute autre valeur = `direct`. */
export function appSourceFromParam(value: string | null | undefined): AppSource {
  return isAppSource(value) && value !== 'direct' ? value : 'direct';
}

/** Lien absolu vers /app pour un e-mail ; null si l'URL boutique n'est pas http(s). */
export function appInstallUrl(storefrontUrl: string | null | undefined, source: Exclude<AppSource, 'direct'>): string | null {
  if (!storefrontUrl || !/^https?:\/\//.test(storefrontUrl)) return null;
  return `${storefrontUrl.replace(/\/+$/, '')}${APP_INSTALL_PATH}?src=${source}`;
}

/**
 * Ce que la page /app doit montrer :
 * - `installed` : déjà ouverte depuis l'icône ;
 * - `in_app_browser` : navigateur intégré (Gmail, Instagram, Facebook…) où rien ne s'installe ;
 * - `ios` : Safari iPhone/iPad, geste Partager → « Sur l'écran d'accueil » ;
 * - `android` : invite native si le navigateur la propose, sinon menu ⋮ ;
 * - `desktop` : ordinateur — proposer d'ouvrir le lien sur le téléphone.
 */
export type InstallContext = 'installed' | 'in_app_browser' | 'ios' | 'android' | 'desktop';

export function detectInstallContext(userAgent: string, standalone: boolean, maxTouchPoints = 0): InstallContext {
  if (standalone) return 'installed';
  const ua = userAgent || '';
  // iPadOS se présente comme un Mac : on le reconnaît à l'écran tactile.
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  if (ios || android) {
    // Navigateurs intégrés aux applications (liens ouverts depuis un e-mail ou un réseau social).
    if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|GSA\/|LinkedInApp|Snapchat|TikTok|MicroMessenger|GmailApp/i.test(ua)) return 'in_app_browser';
    if (android && /; wv\)/.test(ua)) return 'in_app_browser';
    return ios ? 'ios' : 'android';
  }
  return 'desktop';
}
