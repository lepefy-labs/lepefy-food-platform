import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { shopLinkPrefetch } from '@/lib/storefront/linkPrefetch';

test.describe('shopLinkPrefetch', () => {
  test('dynamic or personal shop pages are never prefetched speculatively', () => {
    for (const href of ['/', '/cart', '/gadgets', '/compte', '/compte/connexion', '/orders', '/supprimer-compte', '/livraison', '/checkout']) {
      expect(shopLinkPrefetch(href), href).toBe(false);
    }
  });

  test('filtered catalogue views are dynamic, whatever the path', () => {
    for (const href of ['/?category=epices', '/?promo=1', '/?new=1', '/?quantityGroup=abc', '/gadgets?category=x', '/accueil?x=1']) {
      expect(shopLinkPrefetch(href), href).toBe(false);
    }
  });

  test('cached (ISR/static) pages keep the default Next.js prefetch', () => {
    for (const href of ['/accueil', '/accueil#origine', '/avis', '/card', '/evenementiel', '/politique-confidentialite', '/conditions-generales-vente', '/products/koki', '/accueil/']) {
      expect(shopLinkPrefetch(href), href).toBeUndefined();
    }
  });

  test('external, protocol-relative and hash-only links are left alone', () => {
    for (const href of ['https://events.example.com/evenements', '//cdn.example.com/x', '#origine', 'mailto:a@b.c']) {
      expect(shopLinkPrefetch(href), href).toBeUndefined();
    }
  });
});

test.describe('shop navigation uses the prefetch policy', () => {
  const source = (file: string) => readFileSync(path.join(__dirname, '../../src/components', file), 'utf8');

  test('bottom bar, menu and catalogue shortcuts derive prefetch from their href', () => {
    expect(source('layout/BottomNav.tsx')).toContain('prefetch={shopLinkPrefetch(href)}');
    expect(source('layout/BrandNavigationDrawer.tsx')).toContain('prefetch={shopLinkPrefetch(item.href)}');
    expect(source('catalog/CatalogShelf.tsx')).toContain('prefetch={shopLinkPrefetch(href)}');
  });

  test('no header link to the catalogue or the cart prefetches', () => {
    const header = source('layout/Header.tsx');
    const links = header.match(/<Link\s+href="\/(cart)?"[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toContain('prefetch={false}');
    expect(header).toContain('prefetch={shopLinkPrefetch(accountHref)}');
  });
});
