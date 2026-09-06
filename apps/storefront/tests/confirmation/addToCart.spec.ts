import { expect, test, type Page } from '@playwright/test';

const suggestion = (id: string, stock = 3) => ({
  id, name: 'Suggestion ' + id, slug: 'suggestion-' + id, price: 5,
  compare_at_price: id === 'one' ? 7 : null, image_url: null, weight_grams: null, stock,
});
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Ajouté au panier', exact: true });
const trigger = (page: Page) => page.getByRole('button', { name: 'Ajouter au panier', exact: true }).filter({ hasText: 'Ajouter au panier' }).first();
const readItems = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('lepefy-cart') ?? '{"state":{"items":[]}}').state.items as { product: { id: string; stock: number }; quantity: number }[]);

test.beforeEach(async ({ context, page, baseURL }) => {
  await context.addCookies([{
    name: 'lepefy_cookie_consent',
    value: encodeURIComponent(JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false })),
    url: baseURL!,
  }]);
  // Isolated guest contexts only; these smoke tests never submit account/order/payment mutations.
  await page.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') await route.fulfill({ status: 204 });
    else await route.fallback();
  });
});

for (const width of [320, 360, 390, 768, 1024, 1440]) {
  test(`confirmation layout, focus and consecutive adds at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/products/*/recommendations?*', route => route.fulfill({ json: {
      strategy: 'similar', products: [suggestion('one', 1), suggestion('two'), suggestion('three'), suggestion('four')],
    } }));
    await page.goto('/');
    const button = trigger(page);
    await expect(button).toBeVisible();
    await button.scrollIntoViewIfNeeded();
    const buttonBounds = await button.boundingBox();
    expect(buttonBounds!.height).toBeGreaterThanOrEqual(44);
    expect(await button.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const beforeUrl = page.url();
    await button.click();
    await expect(dialog(page)).toBeVisible();
    expect(page.url()).toBe(beforeUrl);
    expect(await readItems(page)).toHaveLength(1);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    const panel = dialog(page);
    const quantity = panel.getByTestId('confirmation-quantity');
    const minus = panel.getByRole('button', { name: /^Diminuer la quantité de / });
    const plus = panel.getByRole('button', { name: /^Augmenter la quantité de / });
    await expect(quantity).toHaveText('Quantité dans le panier : 1');
    await expect(minus).toBeDisabled();
    const sourceItem = (await readItems(page))[0]!;
    if (sourceItem.product.stock > 1) {
      await plus.click();
      await expect(quantity).toHaveText('Quantité dans le panier : 2');
      expect((await readItems(page))[0]!.quantity).toBe(2);
      await minus.click();
      await expect(quantity).toHaveText('Quantité dans le panier : 1');
      await expect(minus).toBeDisabled();
      // Both clicks happen in one task: no stale React quantity closure.
      await plus.evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
      expect((await readItems(page))[0]!.quantity).toBe(Math.min(3, sourceItem.product.stock));
      await minus.evaluate(el => { for (let i = 0; i < 5; i++) (el as HTMLButtonElement).click(); });
      await expect(quantity).toHaveText('Quantité dans le panier : 1');
    } else {
      await expect(plus).toBeDisabled();
    }
    for (const control of [minus, plus]) {
      const box = await control.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(48);
    }
    const viewCart = panel.getByRole('link', { name: 'Voir mon panier' });
    const continueShopping = panel.getByRole('button', { name: 'Continuer mes achats' });
    await expect(viewCart).toBeInViewport();
    for (const action of [viewCart, continueShopping]) {
      const box = await action.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(54);
      expect(box!.width).toBeGreaterThan(0);
    }
    const viewCartBox = (await viewCart.boundingBox())!;
    const continueBox = (await continueShopping.boundingBox())!;
    if (width < 640) {
      expect(Math.abs(viewCartBox.width - continueBox.width)).toBeLessThanOrEqual(1);
      expect(viewCartBox.y).toBeLessThan(continueBox.y);
    } else {
      expect(Math.abs(viewCartBox.width - continueBox.width)).toBeLessThanOrEqual(1);
      expect(continueBox.x).toBeLessThan(viewCartBox.x);
      expect(Math.abs(continueBox.y - viewCartBox.y)).toBeLessThanOrEqual(1);
    }
    const bounds = await panel.boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(Math.min(width, 800));
    expect(bounds!.height).toBeLessThanOrEqual(900 * 0.85 + 1);
    if (width < 640) {
      expect(bounds!.x).toBe(0);
      expect(Math.abs(bounds!.y + bounds!.height - 900)).toBeLessThanOrEqual(1);
    } else {
      expect(Math.abs(bounds!.x + bounds!.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    }
    await expect(panel.getByRole('heading', { name: 'Vous aimerez peut-être aussi' })).toBeVisible();
    const firstAdd = panel.getByRole('button', { name: 'Ajouter Suggestion one', exact: true });
    expect((await firstAdd.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await firstAdd.click();
    const capped = panel.getByRole('button', { name: 'Stock maximum pour Suggestion one', exact: true });
    await expect(capped).toHaveAttribute('aria-disabled', 'true');
    // Synthetic repeat represents rapid clicks arriving before a disabled render.
    await capped.evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
    expect((await readItems(page)).find(i => i.product.id === 'one')?.quantity).toBe(1);
    const secondAdd = panel.getByRole('button', { name: 'Ajouter Suggestion two', exact: true });
    await secondAdd.evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
    expect((await readItems(page)).find(i => i.product.id === 'two')?.quantity).toBe(2);
    await expect(dialog(page)).toHaveCount(1);
    const close = panel.getByRole('button', { name: 'Fermer la confirmation' });
    await close.focus();
    await page.keyboard.press('Shift+Tab');
    expect(await panel.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach('confirmation-' + width, { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    // The source stays keyboard-focusable even when its last unit was added.
    expect(await page.evaluate(() => document.activeElement?.textContent?.includes('Ajouté') || document.activeElement?.textContent?.includes('Ajouter') || document.activeElement?.textContent?.includes('Stock maximum'))).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });
}

test('slow, failed, empty and stale suggestions never block confirmation or cart navigation', async ({ page }) => {
  let mode: 'slow' | 'error' | 'empty' = 'slow';
  await page.route('**/api/products/*/recommendations?*', async route => {
    if (mode === 'slow') { await new Promise(resolve => setTimeout(resolve, 10000)); await route.abort().catch(() => {}); }
    else if (mode === 'error') await route.fulfill({ status: 503, json: { products: [] } });
    else await route.fulfill({ json: { products: [] } });
  });
  await page.goto('/');
  await trigger(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('status')).toBeVisible();
  expect(await readItems(page)).toHaveLength(1);
  const scroll = await page.evaluate(() => scrollY);
  await dialog(page).getByRole('button', { name: 'Continuer mes achats' }).click();
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  mode = 'error';
  await trigger(page).click();
  await expect(dialog(page).getByRole('status')).toHaveCount(0);
  await expect(dialog(page).getByRole('heading', { name: 'Vous aimerez peut-être aussi' })).toHaveCount(0);
  await page.getByTestId('add-confirmation-overlay').click({ position: { x: 2, y: 2 } });
  await expect(dialog(page)).toHaveCount(0);
  mode = 'empty';
  await trigger(page).click();
  await expect(dialog(page).getByRole('status')).toHaveCount(0);
  await dialog(page).getByRole('link', { name: 'Voir mon panier' }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(dialog(page)).toHaveCount(0);
});

test('existing cart recommendations are excluded and stock zero suggestions are hidden', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lepefy-cart', JSON.stringify({ version: 1, state: {
      items: [{ product: { id: 'existing', name: 'Existing', slug: 'existing', price: 1, stock: 5, image_url: null, weight_grams: null }, quantity: 1 }],
      pendingMutations: [], ownerCustomerId: null,
    } }));
  });
  await page.route('**/api/products/*/recommendations?*', route => route.fulfill({ json: {
    products: [suggestion('existing'), suggestion('sold', 0), suggestion('available')],
  } }));
  await page.goto('/');
  await trigger(page).click();
  await expect(dialog(page).getByText('Suggestion available', { exact: true })).toBeVisible();
  await expect(dialog(page).getByText('Suggestion existing', { exact: true })).toHaveCount(0);
  await expect(dialog(page).getByText('Suggestion sold', { exact: true })).toHaveCount(0);
});

test('public endpoint and product detail reuse real available recommendations; Goodies remains separate', async ({ page, request }) => {
  await page.goto('/');
  const href = await trigger(page).locator('xpath=ancestor::a').getAttribute('href');
  await trigger(page).click();
  const source = (await readItems(page))[0]!.product.id;
  const result = await request.get('/api/products/' + source + '/recommendations?limit=99');
  expect(result.status()).toBe(200);
  const body = await result.json();
  expect(body.strategy).toBe('similar');
  expect(body.products.length).toBeLessThanOrEqual(4);
  expect(body.products.every((p: { id: string; stock: number }) => p.id !== source && p.stock !== 0)).toBe(true);
  expect((await request.get('/api/products/not-a-uuid/recommendations')).status()).toBe(400);
  expect((await request.get('/api/products/00000000-0000-0000-0000-000000000000/recommendations')).status()).toBe(404);
  const productLink = dialog(page).locator('a').filter({ hasText: /.+/ }).filter({ hasNotText: 'Voir mon panier' }).first();
  await expect(productLink).toHaveAttribute('href', href!);
  await productLink.click();
  await expect(page).toHaveURL(new URL(href!, page.url()).href);
  await expect(dialog(page)).toHaveCount(0);
  if (body.products.length) await expect(page.getByRole('heading', { name: 'Vous aimerez aussi' })).toBeVisible();
  await page.goto('/gadgets');
  await expect(dialog(page)).toHaveCount(0);
  const cards = page.locator('a[href*="?from=gadgets"] button');
  for (const card of await cards.all()) {
    const box = await card.boundingBox();
    if (box) { expect(box.width).toBe(44); expect(box.height).toBe(44); }
  }
});

test('stepper respects the cart item stock and a product already in the cart', async ({ page }) => {
  await page.route('**/api/products/*/recommendations?*', route => route.fulfill({ json: { products: [] } }));
  await page.goto('/');
  await trigger(page).click();
  const item = (await readItems(page))[0]!;
  // Reuse a real product, with a conservative stock snapshot from an existing cart.
  expect(item.product.stock).toBeGreaterThan(1);
  await page.evaluate(() => {
    const persisted = JSON.parse(localStorage.getItem('lepefy-cart')!);
    persisted.state.items[0].product.stock = 2;
    persisted.state.items[0].quantity = 1;
    localStorage.setItem('lepefy-cart', JSON.stringify(persisted));
  });
  await page.reload();
  await trigger(page).click();
  const panel = dialog(page);
  const quantity = panel.getByTestId('confirmation-quantity');
  const minus = panel.getByRole('button', { name: /^Diminuer la quantité de / });
  const plus = panel.getByRole('button', { name: /^Augmenter la quantité de / });
  await expect(quantity).toHaveText('Quantité dans le panier : 2');
  await expect(plus).toBeDisabled();
  await minus.click();
  await expect(quantity).toHaveText('Quantité dans le panier : 1');
  await expect(minus).toBeDisabled();
  await plus.evaluate(el => { for (let i = 0; i < 10; i++) (el as HTMLButtonElement).click(); });
  await expect(quantity).toHaveText('Quantité dans le panier : 2');
  await expect(plus).toBeDisabled();
  expect((await readItems(page))[0]!.quantity).toBe(2);
  await expect(panel).toBeVisible();
});
