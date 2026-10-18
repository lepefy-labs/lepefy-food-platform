import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { TenantPaymentMethod } from '@lepefy/types';
import { hasValidPromotion, isShowcaseEligible, selectCardShowcase, type CardShowcaseCandidate } from '../../src/lib/card/cardShowcase';
import { isOnlineCardMethod } from '../../src/lib/card/cardPaymentBrands';
import { cardLandingMethods, cardPaymentTiles, resolveCardPaymentEntry } from '../../src/lib/card/cardPaymentTiles';
import { visibleCardPaymentMethods } from '../../src/lib/payments/applePay';
import { CARD_HERO_ASSETS, isAllowedHeroImageUrl, normalizeHeroPosition, resolveCardHeroImage } from '../../src/lib/card/cardHero';
import { darkenHex, lightenHex, readableForeground } from '../../src/lib/card/cardTheme';
import { parseCardAmount, sanitizeAmountInput } from '../../src/lib/card/cardAmount';
import { defaultTimezone, emptyWeek, openingHoursSchema, openingStatus, statusLabel, weekRows, type OpeningHours } from '../../src/lib/card/openingHours';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

function product(id: string, overrides: Partial<CardShowcaseCandidate> = {}): CardShowcaseCandidate {
  return {
    id, price: 5, compare_at_price: null, image_url: `https://x.supabase.co/storage/v1/object/public/p/${id}.webp`,
    stock: 10, min_order_quantity: 1, order_quantity_step: 1, featured: false, position: 10, ...overrides,
  };
}

function method(kind: TenantPaymentMethod['method'], label: string | null = null): TenantPaymentMethod {
  return { id: `${kind}-${label ?? ''}`, tenant_id: 't1', method: kind, label, value: null, extra: null, sort_order: 0, active: true, enabled_modules: ['card'] };
}

test.describe('vitrine /card', () => {
  test('promotion réelle uniquement : prix barré strictement supérieur à un prix positif', () => {
    expect(hasValidPromotion({ price: 5, compare_at_price: 7 })).toBe(true);
    expect(hasValidPromotion({ price: 5, compare_at_price: 5 })).toBe(false);
    expect(hasValidPromotion({ price: 5, compare_at_price: 4 })).toBe(false);
    expect(hasValidPromotion({ price: 5, compare_at_price: null })).toBe(false);
    expect(hasValidPromotion({ price: 0, compare_at_price: 3 })).toBe(false);
  });

  test('achetable : photo, prix et stock couvrant le minimum et son pas', () => {
    expect(isShowcaseEligible(product('a'))).toBe(true);
    expect(isShowcaseEligible(product('a', { image_url: null }))).toBe(false);
    expect(isShowcaseEligible(product('a', { stock: 0 }))).toBe(false);
    expect(isShowcaseEligible(product('a', { stock: 5, min_order_quantity: 6 }))).toBe(false);
    expect(isShowcaseEligible(product('a', { stock: 6, min_order_quantity: 6, order_quantity_step: 6 }))).toBe(true);
    // Stock inconnu = non limité (même convention que deriveAvailability).
    expect(isShowcaseEligible(product('a', { stock: null, min_order_quantity: 12 }))).toBe(true);
  });

  test('priorité promo > mis en avant > disponible, ordre déterministe', () => {
    const rows = [
      product('plain', { position: 1 }),
      product('featured', { featured: true, position: 5 }),
      product('promo-small', { price: 9, compare_at_price: 10, position: 2 }),
      product('promo-big', { price: 5, compare_at_price: 10, position: 50 }),
    ];
    expect(selectCardShowcase(rows).map((p) => p.id)).toEqual(['promo-big', 'promo-small']);
    expect(selectCardShowcase([...rows].reverse()).map((p) => p.id)).toEqual(['promo-big', 'promo-small']);
    expect(selectCardShowcase(rows.slice(0, 2)).map((p) => [p.id, p.showcaseReason])).toEqual([['featured', 'featured'], ['plain', 'available']]);
  });

  test('promotion expirée (prix barré retiré) ou produit non achetable : jamais proposé comme promo', () => {
    const picked = selectCardShowcase([
      product('expired', { compare_at_price: null, position: 1 }),
      product('soldout-promo', { price: 3, compare_at_price: 6, stock: 0 }),
    ]);
    expect(picked.map((p) => [p.id, p.showcaseReason])).toEqual([['expired', 'available']]);
  });

  test('aucun candidat : liste vide (la page garde le lien boutique), doublons fusionnés', () => {
    expect(selectCardShowcase([product('a', { stock: 0 })])).toEqual([]);
    expect(selectCardShowcase([product('a'), product('a'), product('b')]).map((p) => p.id)).toEqual(['a', 'b']);
  });
});

test.describe('grille des moyens de paiement /card', () => {
  const all = () => [method('cash'), method('bank_transfer'), method('satispay'), method('other', 'Revolut'), method('paypal'), method('apple_pay'), method('card')];
  const layout = (methods: TenantPaymentMethod[]) => cardPaymentTiles(methods).map((tile) => [tile.kind, tile.span]);

  test('six moyens : deux lignes de 4 colonnes, carte et virement sur deux colonnes, jamais les espèces', () => {
    expect(layout(all())).toEqual([
      ['card', 2], ['apple_pay', 1], ['paypal', 1],
      ['satispay', 1], ['revolut', 1], ['bank_transfer', 2],
    ]);
  });

  test('Visa et Mastercard = une seule tuile Carte, Stripe et Google Pay jamais des tuiles', () => {
    const tiles = cardPaymentTiles([method('card'), { ...method('card'), id: 'card-2' }]);
    expect(tiles).toEqual([{ methodId: 'card-', kind: 'card', label: null, span: 4 }]);
    expect(tiles.map((tile) => tile.kind as string)).not.toContain('google_pay');
  });

  test('espèces exclues de /card seulement, sans toucher aux autres modules', () => {
    const methods = all();
    expect(cardLandingMethods(methods).map((m) => m.method)).not.toContain('cash');
    expect(methods.map((m) => m.method)).toContain('cash');
    expect(cardPaymentTiles([method('cash')])).toEqual([]);
  });

  test('Apple Pay non supporté par l’appareil : aucune tuile, la grille se réorganise sans trou', () => {
    const visible = visibleCardPaymentMethods(all(), true, false);
    expect(layout(visible)).toEqual([
      ['card', 2], ['paypal', 1], ['satispay', 1],
      ['revolut', 2], ['bank_transfer', 2],
    ]);
    expect(layout(visibleCardPaymentMethods(all(), false, true)).map(([kind]) => kind)).not.toContain('apple_pay');
  });

  test('chaque ligne de la grille fait exactement 4 colonnes, quel que soit le jeu de moyens', () => {
    const kinds: Array<[TenantPaymentMethod['method'], string | null]> = [['card', null], ['apple_pay', null], ['paypal', null], ['satispay', null], ['other', 'Revolut'], ['bank_transfer', null], ['other', 'Ticket Restaurant']];
    for (let mask = 1; mask < 1 << kinds.length; mask += 1) {
      const methods = kinds.filter((_, i) => mask & (1 << i)).map(([kind, label]) => method(kind, label));
      const tiles = cardPaymentTiles(methods);
      expect(tiles.length).toBe(methods.length);
      let row = 0;
      for (const tile of tiles) {
        expect(row + tile.span, `mask ${mask}`).toBeLessThanOrEqual(4);
        row = (row + tile.span) % 4;
      }
      expect(row, `mask ${mask}`).toBe(0);
    }
  });

  test('un seul moyen : une tuile pleine largeur ; aucun moyen : aucune grille', () => {
    expect(layout([method('paypal')])).toEqual([['paypal', 4]]);
    expect(cardPaymentTiles([])).toEqual([]);
    expect(cardPaymentTiles(cardLandingMethods([method('cash')]))).toEqual([]);
  });

  test('moyen inconnu mais configuré : tuile avec son libellé réel, jamais « Autres »', () => {
    const tiles = cardPaymentTiles([method('card'), method('other', 'Ticket Restaurant'), method('other', null)]);
    expect(tiles.map((tile) => [tile.kind, tile.label, tile.span])).toEqual([['card', null, 2], ['other', 'Ticket Restaurant', 2], ['other', 'Autre', 4]]);
  });

  test('tuile → écran ouvert directement : Stripe pour carte/Apple Pay, détail pour les moyens externes', () => {
    const methods = cardLandingMethods(all());
    expect(resolveCardPaymentEntry(methods, 'card-')).toEqual({ screen: 'online', method: method('card') });
    expect(resolveCardPaymentEntry(methods, 'apple_pay-')?.screen).toBe('online');
    for (const id of ['paypal-', 'satispay-', 'other-Revolut', 'bank_transfer-']) {
      expect(resolveCardPaymentEntry(methods, id), id).toEqual({ screen: 'detail', method: methods.find((m) => m.id === id) });
    }
  });

  test('id absent, inconnu, d’un autre tenant ou espèces : aucun écran direct (écran de choix)', () => {
    const methods = all();
    expect(resolveCardPaymentEntry(methods, null)).toBeNull();
    expect(resolveCardPaymentEntry(methods, 'forged-id')).toBeNull();
    expect(resolveCardPaymentEntry(methods, 'cash-')).toBeNull();
    // Apple Pay retiré (appareil non compatible) : son id n'ouvre plus rien.
    expect(resolveCardPaymentEntry(visibleCardPaymentMethods(methods, true, false), 'apple_pay-')).toBeNull();
  });

  test('en ligne = flux Stripe (carte, Apple Pay) ; le reste est externe', () => {
    expect(['card', 'apple_pay', 'paypal', 'satispay', 'bank_transfer', 'cash', 'other'].map((m) => isOnlineCardMethod({ method: m as TenantPaymentMethod['method'] })))
      .toEqual([true, true, false, false, false, false, false]);
  });

  test('surfaces des tuiles dérivées du tenant : verre clair sous texte foncé, carte lisible', () => {
    for (const color of ['#1D4ED8', '#1D9E75', '#F2C811', '#111827']) {
      expect(readableForeground(lightenHex(color, 0.9)), color).toBe('#111827');
    }
    expect(lightenHex('#000000', 0.5)).toBe('#808080');
    expect(lightenHex('invalid', 0.9)).toBe('#F3F4F6');
  });

  test('grille câblée : la hero ne garde ni CTA unique « Payer maintenant » ni « Autres »', () => {
    const hero = readFileSync('src/components/card/CardHero.tsx', 'utf8');
    expect(hero).toContain('CardPaymentMethodGrid');
    expect(hero).not.toContain('Payer maintenant');
    expect(hero).not.toMatch(/['"]Autres['"]/);
    const grid = readFileSync('src/components/card/CardPaymentMethodGrid.tsx', 'utf8');
    // Cibles tactiles ≥ 56 px, focus clavier visible, mouvement réduit respecté.
    expect(grid).toContain('min-h-14');
    expect(grid).toContain('focus-visible:ring-4');
    expect(grid).toContain('motion-reduce:transition-none');
  });
});

test.describe('photo hero /card', () => {
  const supabaseUrl = 'https://abc.supabase.co';

  test('origines autorisées : dossier public /images ou stockage public Supabase du projet', () => {
    expect(isAllowedHeroImageUrl('/images/card/x.webp', supabaseUrl)).toBe(true);
    expect(isAllowedHeroImageUrl(`${supabaseUrl}/storage/v1/object/public/brand/hero.webp`, supabaseUrl)).toBe(true);
    for (const url of ['https://evil.example/x.jpg', '/images/../secret', '//evil.example/x', '/api/x', `${supabaseUrl}/storage/v1/object/sign/x`, 'https://other.supabase.co/storage/v1/object/public/x', '']) {
      expect(isAllowedHeroImageUrl(url, supabaseUrl), url).toBe(false);
    }
  });

  test('config tenant > asset du code > aucune photo (dégradé)', () => {
    expect(resolveCardHeroImage({ slug: 'chloefood', config: { hero_image_url: '/images/card/other.webp', hero_image_position: 'right top' }, supabaseUrl }))
      .toEqual({ src: '/images/card/other.webp', position: 'right top' });
    expect(resolveCardHeroImage({ slug: 'chloefood', config: { hero_image_url: 'https://evil.example/x.jpg', hero_image_position: null }, supabaseUrl }))
      .toEqual(CARD_HERO_ASSETS.chloefood);
    // Un cadrage configuré remplace aussi le cadrage mobile de l'asset.
    expect(resolveCardHeroImage({ slug: 'chloefood', config: { hero_image_url: null, hero_image_position: 'left top' }, supabaseUrl }))
      .toEqual({ src: CARD_HERO_ASSETS.chloefood!.src, sources: CARD_HERO_ASSETS.chloefood!.sources, position: 'left top' });
    expect(resolveCardHeroImage({ slug: 'unknown-tenant', config: null, supabaseUrl })).toBeNull();
  });

  test('assets du code : chaque variante AVIF/WebP existe dans public/, jamais via /_next/image', () => {
    for (const [slug, asset] of Object.entries(CARD_HERO_ASSETS)) {
      const files = [asset.src, ...(asset.sources ?? []).flatMap((source) => source.srcSet.split(',').map((entry) => entry.trim().split(' ')[0]!))];
      expect(asset.sources?.map((source) => source.type), slug).toEqual(['image/avif', 'image/webp']);
      for (const file of files) {
        expect(file.startsWith('/images/'), file).toBe(true);
        expect(() => readFileSync(`public${file}`), file).not.toThrow();
      }
    }
    expect(readFileSync('src/components/card/CardHero.tsx', 'utf8')).not.toContain("from 'next/image'");
  });

  test('object-position limité à des mots-clés ou pourcentages', () => {
    expect(normalizeHeroPosition(' 72%   40% ')).toBe('72% 40%');
    expect(normalizeHeroPosition('center')).toBe('center');
    expect(normalizeHeroPosition('url(x)')).toBeNull();
    expect(normalizeHeroPosition('1px 2px 3px')).toBeNull();
  });

  test('fond de hero toujours sombre, texte lisible', () => {
    for (const color of ['#1D9E75', '#F2C811', '#FFFFFF', 'invalid']) {
      expect(readableForeground(darkenHex(color, 0.8)), color).toBe('#ffffff');
    }
  });
});

test.describe('montant /card', () => {
  test('virgule ou point, un seul séparateur, deux décimales', () => {
    expect(sanitizeAmountInput('12,50')).toBe('12,50');
    expect(sanitizeAmountInput('12.505')).toBe('12.50');
    expect(sanitizeAmountInput('1 200,5 €')).toBe('1200,5');
    expect(sanitizeAmountInput('12,5,3')).toBe('12,53');
    expect(sanitizeAmountInput(',5')).toBe('0,5');
    expect(sanitizeAmountInput('abc')).toBe('');
    expect(parseCardAmount('12,50')).toBe(12.5);
    expect(parseCardAmount('89')).toBe(89);
    expect(parseCardAmount('0,99')).toBe(0.99);
    expect(parseCardAmount('')).toBeNull();
    expect(parseCardAmount(',')).toBeNull();
  });
});

test.describe('horaires structurés /card', () => {
  const week = (): OpeningHours => {
    const days = emptyWeek();
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri'] as const) days[day] = [{ open: '09:00', close: '13:00' }, { open: '15:00', close: '19:00' }];
    days.sat = [{ open: '09:00', close: '19:00' }];
    return { timezone: 'Europe/Rome', days };
  };
  // 13 octobre 2026 = mardi. 10:00 UTC = 12:00 à Rome (UTC+2).
  const at = (iso: string) => new Date(iso);

  test('ouvert / fermé dans le fuseau du commerce, pause déjeuner comprise', () => {
    expect(openingStatus(week(), at('2026-10-13T10:00:00Z'))).toEqual({ state: 'open', closesAt: '13:00' });
    expect(openingStatus(week(), at('2026-10-13T11:30:00Z'))).toEqual({ state: 'closed', next: { dayOffset: 0, day: 'tue', time: '15:00' } });
    expect(openingStatus(week(), at('2026-10-13T18:00:00Z'))).toEqual({ state: 'closed', next: { dayOffset: 1, day: 'wed', time: '09:00' } });
    // Samedi 17/10 20:00 Rome → dimanche fermé → lundi.
    expect(openingStatus(week(), at('2026-10-17T18:30:00Z'))).toEqual({ state: 'closed', next: { dayOffset: 2, day: 'mon', time: '09:00' } });
    // Même instant, fuseau de Douala (UTC+1) : 11:00, ouvert.
    expect(openingStatus({ ...week(), timezone: 'Africa/Douala' }, at('2026-10-13T10:00:00Z')).state).toBe('open');
  });

  test('libellés FR / IT', () => {
    expect(statusLabel({ state: 'open', closesAt: '19:00' }, 'fr')).toEqual({ title: 'Ouvert maintenant', detail: 'jusqu’à 19h00' });
    expect(statusLabel({ state: 'closed', next: { dayOffset: 1, day: 'wed', time: '09:00' } }, 'fr').detail).toBe('ouvre demain à 9h00');
    expect(statusLabel({ state: 'closed', next: { dayOffset: 3, day: 'mon', time: '09:30' } }, 'it').detail).toBe('apre lunedì alle 9:30');
  });

  test('tableau regroupé et validation', () => {
    expect(weekRows(week()).map((row) => [row.from, row.to, row.ranges.length])).toEqual([['mon', 'fri', 2], ['sat', 'sat', 1], ['sun', 'sun', 0]]);
    expect(openingHoursSchema.safeParse(week()).success).toBe(true);
    const bad = week(); bad.days.mon = [{ open: '12:00', close: '10:00' }];
    expect(openingHoursSchema.safeParse(bad).success).toBe(false);
    const overlap = week(); overlap.days.tue = [{ open: '09:00', close: '14:00' }, { open: '13:00', close: '19:00' }];
    expect(openingHoursSchema.safeParse(overlap).success).toBe(false);
    expect(openingHoursSchema.safeParse({ ...week(), timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(defaultTimezone('FR')).toBe('Europe/Paris');
    expect(defaultTimezone('IT')).toBe('Europe/Rome');
  });
});

test.describe('photo téléversée et permissions admin /card', () => {
  const supabaseUrl = 'https://abc.supabase.co';

  test('variantes téléversées prioritaires, jamais d’URL tierce', () => {
    const base = `${supabaseUrl}/storage/v1/object/public/assets/card-hero/t1/v123`;
    const image = resolveCardHeroImage({ slug: 'chloefood', supabaseUrl, config: { hero_image_base: base, hero_image_widths: [1200, 480, 800], hero_image_position: null, hero_image_url: null } });
    expect(image?.src).toBe(`${base}-800.webp`);
    expect(image?.sources?.[0]).toEqual({ type: 'image/avif', srcSet: `${base}-480.avif 480w, ${base}-800.avif 800w, ${base}-1200.avif 1200w` });
    expect(resolveCardHeroImage({ slug: 'chloefood', supabaseUrl, config: { hero_image_base: 'https://evil.example/x', hero_image_widths: [800], hero_image_position: null, hero_image_url: null } }))
      .toEqual(CARD_HERO_ASSETS.chloefood);
  });

  test('routes admin mappées sur les réglages du tenant', () => {
    expect(permissionForAdminApi('/api/admin/card/hero-image', 'POST')).toBe('tenant_settings.manage');
    expect(permissionForAdminApi('/api/admin/card/settings', 'GET')).toBe('tenant_settings.view');
    expect(permissionForAdminApi('/api/admin/card/settings', 'PATCH')).toBe('tenant_settings.manage');
  });
});
