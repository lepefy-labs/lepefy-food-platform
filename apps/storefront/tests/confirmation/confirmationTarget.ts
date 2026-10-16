// Where the storefront confirmation suite runs, and what it may run there.
// Pure module (no Playwright import) so the rules are unit-tested.
//
// - full suite  : a local `next start` by default (no Vercel invocation);
//                 a remote URL only when explicitly allowed (manual run).
// - smoke suite : a few read-only checks, the only suite allowed to target
//                 production automatically after a deploy.

export type ConfirmationSuite = 'full' | 'smoke';

export const DEFAULT_LOCAL_PORT = 3100;

/** Appended to the browser user agent so synthetic traffic is identifiable (Vercel Firewall, logs). */
export const SYNTHETIC_USER_AGENT_TOKEN = 'LepefySynthetic/1 (+storefront-confirmation)';
/** Observation-only marker sent on same-origin requests. Never read as an authorization or bypass. */
export const SYNTHETIC_HEADER = 'x-lepefy-synthetic';

export const SMOKE_SPEC = 'prodSmoke.spec.ts';

// Server-side keys that could reach a payment, shipping, messaging, e-mail,
// AI or document provider. The local server runs with them emptied: Next.js
// keeps an already-defined process variable (even '') over `.env.local`.
// Supabase stays readable (catalogue, tenant); every non-GET /api call is
// fulfilled in the browser by the specs, so no order/payment/account write.
export const NEUTRALIZED_SERVER_ENV = [
  'STRIPE_SECRET_KEY', 'STRIPE_SECRET_KEY_TEST', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET_TEST',
  'PACKLINK_API_KEY',
  'BREVO_API_KEY', 'EMAIL_TRANSPORT', 'N8N_WEBHOOK_URL', 'N8N_NOTIFICATION_WEBHOOK_SECRET', 'N8N_DAILY_DIGEST_WEBHOOK_SECRET',
  'GREEN_API_URL', 'GREEN_API_INSTANCE_ID', 'GREEN_API_TOKEN',
  'META_WHATSAPP_SYSTEM_USER_TOKEN', 'META_APP_SECRET', 'META_WHATSAPP_VERIFY_TOKEN',
  'GEMINI_API_KEY', 'GOOGLE_PLACES_API_KEY',
  'GOTENBERG_URL', 'GOTENBERG_AUTH', 'REMBG_URL', 'REMBG_AUTH',
  'GOOGLE_WALLET_PRIVATE_KEY', 'APPLE_WALLET_PRIVATE_KEY', 'APPLE_WALLET_KEY_PASSPHRASE',
  'E2E_TEST_SECRET', 'ADMIN_EMAILS',
] as const;

export interface ConfirmationTarget {
  suite: ConfirmationSuite;
  baseURL: string;
  local: boolean;
  /** true when the suite must start its own local server. */
  startLocalServer: boolean;
  port: number;
}

export function isLoopbackUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

export function resolveConfirmationTarget(env: Record<string, string | undefined>): ConfirmationTarget {
  const suite: ConfirmationSuite = env.CONFIRMATION_SUITE?.trim() === 'smoke' ? 'smoke' : 'full';
  const requestedPort = Number.parseInt(env.CONFIRMATION_LOCAL_PORT ?? '', 10);
  const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : DEFAULT_LOCAL_PORT;
  const explicit = env.PLAYWRIGHT_BASE_URL?.trim();
  const baseURL = explicit || `http://127.0.0.1:${port}`;
  const local = isLoopbackUrl(baseURL);

  if (suite === 'full' && !local && env.CONFIRMATION_ALLOW_REMOTE_FULL !== '1') {
    throw new Error(
      `The full confirmation suite targets a local server by default (got ${baseURL}). `
      + 'Use CONFIRMATION_SUITE=smoke for production, or set CONFIRMATION_ALLOW_REMOTE_FULL=1 for a deliberate manual run.',
    );
  }

  return { suite, baseURL, local, startLocalServer: !explicit, port };
}

/** Environment of the local `next start`: current env with every provider key emptied. */
export function localServerEnv(env: Record<string, string | undefined>, port: number): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) result[key] = value;
  for (const key of NEUTRALIZED_SERVER_ENV) result[key] = '';
  result.PORT = String(port);
  return result;
}

export function syntheticUserAgent(baseUserAgent: string): string {
  return `${baseUserAgent} ${SYNTHETIC_USER_AGENT_TOKEN}`;
}
