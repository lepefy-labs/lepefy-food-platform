import type { Page, Request } from '@playwright/test';
import { expect, test } from './fixtures';

// Budget de requêtes serveur d'une page vue (build de production : le
// prefetch Next.js n'existe pas en `next dev`). Une page affichée ne doit
// pas déclencher de rendu des destinations dynamiques de la navigation, et
// les règles de quantité sont chargées une fois, seulement quand elles servent.

test.beforeEach(async ({ context, page, baseURL }) => {
  await context.addCookies([{
    name: 'lepefy_cookie_consent',
    value: encodeURIComponent(JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false })),
    url: baseURL!,
  }]);
  await page.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') await route.fulfill({ status: 204 });
    else await route.fallback();
  });
});

const DYNAMIC_DESTINATIONS = ['/', '/cart', '/gadgets', '/compte', '/compte/connexion', '/orders', '/supprimer-compte', '/livraison'];

function recordPrefetches(page: Page): string[] {
  const prefetched: string[] = [];
  page.on('request', (request: Request) => {
    if (!request.headers()['next-router-prefetch']) return;
    const url = new URL(request.url());
    url.searchParams.delete('_rsc');
    prefetched.push(url.pathname + url.search);
  });
  return prefetched;
}

function countQuantityGroupRequests(page: Page): { count: number } {
  const counter = { count: 0 };
  page.on('request', (request: Request) => {
    if (new URL(request.url()).pathname === '/api/quantity-groups') counter.count += 1;
  });
  return counter;
}

async function viewWholePage(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

for (const url of ['/accueil', '/', '/avis']) {
  test(`viewing ${url} does not prefetch dynamic destinations (bottom bar, header, footer, category tiles)`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const prefetched = recordPrefetches(page);
    await page.goto(url);
    await viewWholePage(page);
    const dynamic = prefetched.filter(path => DYNAMIC_DESTINATIONS.includes(path) || path.includes('?'));
    expect(dynamic, `prefetched: ${prefetched.join(', ')}`).toEqual([]);
  });
}

test('the bottom navigation still navigates to dynamic pages without prefetch', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/accueil');
  const nav = page.getByRole('navigation', { name: 'Navigation boutique' });
  await nav.locator('a[data-destination="goodies"]').click();
  await expect(page).toHaveURL(/\/gadgets$/);
  await nav.locator('a[data-destination="catalog"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('main a[href^="/products/"]').first()).toBeVisible();
});

// La durée ISR effective est la plus courte des lectures en cache du rendu :
// l'en-tête s-maxage la révèle (une lecture à 60 s ramènerait la page à 60 s).
test('shop ISR pages regenerate at most once an hour', async ({ page, request }) => {
  await page.goto('/');
  const product = await page.locator('main a[href^="/products/"]').first().getAttribute('href');
  for (const path of ['/accueil', '/avis', '/card', '/politique-confidentialite', '/conditions-generales-vente', product!]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['cache-control'], path).toMatch(/s-maxage=3600\b/);
  }
});

test('an empty cart page view does not load the quantity rules', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = countQuantityGroupRequests(page);
  await page.goto('/');
  await viewWholePage(page);
  expect(requests.count).toBe(0);
});

test('the quantity rules are requested once per visit, shared by every component', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const requests = countQuantityGroupRequests(page);
  await page.goto('/');
  const firstProduct = page.locator('main a[href^="/products/"]').first();
  await firstProduct.click();
  await expect(page).toHaveURL(/\/products\//);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Product page + add + cart drawer + cart page: one shared request within the TTL.
  const add = page.getByRole('button', { name: /^Ajouter( \d+)? au panier$/ }).first();
  if (await add.isEnabled()) {
    await add.click();
    await page.keyboard.press('Escape');
  }
  await page.getByRole('link', { name: /Ouvrir le panier/ }).click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Catalogue' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(requests.count).toBe(1);
});
