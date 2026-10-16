import { test as base, expect } from '@playwright/test';
import { SYNTHETIC_HEADER } from './confirmationTarget';

// Every confirmation spec marks its same-origin requests as synthetic, so
// they can be counted apart from real shoppers. Cross-origin requests
// (Supabase storage, Stripe) are left untouched: a custom header would
// trigger CORS preflights there.
export const test = base.extend<{ syntheticTraffic: void }>({
  syntheticTraffic: [async ({ context, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (new URL(request.url()).origin !== origin) return route.fallback();
      return route.fallback({ headers: { ...request.headers(), [SYNTHETIC_HEADER]: '1' } });
    });
    await use();
  }, { auto: true }],
});

export { expect };
