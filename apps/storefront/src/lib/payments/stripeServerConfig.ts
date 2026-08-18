import Stripe from 'stripe';

// Fichier server-only (secret key + webhook secret) — jamais importé par un
// composant client. Séparé volontairement de stripeClientConfig.ts (qui ne
// lit que la publishable key) pour éviter toute ambiguïté/erreur d'import.

export type PaymentModule = 'shop' | 'card' | 'event' | 'rental';

const MODULE_ENV_SUFFIX: Record<PaymentModule, string> = {
  shop:   'SHOP',
  card:   'CARD',
  event:  'EVENT',
  rental: 'RENTAL',
};

// Résout la secret key par module : STRIPE_SECRET_KEY_<MODULE> si présente,
// sinon STRIPE_SECRET_KEY (comportement actuel, inchangé tant que Dalice n'a
// pas configuré de compte séparé).
export function getStripeSecretKey(module: PaymentModule): string {
  const specific = process.env[`STRIPE_SECRET_KEY_${MODULE_ENV_SUFFIX[module]}`];
  const key = specific || process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error(`[stripeServerConfig] Nessuna secret key configurata per il modulo "${module}".`);
  return key;
}

// Cache d'instances — évite de recréer un client Stripe à chaque appel
// quand la secret key est la même (cas courant aujourd'hui : une seule clé
// globale partagée par les 4 modules).
const clientCache = new Map<string, Stripe>();

export function getStripeClient(module: PaymentModule): Stripe {
  const key = getStripeSecretKey(module);
  const cached = clientCache.get(key);
  if (cached) return cached;
  const client = new Stripe(key);
  clientCache.set(key, client);
  return client;
}

// Webhook secret par module, même fallback. Ne retourne que les paires
// {module, secret} effectivement résolues, DÉDUPLIQUÉES par valeur de secret
// (si shop et card partagent le même compte, inutile d'essayer deux fois le
// même secret lors de la vérification de signature).
export function getConfiguredWebhookSecrets(): { module: PaymentModule; secret: string }[] {
  const modules: PaymentModule[] = ['shop', 'card', 'event', 'rental'];
  const resolved = modules.map((module) => ({
    module,
    secret: process.env[`STRIPE_WEBHOOK_SECRET_${MODULE_ENV_SUFFIX[module]}`] || process.env.STRIPE_WEBHOOK_SECRET,
  }));

  const seen = new Set<string>();
  const deduped: { module: PaymentModule; secret: string }[] = [];
  for (const { module, secret } of resolved) {
    if (!secret || seen.has(secret)) continue;
    seen.add(secret);
    deduped.push({ module, secret });
  }
  return deduped;
}
