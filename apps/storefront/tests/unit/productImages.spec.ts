import { test, expect } from '@playwright/test';
import {
  MAX_PRODUCT_IMAGES,
  moveProductImage,
  normalizeProductImages,
} from '@/lib/catalog/productImages';

test('normalise la couverture legacy et supprime les doublons', async () => {
  expect(normalizeProductImages(
    [
      { url: 'https://cdn.test/second.jpg', alt: 'Deuxième vue' },
      { url: 'https://cdn.test/main.jpg', alt: 'Doublon' },
      { url: '' },
      null,
    ],
    'https://cdn.test/main.jpg',
    'Produit',
  )).toEqual([
    { url: 'https://cdn.test/main.jpg', alt: 'Produit' },
    { url: 'https://cdn.test/second.jpg', alt: 'Deuxième vue' },
  ]);
});

test('limite la galerie à huit images', async () => {
  const images = Array.from({ length: 12 }, (_, index) => ({
    url: 'https://cdn.test/' + index + '.jpg',
  }));
  expect(normalizeProductImages(images)).toHaveLength(MAX_PRODUCT_IMAGES);
});

test('réordonne sans muter la galerie source', async () => {
  const images = [
    { url: 'https://cdn.test/a.jpg' },
    { url: 'https://cdn.test/b.jpg' },
    { url: 'https://cdn.test/c.jpg' },
  ];
  const moved = moveProductImage(images, 2, 0);
  expect(moved.map((image) => image.url)).toEqual([
    'https://cdn.test/c.jpg',
    'https://cdn.test/a.jpg',
    'https://cdn.test/b.jpg',
  ]);
  expect(images[0]?.url).toBe('https://cdn.test/a.jpg');
});
