import { expect, test } from '@playwright/test';
import {
  allowedEdits,
  editDistance,
  normalizeSearchText,
  rankSimilarProducts,
  tokenSimilarity,
} from '../../src/lib/catalog/similarProductSearch';

const catalogue = [
  { id: '1', name: 'Saka Saka / Feuilles de manioc' },
  { id: '2', name: 'Foufou / Farine de manioc' },
  { id: '3', name: 'Bobolo sous vide' },
  { id: '4', name: 'Crevettes séchées' },
  { id: '5', name: 'Piment rouge' },
  { id: '6', name: 'Huile de palme' },
  { id: '7', name: 'Secret bouillon' },
];
const names = (query: string, limit = 5) => rankSimilarProducts(query, catalogue, limit).map((p) => p.name);

test.describe('recherche tolérante aux fautes', () => {
  test('normalise accents, majuscules et ponctuation', () => {
    expect(normalizeSearchText('Crevettes Séchées / Bio!')).toEqual(['crevettes', 'sechees', 'bio']);
  });

  test('distance d’édition avec inversion de lettres voisines', () => {
    expect(editDistance('manioc', 'manioc')).toBe(0);
    expect(editDistance('maniok', 'manioc')).toBe(1);
    expect(editDistance('mnaioc', 'manioc')).toBe(1);
    expect(editDistance('bobollo', 'bobolo')).toBe(1);
    expect(editDistance('abc', 'xyzxyz', 1)).toBe(2);
  });

  test('fautes tolérées selon la longueur du mot', () => {
    expect(allowedEdits(2)).toBe(0);
    expect(allowedEdits(4)).toBe(1);
    expect(allowedEdits(6)).toBe(2);
    expect(allowedEdits(9)).toBe(3);
  });

  test('un début de mot exact vaut une correspondance complète', () => {
    expect(tokenSimilarity('mani', 'manioc')).toBe(1);
    expect(tokenSimilarity('xy', 'manioc')).toBe(0);
  });

  test('retrouve les produits malgré une faute de frappe', () => {
    expect(names('maniok')).toEqual(['Foufou / Farine de manioc', 'Saka Saka / Feuilles de manioc']);
    // « bouillon » n'est pas proche de « bobollo ».
    expect(names('bobollo')).toEqual(['Bobolo sous vide']);
    expect(names('bouilon')).toEqual(['Secret bouillon']);
    expect(names('crevete')).toEqual(['Crevettes séchées']);
    expect(names('sechee')).toEqual(['Crevettes séchées']);
    expect(names('pimant')).toEqual(['Piment rouge']);
  });

  test('chaque mot tapé doit trouver un mot proche', () => {
    expect(names('huile palm')).toEqual(['Huile de palme']);
    expect(names('huile manioc')).toEqual([]);
  });

  test('aucune proposition pour un mot sans rapport ou trop court', () => {
    expect(names('ordinateur')).toEqual([]);
    expect(names('a')).toEqual([]);
    expect(names('maniok', 0)).toEqual([]);
  });

  test('respecte la limite demandée', () => {
    expect(names('manioc', 1)).toHaveLength(1);
  });
});
