// URL publique du billet événement (page /evenementiel/billet/[qr_token]).
//
// Base URL : le sous-domaine dédié (NEXT_PUBLIC_EVENTS_SUBDOMAIN, ex.
// events.chloefood.com) quand il est configuré, sinon le domaine boutique
// canonique (NEXT_PUBLIC_STOREFRONT_URL, déjà utilisé pour les liens des
// webhooks n8n) — jamais l'host de la requête. Le chemin complet
// /evenementiel/billet/... est une route filesystem : il est servi tel quel
// sur N'IMPORTE quel host (sous-domaine inclus), sans dépendre des rewrites
// de next.config.mjs qui ne couvrent que /, /evenements et /services.
export function getEventsBaseUrl(): string {
  const subdomain = process.env.NEXT_PUBLIC_EVENTS_SUBDOMAIN;
  if (subdomain) return `https://${subdomain}`;
  return process.env.NEXT_PUBLIC_STOREFRONT_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
}

export function getTicketUrl(qrToken: string): string {
  return `${getEventsBaseUrl()}/evenementiel/billet/${qrToken}`;
}

// Normalisation côté scanner : le QR encode désormais l'URL du billet, mais
// les billets déjà émis encodent le token nu — les deux formats doivent
// rester valides. Le token est un HMAC-SHA256 hex (64 caractères, cf.
// lib/events/qrToken.ts). Fonction pure (aucun accès env/crypto), importable
// aussi bien côté client (ScanClient) que côté serveur (route scan).
export function extractQrToken(decoded: string): string {
  const trimmed = decoded.trim();
  const match = trimmed.match(/\/evenementiel\/billet\/([a-f0-9]{64})/i);
  return match?.[1] ?? trimmed;
}
