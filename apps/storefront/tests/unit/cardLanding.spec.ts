import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { TenantPaymentMethod } from '@lepefy/types';
import { hasValidPromotion, isShowcaseEligible, selectCardShowcase, type CardShowcaseCandidate } from '../../src/lib/card/cardShowcase';
import { cardPaymentBrandStrip, isOnlineCardMethod } from '../../src/lib/card/cardPaymentBrands';
import { CARD_HERO_ASSETS, isAllowedHeroImageUrl, normalizeHeroPosition, resolveCardHeroImage } from '../../src/lib/card/cardHero';
import { darkenHex, readableForeground } from '../../src/lib/card/cardTheme';
import { parseCardAmount, sanitizeAmountInput } from '../../src/lib/card/cardAmount';

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

test.describe('fascia moyens de paiement /card', () => {
  test('carte = Visa + Mastercard, Stripe jamais une marque, Google Pay jamais promis', () => {
    const strip = cardPaymentBrandStrip([method('card')]);
    expect(strip).toEqual({ brands: ['visa', 'mastercard'], chips: [], processedByStripe: true });
    expect(strip.brands as string[]).not.toContain('stripe');
    expect(strip.brands as string[]).not.toContain('google_pay');
  });

  test('seulement les méthodes visibles, dans un ordre stable', () => {
    const strip = cardPaymentBrandStrip([method('cash'), method('paypal'), method('other', 'Revolut'), method('apple_pay'), method('bank_transfer'), method('satispay')]);
    expect(strip.brands).toEqual(['apple_pay', 'paypal', 'satispay', 'revolut']);
    expect(strip.chips).toEqual(['bank_transfer', 'cash']);
    expect(strip.processedByStripe).toBe(true);
  });

  test('sans moyen numérique : pas de mention Stripe', () => {
    expect(cardPaymentBrandStrip([method('cash'), method('other', 'Ticket')])).toEqual({ brands: [], chips: ['cash'], processedByStripe: false });
    expect(cardPaymentBrandStrip([])).toEqual({ brands: [], chips: [], processedByStripe: false });
  });

  test('en ligne = flux Stripe (carte, Apple Pay) ; le reste est externe', () => {
    expect(['card', 'apple_pay', 'paypal', 'satispay', 'bank_transfer', 'cash', 'other'].map((m) => isOnlineCardMethod({ method: m as TenantPaymentMethod['method'] })))
      .toEqual([true, true, false, false, false, false, false]);
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
