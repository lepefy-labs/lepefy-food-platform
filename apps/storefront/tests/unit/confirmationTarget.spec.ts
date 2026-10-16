import { expect, test } from '@playwright/test';
import {
  DEFAULT_LOCAL_PORT,
  isLoopbackUrl,
  localServerEnv,
  NEUTRALIZED_SERVER_ENV,
  resolveConfirmationTarget,
  SYNTHETIC_USER_AGENT_TOKEN,
  syntheticUserAgent,
} from '../confirmation/confirmationTarget';

test.describe('storefront confirmation target', () => {
  test('by default the full suite runs on a local server, never production', () => {
    const target = resolveConfirmationTarget({});
    expect(target).toEqual({ suite: 'full', baseURL: `http://127.0.0.1:${DEFAULT_LOCAL_PORT}`, local: true, startLocalServer: true, port: DEFAULT_LOCAL_PORT });
  });

  test('the full suite refuses a remote URL unless explicitly allowed (manual run)', () => {
    expect(() => resolveConfirmationTarget({ PLAYWRIGHT_BASE_URL: 'https://shop.chloefood.com' })).toThrow(/local server/);
    expect(resolveConfirmationTarget({ PLAYWRIGHT_BASE_URL: 'https://shop.chloefood.com', CONFIRMATION_ALLOW_REMOTE_FULL: '1' }))
      .toMatchObject({ suite: 'full', local: false, startLocalServer: false });
  });

  test('the smoke suite may target production', () => {
    expect(resolveConfirmationTarget({ CONFIRMATION_SUITE: 'smoke', PLAYWRIGHT_BASE_URL: 'https://shop.chloefood.com' }))
      .toMatchObject({ suite: 'smoke', baseURL: 'https://shop.chloefood.com', local: false, startLocalServer: false });
  });

  test('an explicit local URL reuses that server', () => {
    expect(resolveConfirmationTarget({ PLAYWRIGHT_BASE_URL: 'http://localhost:3000' }))
      .toMatchObject({ suite: 'full', local: true, startLocalServer: false });
    expect(isLoopbackUrl('http://shop.localhost:3000')).toBe(true);
    expect(isLoopbackUrl('https://chloefood-abc.vercel.app')).toBe(false);
  });

  test('the local server runs with every provider key emptied, Supabase kept', () => {
    const env = localServerEnv({ STRIPE_SECRET_KEY: 'sk_live_x', PACKLINK_API_KEY: 'p', BREVO_API_KEY: 'b', NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', UNDEFINED_VAR: undefined }, 3100);
    for (const key of NEUTRALIZED_SERVER_ENV) expect(env[key], key).toBe('');
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://x.supabase.co');
    expect(env.PORT).toBe('3100');
    expect('UNDEFINED_VAR' in env).toBe(false);
  });

  test('synthetic traffic is identifiable by its user agent', () => {
    expect(syntheticUserAgent('Mozilla/5.0 Chrome/150')).toBe(`Mozilla/5.0 Chrome/150 ${SYNTHETIC_USER_AGENT_TOKEN}`);
  });
});
