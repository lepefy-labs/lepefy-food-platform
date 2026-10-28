export const APP_VERSION_PATH = '/api/app-version';
const TIMEOUT_MS = 8_000;

/** Version baked into this bundle (VERCEL_GIT_COMMIT_SHA at build time); '' = inert. */
export const BUNDLE_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '';

/**
 * Asks the deployment which version it serves (~60 bytes, no database, no
 * cookies). Any failure (offline, timeout, 5xx, bad JSON) resolves null: a
 * failed check is silent and is simply retried at the next return to the app.
 */
export async function fetchRemoteVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(APP_VERSION_PATH, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { v?: unknown };
    return typeof data.v === 'string' && data.v ? data.v : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
