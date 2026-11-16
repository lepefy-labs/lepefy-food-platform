import { test, expect } from '@playwright/test';
import { parseCreate, parseUpdate } from '../../src/lib/payments/paymentMethodWrite';

test.describe('création', () => {
  test('type inconnu refusé (plus de repli silencieux sur « Autre »)', () => {
    expect(parseCreate({ method: 'bitcoin' }, [])).toMatchObject({ ok: false, status: 400 });
  });
  test('carte et Apple Pay : une seule fois', () => {
    expect(parseCreate({ method: 'card', active: true }, ['card'])).toMatchObject({ ok: false, status: 409 });
    expect(parseCreate({ method: 'paypal', active: true }, ['paypal']).ok).toBe(true);
  });
  test('types sans détails : value et extra toujours vides', () => {
    const r = parseCreate({ method: 'cash', value: 'x', extra: { link: 'https://a.b' }, active: true }, []);
    expect(r).toMatchObject({ ok: true, values: { value: null, extra: null } });
  });
  test('modules : défaut du registre, liste validée', () => {
    expect(parseCreate({ method: 'apple_pay', active: true }, [])).toMatchObject({ ok: true, values: { enabled_modules: ['card'] } });
    expect(parseCreate({ method: 'paypal', active: true }, [])).toMatchObject({ ok: true, values: { enabled_modules: ['shop', 'card', 'event', 'rental'] } });
    expect(parseCreate({ method: 'paypal', enabled_modules: [] }, [])).toMatchObject({ ok: false, status: 400 });
    expect(parseCreate({ method: 'paypal', enabled_modules: ['shop', 'pos'] }, [])).toMatchObject({ ok: false, status: 400 });
  });
  test('extra : seulement link / beneficiary / bic, vides retirés, lien en https', () => {
    const r = parseCreate({ method: 'bank_transfer', value: ' FR76 ', extra: { beneficiary: ' Chloe ', bic: '', link: '', foo: 'bar' }, active: true }, []);
    expect(r).toMatchObject({ ok: true, values: { value: 'FR76', extra: { beneficiary: 'Chloe' } } });
    expect(parseCreate({ method: 'paypal', extra: { link: 'http://paypal.me/x' } }, [])).toMatchObject({ ok: false, status: 400 });
    expect(parseCreate({ method: 'paypal', extra: { link: 'javascript:alert(1)' } }, [])).toMatchObject({ ok: false, status: 400 });
  });
});

test.describe('modification', () => {
  test('le type ne change pas', () => {
    expect(parseUpdate({ method: 'cash' }, { method: 'paypal' })).toMatchObject({ ok: false, status: 409 });
    expect(parseUpdate({ method: 'paypal', label: 'PayPal' }, { method: 'paypal' }).ok).toBe(true);
  });
  test('le type enregistré décide des champs, même sans method dans la requête', () => {
    expect(parseUpdate({ value: 'x', extra: { link: 'https://a.b' } }, { method: 'cash' })).toEqual({ ok: true, values: { value: null, extra: null } });
  });
  test('seuls les champs présents sont écrits', () => {
    expect(parseUpdate({ active: false }, { method: 'paypal' })).toEqual({ ok: true, values: { active: false } });
    expect(parseUpdate({ enabled_modules: ['card'] }, { method: 'paypal' })).toEqual({ ok: true, values: { enabled_modules: ['card'] } });
    expect(parseUpdate({ enabled_modules: [] }, { method: 'paypal' })).toMatchObject({ ok: false, status: 400 });
  });
});
