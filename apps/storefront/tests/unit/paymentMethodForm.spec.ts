import { test, expect } from '@playwright/test';
import type { TenantPaymentMethod } from '@lepefy/types';
import {
  draftFromMethod,
  draftToBody,
  draftsEqual,
  emptyDraft,
  formatIban,
  isValidIban,
  moveItem,
  paymentMethodSummary,
  planReorder,
  validateDraft,
} from '../../src/lib/payments/paymentMethodForm';

const row = (over: Partial<TenantPaymentMethod>): TenantPaymentMethod => ({
  id: 'id-1', tenant_id: 't', method: 'paypal', label: null, value: null, extra: null,
  sort_order: 0, active: true, enabled_modules: ['shop', 'card', 'event', 'rental'], ...over,
});

test.describe('IBAN', () => {
  test('accepte un IBAN valide, avec ou sans espaces', () => {
    expect(isValidIban('FR76 3000 6000 0112 3456 7890 189')).toBe(true);
    expect(isValidIban('fr7630006000011234567890189')).toBe(true);
    expect(isValidIban('DE89370400440532013000')).toBe(true);
  });
  test('refuse une clé de contrôle fausse ou un format inconnu', () => {
    expect(isValidIban('FR76 3000 6000 0112 3456 7890 188')).toBe(false);
    expect(isValidIban('1234')).toBe(false);
    expect(isValidIban('')).toBe(false);
  });
  test('formate par groupes de 4', () => {
    expect(formatIban('fr7630006000011234567890189')).toBe('FR76 3000 6000 0112 3456 7890 189');
  });
});

test.describe('validation par type', () => {
  test('virement : IBAN et titulaire obligatoires', () => {
    const d = emptyDraft('bank_transfer');
    expect(Object.keys(validateDraft(d)).sort()).toEqual(['beneficiary', 'value']);
    expect(validateDraft({ ...d, value: 'FR76 3000 6000 0112 3456 7890 189', beneficiary: 'Chloe Food' })).toEqual({});
  });
  test('autre : un nom est obligatoire', () => {
    expect(validateDraft(emptyDraft('other')).label).toBeTruthy();
    expect(validateDraft({ ...emptyDraft('other'), label: 'Revolut' })).toEqual({});
  });
  test('lien : https obligatoire, PayPal doit ressembler à PayPal', () => {
    expect(validateDraft({ ...emptyDraft('paypal'), link: 'paypal.me/x' }).link).toBeTruthy();
    expect(validateDraft({ ...emptyDraft('paypal'), link: 'https://revolut.me/x' }).link).toBeTruthy();
    expect(validateDraft({ ...emptyDraft('paypal'), link: 'https://www.paypal.me/chloefood' })).toEqual({});
    expect(validateDraft({ ...emptyDraft('other'), label: 'Revolut', link: 'https://revolut.me/x' })).toEqual({});
  });
  test('au moins un service', () => {
    expect(validateDraft({ ...emptyDraft('cash'), enabled_modules: [] }).enabled_modules).toBeTruthy();
  });
  test('Apple Pay : /card seulement par défaut', () => {
    expect(emptyDraft('apple_pay').enabled_modules).toEqual(['card']);
    expect(emptyDraft('paypal').enabled_modules).toEqual(['shop', 'card', 'event', 'rental']);
  });
});

test.describe('corps de requête', () => {
  test('n’envoie que les champs du type', () => {
    const body = draftToBody({ ...emptyDraft('cash'), value: 'x', link: 'https://a.b', beneficiary: 'y' });
    expect(body.value).toBeNull();
    expect(body.extra).toBeNull();
  });
  test('virement : IBAN formaté, BIC en majuscules, pas de lien', () => {
    const body = draftToBody({ ...emptyDraft('bank_transfer'), value: 'fr7630006000011234567890189', beneficiary: ' Chloe Food ', bic: 'agrifrpp', link: 'https://x.y' });
    expect(body.value).toBe('FR76 3000 6000 0112 3456 7890 189');
    expect(body.extra).toEqual({ beneficiary: 'Chloe Food', bic: 'AGRIFRPP' });
  });
  test('garde la valeur et le lien d’une ligne PayPal existante', () => {
    const m = row({ value: 'paiements@exemple.fr', extra: { link: 'https://paypal.me/x' }, label: 'PayPal' });
    const body = draftToBody(draftFromMethod(m));
    expect(body.value).toBe('paiements@exemple.fr');
    expect(body.extra).toEqual({ link: 'https://paypal.me/x' });
    expect(body.label).toBe('PayPal');
  });
  test('modules dans l’ordre canonique', () => {
    expect(draftToBody({ ...emptyDraft('cash'), enabled_modules: ['rental', 'shop'] }).enabled_modules).toEqual(['shop', 'rental']);
  });
  test('draftsEqual ignore les espaces sans effet', () => {
    const d = draftFromMethod(row({ label: 'PayPal' }));
    expect(draftsEqual(d, { ...d, label: 'PayPal ' })).toBe(true);
    expect(draftsEqual(d, { ...d, label: 'PayPal Pro' })).toBe(false);
  });
});

test.describe('résumé dans la liste', () => {
  test('IBAN masqué et titulaire', () => {
    expect(paymentMethodSummary(row({ method: 'bank_transfer', value: 'FR76 3000 6000 0112 3456 7890 189', extra: { beneficiary: 'Chloe Food' } })))
      .toBe('FR76 ···· 0189 · Chloe Food');
  });
  test('lien sans protocole, sinon valeur, sinon manquant', () => {
    expect(paymentMethodSummary(row({ extra: { link: 'https://www.paypal.me/chloefood' } }))).toBe('paypal.me/chloefood');
    expect(paymentMethodSummary(row({ value: 'a@b.fr' }))).toBe('a@b.fr');
    expect(paymentMethodSummary(row({}))).toBe('Lien de paiement manquant');
  });
});

test.describe('ordre', () => {
  test('moveItem déplace et borne', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
  test('planReorder n’écrit que les positions changées', () => {
    const current = [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }, { id: 'c', sort_order: 5 }];
    expect(planReorder(current, ['b', 'a', 'c'])).toEqual({ ok: true, updates: [{ id: 'b', sort_order: 0 }, { id: 'a', sort_order: 1 }, { id: 'c', sort_order: 2 }] });
    expect(planReorder(current, ['a', 'b', 'c'])).toEqual({ ok: true, updates: [{ id: 'c', sort_order: 2 }] });
  });
  test('planReorder refuse une liste incomplète, dupliquée ou étrangère', () => {
    const current = [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }];
    expect(planReorder(current, ['a']).ok).toBe(false);
    expect(planReorder(current, ['a', 'a']).ok).toBe(false);
    expect(planReorder(current, ['a', 'x']).ok).toBe(false);
    expect(planReorder(current, 'a,b').ok).toBe(false);
    expect(planReorder(current, ['a', 'b', 'x']).ok).toBe(false);
  });
});
