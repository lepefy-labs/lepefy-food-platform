import { test, expect } from '@playwright/test';
import {
  cartonsForWeight,
  groupSuggestedCartons,
  parseSuggestRange,
  splitParcelWeightsFilled,
  suggestCartons,
  type CartonProfile,
} from '../../src/lib/shipping/cartonSuggestion';

function profile(id: string, position: number, min: number | null, max: number | null, active = true): CartonProfile {
  return { id, name: id, box_length_cm: 40, box_width_cm: 30, box_height_cm: 20, active, position, suggest_min_weight_g: min, suggest_max_weight_g: max };
}

const S = profile('S', 1, 0, 5000);
const M = profile('M', 2, 5000, 15000);
const L = profile('L', 3, 12500, 15000);
const LAB = profile('Cube', 0, null, null);
const PROFILES = [LAB, L, M, S];

test.describe('splitParcelWeightsFilled', () => {
  test('colis pleins puis reste', () => {
    expect(splitParcelWeightsFilled(20000, 15000)).toEqual([15000, 5000]);
    expect(splitParcelWeightsFilled(30000, 15000)).toEqual([15000, 15000]);
    expect(splitParcelWeightsFilled(1200, 15000)).toEqual([1200]);
    expect(splitParcelWeightsFilled(0, 15000)).toEqual([]);
  });
});

test.describe('cartonsForWeight', () => {
  test('bornes : min exclusif, max inclusif', () => {
    expect(cartonsForWeight(5000, PROFILES).map((p) => p.id)).toEqual(['S']);
    expect(cartonsForWeight(5001, PROFILES).map((p) => p.id)).toEqual(['M']);
    expect(cartonsForWeight(15000, PROFILES).map((p) => p.id)).toEqual(['M', 'L']);
    expect(cartonsForWeight(15001, PROFILES)).toEqual([]);
  });

  test('ignore profils inactifs et profils sans tranche', () => {
    expect(cartonsForWeight(1000, [LAB, profile('S2', 0, 0, 5000, false)])).toEqual([]);
  });
});

test.describe('suggestCartons', () => {
  test('commande légère → un carton S', () => {
    const s = suggestCartons(1200, PROFILES, 15000)!;
    expect(s.parcels).toHaveLength(1);
    expect(s.parcels[0]!.carton?.id).toBe('S');
    expect(s.parcels[0]!.alternatives).toEqual([]);
  });

  test('20 kg → M (15 kg) + S (5 kg), L proposé en alternative pour le colis plein', () => {
    const s = suggestCartons(20000, PROFILES, 15000)!;
    expect(s.parcels.map((p) => [p.weightG, p.carton?.id])).toEqual([[15000, 'M'], [5000, 'S']]);
    expect(s.parcels[0]!.alternatives.map((p) => p.id)).toEqual(['L']);
  });

  test('30 kg → 2 × M regroupés', () => {
    const groups = groupSuggestedCartons(suggestCartons(30000, PROFILES, 15000)!);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.carton?.id).toBe('M');
    expect(groups[0]!.count).toBe(2);
  });

  test('aucun profil configuré (migration absente) → pas de suggestion', () => {
    const legacy = { ...LAB } as CartonProfile;
    delete (legacy as Partial<CartonProfile>).suggest_max_weight_g;
    expect(suggestCartons(1200, [legacy], 15000)).toBeNull();
  });

  test('poids sans carton couvrant → colis signalé sans carton', () => {
    const s = suggestCartons(8000, [S], 15000)!;
    expect(s.parcels[0]!.carton).toBeNull();
  });
});

test.describe('parseSuggestRange', () => {
  test('clés absentes → rien à écrire', () => {
    expect(parseSuggestRange({ name: 'x' })).toEqual({ ok: true, patch: {} });
  });

  test('valeurs valides et remise à null', () => {
    expect(parseSuggestRange({ suggest_min_weight_g: 0, suggest_max_weight_g: '5000' }))
      .toEqual({ ok: true, patch: { suggest_min_weight_g: 0, suggest_max_weight_g: 5000 } });
    expect(parseSuggestRange({ suggest_min_weight_g: null, suggest_max_weight_g: '' }))
      .toEqual({ ok: true, patch: { suggest_min_weight_g: null, suggest_max_weight_g: null } });
  });

  test('refuse min ≥ max, max nul ou négatif, min sans max', () => {
    expect(parseSuggestRange({ suggest_min_weight_g: 5000, suggest_max_weight_g: 5000 }).ok).toBe(false);
    expect(parseSuggestRange({ suggest_max_weight_g: 0 }).ok).toBe(false);
    expect(parseSuggestRange({ suggest_min_weight_g: -1 }).ok).toBe(false);
    expect(parseSuggestRange({ suggest_min_weight_g: 1000, suggest_max_weight_g: null }).ok).toBe(false);
  });
});
