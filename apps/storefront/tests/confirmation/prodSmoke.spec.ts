import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Smoke de production : le seul jeu lancé automatiquement contre la boutique
// réelle après un déploiement (CONFIRMATION_SUITE=smoke). Quatre parcours
// critiques, invité, en lecture seule : tout appel API autre que GET est
// intercepté dans le navigateur — aucun compte, commande ni paiement.
// La suite complète (mise en page, responsive, panier) tourne en local.

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

const productLinks = (page: Page) => page.locator('main a[href^="/products/"]');
const addButton = (page: Page) => page.getByRole('button', { name: /^Ajouter( \d+)? au panier$/ });

test('catalogue opens with products and the mobile navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(productLinks(page).first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navigation boutique' })).toBeVisible();
});

test('search proposes real products', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // Hors du Catalogue, le champ global propose des produits (sur « / » il filtre la grille).
  await page.goto('/accueil');
  const { products } = await page.evaluate(() => fetch('/api/products?limit=12').then(r => r.json())) as { products: { name: string }[] };
  expect(products.length).toBeGreaterThan(0);
  const search = page.getByRole('combobox', { name: 'Rechercher un produit', exact: true }).locator('visible=true').first();
  await search.fill(products[0]!.name.slice(0, 6));
  const proposals = page.getByRole('listbox', { name: 'Produits proposés' });
  await expect(proposals).toBeVisible();
  await expect(proposals.locator('a[href^="/products/"]').first()).toBeVisible();
});

test('a product page opens from the catalogue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const link = productLinks(page).first();
  const href = await link.getAttribute('href');
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('cart and the way to checkout are available (no order, no payment)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await addButton(page).first().click();
  await page.keyboard.press('Escape');
  await page.goto('/cart');
  const toCheckout = page.getByRole('button', { name: /Livraison et paiement/ }).locator('visible=true').first();
  await expect(toCheckout).toBeEnabled();
  await toCheckout.click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByRole('heading').first()).toBeVisible();
});
