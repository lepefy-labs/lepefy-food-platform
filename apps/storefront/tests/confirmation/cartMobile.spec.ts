import { expect, test, type Page } from '@playwright/test';

// Panier mobile, retour au catalogue, contrôle +/− des cartes et « Nos promos ».
// Contextes invités isolés : aucune mutation de compte, de commande ni de
// paiement (tout appel API autre que GET est intercepté).

type Item = { product: Record<string, unknown> & { id: string; stock: number; min_order_quantity?: number; order_quantity_step?: number }; quantity: number };

const readItems = (page: Page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('lepefy-cart') ?? '{"state":{"items":[]}}').state.items as Item[]);

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

/** Remplit le panier invité avec de vrais produits achetables du tenant (quantité = minimum). */
async function seedCart(page: Page, count: number): Promise<Item[]> {
  await page.goto('/');
  const { products } = await page.evaluate(() => fetch('/api/products?limit=24').then(r => r.json())) as { products: Item['product'][] };
  const items = products
    .filter(p => (p.stock ?? 0) >= (p.min_order_quantity ?? 1))
    .slice(0, count)
    .map(product => ({ product, quantity: product.min_order_quantity ?? 1 }));
  expect(items.length).toBeGreaterThan(0);
  await page.evaluate(seeded => localStorage.setItem('lepefy-cart', JSON.stringify({ version: 1, state: {
    items: seeded, serverVersion: null, lastSyncedAt: null, pendingMutations: [], ownerCustomerId: null, unavailableProductIds: [],
  } })), items);
  return items;
}

for (const width of [320, 390]) {
  test(`long cart at ${width}px: one bottom action bar, never covering the last item`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    const items = await seedCart(page, 8);
    await page.goto('/cart');
    const bar = page.getByTestId('cart-checkout-bar');
    const cta = bar.getByRole('button', { name: /Livraison et paiement/ });
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled({ timeout: 20000 });
    expect((await cta.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await expect(bar).toContainText('Sous-total');
    await expect(bar).toContainText("Livraison calculée à l'étape suivante");
    // Une seule zone en bas : pas de BottomNav sur un panier non vide.
    await expect(page.getByRole('navigation', { name: 'Navigation boutique' })).toHaveCount(0);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    const barBox = (await bar.boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(740 + 1);
    const lines = page.getByRole('list').filter({ has: page.getByRole('group', { name: /^Quantité de / }) }).locator(':scope > li');
    await expect(lines).toHaveCount(items.length);
    const lastBox = (await lines.last().boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(barBox.y + 1);
    // Le retour au catalogue reste collé en haut.
    const back = page.getByRole('link', { name: 'Continuer mes achats' }).first();
    await expect(back).toBeInViewport();
    expect((await back.boundingBox())!.y).toBeLessThan(80);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('the checkout CTA navigates once, even on a double tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedCart(page, 2);
  await page.goto('/cart');
  const cta = page.getByTestId('cart-checkout-bar').getByRole('button', { name: /Livraison et paiement/ });
  await expect(cta).toBeEnabled({ timeout: 20000 });
  const navigations: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    const headers = request.headers();
    if (url.pathname === '/checkout' && headers.rsc === '1' && !headers['next-router-prefetch']) navigations.push(request.url());
  });
  await cta.evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
  await expect(page).toHaveURL(/\/checkout$/, { timeout: 30000 });
  expect(navigations.length).toBeLessThanOrEqual(1);
});

test('empty cart keeps the bottom navigation and shows no action bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/cart');
  await expect(page.getByRole('navigation', { name: 'Navigation boutique' })).toBeVisible();
  await expect(page.getByTestId('cart-checkout-bar')).toHaveCount(0);
});

test('« Continuer mes achats » returns to the same catalogue view and position with the cart intact', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const items = await seedCart(page, 2);
  await page.goto('/?sort=price_asc');
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => scrollY);
  // Vers le panier par la barre du bas, pas par une carte.
  // (clic programmatique : en développement, la pastille d'erreurs Next peut recouvrir la barre)
  await page.getByRole('navigation', { name: 'Navigation boutique' }).getByRole('link', { name: /panier/i })
    .evaluate(el => (el as HTMLElement).click());
  await expect(page).toHaveURL(/\/cart$/);
  await page.getByRole('link', { name: 'Continuer mes achats' }).first().click();
  await expect(page).toHaveURL(/\/\?.*sort=price_asc/);
  await expect.poll(() => page.evaluate(() => scrollY), { timeout: 10000 }).toBeGreaterThan(before - 150);
  expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThanOrEqual(150);
  expect((await readItems(page)).map(i => i.product.id)).toEqual(items.map(i => i.product.id));
});

test('card: first tap adds the minimum, + adds the step, − at the minimum removes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/products/*/recommendations?*', route => route.fulfill({ json: { strategy: 'similar', products: [] } }));
  await page.goto('/');
  const add = page.getByRole('button', { name: /^Ajouter( \d+)? au panier$/ }).first();
  // La carte est repérée par son lien : son bouton « Ajouter » va laisser place au +/−.
  const href = await add.locator('xpath=ancestor::a[1]').getAttribute('href');
  const card = page.locator(`main a[href="${href}"]`).first();
  await add.click();
  await page.keyboard.press('Escape');
  const [line] = await readItems(page);
  const minimum = line!.product.min_order_quantity ?? 1;
  const step = line!.product.order_quantity_step ?? 1;
  expect(line!.quantity).toBe(minimum);
  const group = card.getByRole('group', { name: /^Quantité de / });
  await expect(group).toContainText(String(minimum));
  const plus = group.getByRole('button', { name: /^Augmenter la quantité de / });
  if (await plus.isEnabled()) {
    await plus.click();
    expect((await readItems(page))[0]!.quantity).toBe(minimum + step);
    await group.getByRole('button', { name: /^Diminuer la quantité de / }).click();
    expect((await readItems(page))[0]!.quantity).toBe(minimum);
  }
  const remove = group.getByRole('button', { name: /^Retirer .+ du panier$/ });
  await remove.click();
  expect(await readItems(page)).toEqual([]);
  await expect(card.getByRole('button', { name: /^Ajouter( \d+)? au panier$/ })).toBeVisible();
});

test('« Nos promos »: count, dedicated view, Promo badges, or a clear empty state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?promo=1');
  const empty = page.getByText('Aucune promotion en ce moment.');
  const heading = page.getByRole('heading', { name: /Nos promos/ }).first();
  await expect(heading).toBeVisible();
  if (await empty.count()) {
    await expect(page.getByRole('button', { name: 'Voir tout le catalogue' })).toBeVisible();
    return;
  }
  const badges = page.locator('main').getByText(/^Promo −\d+ %$/);
  const count = await badges.count();
  expect(count).toBeGreaterThan(0);
  const pill = page.getByRole('button', { name: /Nos promos/ });
  await expect(pill).toHaveAttribute('aria-pressed', 'true');
  await expect(pill).toContainText(String(count));
  // Chaque carte promo montre aussi le prix barré.
  expect(await page.locator('main .line-through').count()).toBeGreaterThanOrEqual(count);
});

test('« Nouveautés »: count, dedicated view, Nouveau badges, or a clear empty state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?new=1');
  await expect(page.getByRole('heading', { name: /Nouveautés/ }).first()).toBeVisible();
  // Le tri par date de création ne s'appelle plus « Nouveautés ».
  await page.goto('/');
  await expect(page.getByRole('option', { name: 'Derniers ajoutés' })).toHaveCount(1);
  await page.goto('/?new=1');
  if (await page.getByText('Aucune nouveauté en ce moment.').count()) {
    await expect(page.getByRole('button', { name: 'Voir tout le catalogue' })).toBeVisible();
    return;
  }
  const badges = page.locator('main').getByText(/^Nouveau$/);
  const count = await badges.count();
  expect(count).toBeGreaterThan(0);
  const pill = page.getByRole('button', { name: /Nouveautés/ });
  await expect(pill).toHaveAttribute('aria-pressed', 'true');
  await expect(pill).toContainText(String(count));
});

test('desktop cart keeps its summary column and has no mobile bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedCart(page, 2);
  await page.goto('/cart');
  await expect(page.getByTestId('cart-checkout-bar')).toBeHidden();
  await expect(page.locator('aside').getByRole('button', { name: /Livraison et paiement/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continuer mes achats' }).first()).toBeVisible();
});
