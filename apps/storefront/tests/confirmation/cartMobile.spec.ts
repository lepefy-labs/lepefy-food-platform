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
  test(`long cart at ${width}px: action bar above the bottom navigation, never covering the last item`, async ({ page }) => {
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
    // La BottomNav reste (Panier actif) ; la barre se pose juste au-dessus.
    const nav = page.getByRole('navigation', { name: 'Navigation boutique' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: /panier/i })).toHaveAttribute('aria-current', 'page');
    // En-tête contextuel : pas de logo ni de menu commercial sur le panier mobile.
    await expect(page.getByRole('button', { name: 'Ouvrir le menu' })).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Mon panier' })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    const barBox = (await bar.boundingBox())!;
    const navBox = (await nav.boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(navBox.y + 1);
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

test('empty cart keeps the bottom navigation and search, shows no action bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/cart');
  await expect(page.getByRole('navigation', { name: 'Navigation boutique' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Votre panier est vide' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Voir les produits' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Rechercher un produit à ajouter au panier' })).toBeVisible();
  await expect(page.getByTestId('cart-checkout-bar')).toHaveCount(0);
});

test('search from the cart adds the minimum without leaving the cart', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const items = await seedCart(page, 1);
  const { products } = await page.evaluate(() => fetch('/api/products?limit=24').then(r => r.json())) as { products: Item['product'][] };
  const target = products.find(p => !items.some(i => i.product.id === p.id) && (p.stock ?? 0) >= (p.min_order_quantity ?? 1) + (p.order_quantity_step ?? 1));
  test.skip(!target, 'no purchasable product to add');
  await page.goto('/cart');
  const search = page.getByRole('searchbox', { name: 'Rechercher un produit à ajouter au panier' });
  await search.fill(String(target!.name).slice(0, 12));
  const results = page.getByRole('list', { name: /^Résultats pour/ });
  const add = results.locator('li').filter({ hasText: String(target!.name) }).first().getByRole('button', { name: /^Ajouter/ });
  await expect(add).toBeVisible();
  await search.press('Enter');
  await add.click();
  await expect(page).toHaveURL(/\/cart$/);
  const added = (await readItems(page)).find(i => i.product.id === target!.id);
  expect(added?.quantity).toBe(target!.min_order_quantity ?? 1);
  // Le résultat montre le même +/− que les lignes ; « + » ajoute le pas de la règle.
  await results.getByRole('button', { name: `Augmenter la quantité de ${target!.name}` }).click();
  expect((await readItems(page)).find(i => i.product.id === target!.id)?.quantity)
    .toBe((target!.min_order_quantity ?? 1) + (target!.order_quantity_step ?? 1));
  await expect(page.getByRole('navigation', { name: 'Navigation boutique' })).toBeVisible();
});

test('cart search stays reachable, tolerates typos, and the bottom nav returns when the keyboard closes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedCart(page, 8);
  const { products } = await page.evaluate(() => fetch('/api/products?limit=24').then(r => r.json())) as { products: Item['product'][] };
  // Un mot d'au moins 6 lettres d'un vrai produit, avec deux lettres inversées.
  const word = products.flatMap(p => String(p.name).split(/[^A-Za-zÀ-ÿ]+/)).find(w => w.length >= 6 && /^[a-z]+$/i.test(w))!;
  const typo = word.charAt(0) + word.charAt(2) + word.charAt(1) + word.slice(3);
  await page.goto('/cart');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const search = page.getByRole('searchbox', { name: 'Rechercher un produit à ajouter au panier' });
  // Collante dans l'en-tête du panier : toujours visible en haut.
  await expect(search).toBeInViewport();
  expect((await search.boundingBox())!.y).toBeLessThan(130);
  await search.fill(typo.toLowerCase());
  const panel = page.locator('section[aria-label="Ajouter un produit au panier"] [id$="-results"]');
  await expect(panel.getByRole('list').first()).toBeVisible();
  await expect(panel).toContainText(new RegExp(word, 'i'));
  // Clavier simulé : la zone visible rétrécit → BottomNav et barre s'effacent ;
  // elle revient → le champ perd le focus et la BottomNav réapparaît sans toucher l'écran.
  await page.setViewportSize({ width: 390, height: 460 });
  await expect(page.getByRole('navigation', { name: 'Navigation boutique' })).toHaveCount(0);
  await expect(page.getByTestId('cart-checkout-bar')).toBeHidden();
  const panelBox = (await panel.boundingBox())!;
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(460);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Navigation boutique' })).toBeVisible();
  await expect(page.getByTestId('cart-checkout-bar')).toBeVisible();
  await expect(search).not.toBeFocused();
});

test('cart lines are independent cards with a single remove action and a readable total', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const items = await seedCart(page, 6);
  await page.goto('/cart');
  const cards = page.locator('section[aria-label="Articles du panier"] > ul > li');
  await expect(cards).toHaveCount(items.length);
  const boxes = await cards.evaluateAll((lis) => lis.map((li) => {
    const style = getComputedStyle(li);
    const rect = li.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, right: rect.right, radius: parseFloat(style.borderTopLeftRadius), border: parseFloat(style.borderTopWidth),
      removes: li.querySelectorAll('button[aria-label^="Retirer"]').length, minus: li.querySelectorAll('button[aria-label^="Diminuer"]').length,
      overflow: [...li.querySelectorAll('*')].some((el) => el.getBoundingClientRect().right > rect.right + 0.5) };
  }));
  for (const [i, box] of boxes.entries()) {
    expect(box.radius).toBeGreaterThanOrEqual(16);
    expect(box.border).toBeGreaterThan(0);
    // Une seule action sur la quantité basse : «−» ou corbeille, jamais une seconde croix.
    expect(box.removes + box.minus).toBe(1);
    expect(box.overflow).toBe(false);
    if (i > 0) expect(box.top - boxes[i - 1]!.bottom).toBeGreaterThanOrEqual(8);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // + puis − suivent la règle (minimum, pas) ; au minimum le «−» devient une corbeille.
  const first = items[0]!;
  const card = cards.first();
  const minimum = first.product.min_order_quantity ?? 1;
  const step = first.product.order_quantity_step ?? 1;
  await expect(card.getByRole('button', { name: `Retirer ${first.product.name} du panier` })).toBeVisible();
  const total = card.getByText('Total').locator('..');
  const before = await total.textContent();
  const plus = card.getByRole('button', { name: `Augmenter la quantité de ${first.product.name}` });
  if (await plus.isEnabled()) {
    await plus.click();
    expect((await readItems(page))[0]!.quantity).toBe(minimum + step);
    await expect(total).not.toHaveText(before!);
    const minus = card.getByRole('button', { name: `Diminuer la quantité de ${first.product.name}` });
    const minusBox = (await minus.boundingBox())!;
    await minus.click();
    expect((await readItems(page))[0]!.quantity).toBe(minimum);
    const trashBox = (await card.getByRole('button', { name: `Retirer ${first.product.name} du panier` }).boundingBox())!;
    // Le «−» devenu corbeille garde sa place et sa taille.
    expect(Math.abs(trashBox.x - minusBox.x)).toBeLessThanOrEqual(1);
    expect(trashBox.width).toBeGreaterThanOrEqual(44);
  }
  // Le nom mène à la fiche produit.
  await expect(card.getByRole('link', { name: String(first.product.name) })).toHaveAttribute('href', `/products/${first.product.slug}`);
});

test('an unavailable line offers only the remove action', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const items = await seedCart(page, 2);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('lepefy-cart')!);
    raw.state.items[0].product.stock = 0;
    localStorage.setItem('lepefy-cart', JSON.stringify(raw));
  });
  await page.goto('/cart');
  const card = page.locator('section[aria-label="Articles du panier"] > ul > li').first();
  await expect(card.getByRole('button', { name: /^Augmenter/ })).toBeDisabled();
  await expect(card.getByRole('button', { name: /^Diminuer/ })).toHaveCount(0);
  await card.getByRole('button', { name: `Retirer ${items[0]!.product.name} du panier` }).click();
  expect((await readItems(page)).some((i) => i.product.id === items[0]!.product.id)).toBe(false);
  // Un produit qui ne peut plus revenir n'offre pas d'« Annuler » trompeur.
  await expect(page.getByTestId('cart-checkout-bar').getByRole('button', { name: 'Annuler' })).toHaveCount(0);
});

test.describe('catalogue intégré au panier', () => {
  const catalogCards = (page: Page) => page.locator('section[aria-labelledby="cart-catalog-title"] ul > li:not([aria-hidden="true"])');
  const suggestionLinks = (page: Page) => page.locator('section[aria-labelledby="cart-suggestions-title"] a[href^="/products/"]');
  const addButton = /^Ajouter( \d+)? au panier$/;
  /** Attend la page stabilisée (suggestions affichées) puis descend jusqu'au catalogue. */
  async function scrollToCatalog(page: Page) {
    await expect(page.getByRole('heading', { name: /Complétez votre panier/ })).toBeVisible({ timeout: 20000 });
    await page.getByRole('heading', { name: 'Tous les produits' }).scrollIntoViewIfNeeded();
  }

  test('« Continuer mes achats » is written out, then suggestions and an infinite product grid', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedCart(page, 2);
    await page.goto('/cart');
    const back = page.getByRole('link', { name: 'Continuer mes achats' }).first();
    await expect(back).toBeVisible();
    expect(await back.innerText()).toContain('Continuer mes achats');
    await expect(page.getByRole('heading', { level: 1, name: 'Mon panier' })).toBeVisible();

    await expect(page.getByRole('heading', { name: /Complétez votre panier/ })).toBeVisible({ timeout: 20000 });
    const suggested = await suggestionLinks(page).evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(suggested.length).toBeGreaterThan(0);
    expect(suggested.length).toBeLessThanOrEqual(8);

    await scrollToCatalog(page);
    await expect(catalogCards(page)).toHaveCount(12, { timeout: 20000 });
    // Défilement : la page suivante arrive, sans doublon ni produit déjà suggéré au-dessus.
    for (let i = 0; i < 4 && (await catalogCards(page).count()) <= 12; i++) { await page.mouse.wheel(0, 3000); await page.waitForTimeout(800); }
    expect(await catalogCards(page).count()).toBeGreaterThan(12);
    const hrefs = await catalogCards(page).locator('a[href^="/products/"]').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.filter((href) => suggested.includes(href))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Le récapitulatif reste au-dessus de la BottomNav pendant le défilement du catalogue.
    const bar = (await page.getByTestId('cart-checkout-bar').boundingBox())!;
    const nav = (await page.getByRole('navigation', { name: 'Navigation boutique' }).boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(nav.y + 1);
  });

  test('adding from the grid stays on the cart, without a dialog, the card under the finger', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const items = await seedCart(page, 1);
    await page.goto('/cart');
    await scrollToCatalog(page);
    await expect(catalogCards(page).first()).toBeVisible({ timeout: 20000 });
    // Carte fixée par sa position : après l'ajout elle n'a plus de bouton « Ajouter ».
    const index = await catalogCards(page).evaluateAll((lis) => lis.findIndex((li) => [...li.querySelectorAll('button')].some((b) => /^Ajouter( \d+)? au panier$/.test(b.getAttribute('aria-label') ?? ''))));
    expect(index).toBeGreaterThanOrEqual(0);
    const card = catalogCards(page).nth(index);
    // Carte au centre : le clic ne fait défiler ni Playwright ni la page.
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    const before = (await card.boundingBox())!.y;
    const subtotal = await page.getByTestId('cart-checkout-bar').locator('[aria-live]').textContent();
    await card.getByRole('button', { name: addButton }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect.poll(async () => (await readItems(page)).length).toBe(items.length + 1);
    await expect(page.locator('#add-confirmation-title')).toHaveCount(0);
    expect(Math.abs((await card.boundingBox())!.y - before)).toBeLessThanOrEqual(2);
    await expect(card.getByRole('group', { name: /^Quantité de / })).toBeVisible();
    await expect(page.getByTestId('cart-checkout-bar').locator('[aria-live]')).not.toHaveText(subtotal!);
    const units = (await readItems(page)).reduce((sum, i) => sum + i.quantity, 0);
    await expect(page.getByRole('navigation', { name: 'Navigation boutique' }).getByRole('link', { name: /panier/i }))
      .toHaveAttribute('aria-label', new RegExp(`${units} article`));
  });

  test('a failed page shows « Réessayer », and the retry continues the list', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedCart(page, 1);
    let failed = false;
    await page.route(/\/api\/products\?.*limit=12.*page=2/, async (route) => {
      if (!failed) { failed = true; await route.fulfill({ status: 500, body: '{}' }); } else await route.fallback();
    });
    await page.goto('/cart');
    await scrollToCatalog(page);
    await expect(catalogCards(page)).toHaveCount(12, { timeout: 20000 });
    const retry = page.getByRole('button', { name: 'Réessayer' });
    for (let i = 0; i < 4 && !(await retry.isVisible()); i++) { await page.mouse.wheel(0, 3000); await page.waitForTimeout(800); }
    await expect(retry).toBeVisible();
    await retry.click();
    await expect.poll(() => catalogCards(page).count(), { timeout: 20000 }).toBeGreaterThan(12);
  });

  test('a category filter reaches its last page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/cart');
    const chips = page.getByRole('group', { name: 'Filtrer par catégorie' }).getByRole('button');
    await expect(chips.first()).toBeVisible();
    test.skip((await chips.count()) < 2, 'one category only');
    await chips.nth(1).click();
    await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
    const end = page.getByText('Vous avez vu tous les produits.');
    const none = page.getByText('Aucun produit dans cette catégorie.');
    for (let i = 0; i < 12 && !(await end.isVisible()) && !(await none.isVisible()); i++) { await page.mouse.wheel(0, 3000); await page.waitForTimeout(700); }
    expect((await end.isVisible()) || (await none.isVisible())).toBe(true);
  });

  test('empty cart: message, then the catalogue; the first add shows the cart without losing the place', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/cart');
    await expect(page.getByRole('heading', { level: 2, name: 'Votre panier est vide' })).toBeVisible();
    await expect(page.getByTestId('cart-checkout-bar')).toHaveCount(0);
    await scrollToCatalog(page);
    await expect(catalogCards(page).first()).toBeVisible({ timeout: 20000 });
    const card = catalogCards(page).filter({ has: page.getByRole('button', { name: addButton }) }).first();
    const href = await card.locator('a[href^="/products/"]').first().getAttribute('href');
    await card.getByRole('button', { name: addButton }).click();
    await expect.poll(async () => (await readItems(page)).length).toBe(1);
    await expect(page.getByTestId('cart-checkout-bar')).toBeVisible();
    await expect(page.locator(`section[aria-labelledby="cart-catalog-title"] a[href="${href}"]`)).toBeInViewport();
  });

  test('back from a product page restores the loaded grid and the position', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedCart(page, 1);
    await page.goto('/cart');
    await scrollToCatalog(page);
    await expect(catalogCards(page)).toHaveCount(12, { timeout: 20000 });
    const link = catalogCards(page).nth(6).locator('a[href^="/products/"]').first();
    const href = (await link.getAttribute('href'))!;
    await link.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => scrollY);
    await link.click();
    await page.waitForURL((url) => url.pathname === href);
    await page.goBack();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.locator(`section[aria-labelledby="cart-catalog-title"] a[href="${href}"]`)).toBeVisible({ timeout: 20000 });
    await expect.poll(() => page.evaluate(() => scrollY), { timeout: 10000 }).toBeGreaterThan(y - 200);
  });
});

test('removing a line offers an undo in the bottom bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const items = await seedCart(page, 2);
  await page.goto('/cart');
  const name = String(items[0]!.product.name);
  await page.getByRole('button', { name: `Retirer ${name} du panier` }).first().click();
  expect((await readItems(page)).some(i => i.product.id === items[0]!.product.id)).toBe(false);
  await page.getByTestId('cart-checkout-bar').getByRole('button', { name: 'Annuler' }).click();
  expect((await readItems(page)).find(i => i.product.id === items[0]!.product.id)?.quantity).toBe(items[0]!.quantity);
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

/** Le bloc « Tout voir » d'une vue complète, ou rien quand le bloc est absent. */
const shelfButton = (page: Page, name: RegExp) => page.locator('main').getByRole('link', { name });

for (const view of [
  { url: '/?promo=1', title: /Nos promos/, empty: 'Aucune promotion en ce moment.', badge: /^Promo −\d+ %$/, all: /^Tout voir les promos \((\d+)\)$/ },
  { url: '/?new=1', title: /Nouveautés/, empty: 'Aucune nouveauté en ce moment.', badge: /^Nouveau$/, all: /^Tout voir les nouveautés \((\d+)\)$/ },
]) {
  test(`${view.url}: full view, badges, way back, and the shelf « Tout voir » count`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(view.url);
    await expect(page.getByRole('heading', { name: view.title }).first()).toBeVisible();
    // Les anciens accès de l'en-tête n'existent plus ; un bouton ramène au catalogue complet.
    const seeAll = page.getByRole('button', { name: 'Voir tout le catalogue' });
    await expect(seeAll.first()).toBeVisible();
    if (await page.getByText(view.empty).count()) return;
    // En haut et en fin de liste.
    await expect(seeAll).toHaveCount(2);
    expect((await seeAll.last().boundingBox())!.height).toBeGreaterThanOrEqual(48);
    const count = await page.locator('main').getByText(view.badge).count();
    expect(count).toBeGreaterThan(0);
    await page.goto('/');
    const button = shelfButton(page, view.all);
    await expect(button).toBeVisible();
    expect(Number(view.all.exec((await button.getAttribute('aria-label')) ?? '')?.[1])).toBe(count);
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await button.click();
    await expect(page).toHaveURL(new RegExp(view.url.replace('?', '\\?') + '$'));
  });
}

test('catalogue: no header pills, sort renamed, and no product repeated below the shelves', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('option', { name: 'Derniers ajoutés' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Nos promos|Nouveautés/ })).toHaveCount(0);
  const hrefs = (selector: string) => page.locator(selector).evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  const shelves = await hrefs('main section[aria-labelledby$="-shelf-title"] li a[href^="/products/"]');
  // Charge au moins une page suivante (scroll infini) avant de comparer.
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 6000); await page.waitForTimeout(700); }
  const grid = await hrefs('main > div > div.grid a[href^="/products/"]');
  expect(grid.length).toBeGreaterThan(0);
  expect(grid.filter((href) => shelves.includes(href))).toEqual([]);
  expect(new Set(grid).size).toBe(grid.length);
});

test('desktop cart keeps its summary column and has no mobile bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedCart(page, 2);
  await page.goto('/cart');
  await expect(page.getByTestId('cart-checkout-bar')).toBeHidden();
  await expect(page.locator('aside').getByRole('button', { name: /Livraison et paiement/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continuer mes achats' }).first()).toBeVisible();
});
