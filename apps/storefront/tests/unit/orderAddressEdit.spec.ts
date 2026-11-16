import { test, expect } from '@playwright/test';
import {
  ADMIN_HOUSE_NUMBER_MESSAGE,
  addressEditBlocker,
  buildEditedShippingAddress,
  providerDraftKeepsOldAddress,
  type AddressEditOrderFacts,
} from '../../src/lib/orders/address/orderAddressEdit';
import { ADDRESS_COPY } from '../../src/lib/storefrontCopy/addressCopy';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

const current = {
  full_name: 'Rosah alexandra Assen',
  line1: 'Via felice mendelsohnn Alexandra rosah Assen',
  postal_code: '35132',
  city: 'Padova',
  country: 'IT',
  phone: '+393500000000',
};

const order: AddressEditOrderFacts = {
  status: 'preparing',
  fulfillment_type: 'delivery',
  tracking_code: null,
  shipping_provider_reference: 'IT2026PRO0000000001',
  shipping_creation_status: 'draft_created',
  shipping_address: current,
};

const corrected = { ...current, line1: 'Via Felice Mendelssohn 12', line2: 'Scala B', phone: '' };

test.describe('correction de l’adresse d’une commande (admin)', () => {
  test('modifiable tant que l’étiquette n’est pas achetée', () => {
    expect(addressEditBlocker(order)).toBeNull();
    expect(addressEditBlocker({ ...order, shipping_provider_reference: null, shipping_creation_status: null })).toBeNull();
    expect(addressEditBlocker({ ...order, tracking_code: '1UW1YZT0000' })).toBe('label_purchased');
    expect(addressEditBlocker({ ...order, status: 'shipped' })).toBe('shipped');
    expect(addressEditBlocker({ ...order, status: 'delivered' })).toBe('closed');
    expect(addressEditBlocker({ ...order, status: 'cancelled' })).toBe('closed');
    expect(addressEditBlocker({ ...order, fulfillment_type: 'pickup' })).toBe('not_delivery');
    expect(addressEditBlocker({ ...order, shipping_creation_status: 'creating' })).toBe('draft_in_progress');
    expect(addressEditBlocker({ ...order, shipping_address: null })).toBe('no_address');
  });

  test('brouillon non acheté : il garde l’ancienne adresse', () => {
    expect(providerDraftKeepsOldAddress(order)).toBe(true);
    expect(providerDraftKeepsOldAddress({ ...order, shipping_provider_reference: null })).toBe(false);
    expect(providerDraftKeepsOldAddress({ ...order, tracking_code: '1UW1YZT0000' })).toBe(false);
  });

  test('adresse corrigée : champs nettoyés, téléphone vide = ancien gardé', () => {
    const result = buildEditedShippingAddress(current, corrected);
    expect(result).toEqual({
      ok: true,
      address: {
        full_name: 'Rosah alexandra Assen', line1: 'Via Felice Mendelssohn 12', line2: 'Scala B',
        city: 'Padova', postal_code: '35132', country: 'IT', phone: '+393500000000',
      },
      changedFields: ['line1', 'line2'],
      postalCodeChanged: false,
    });
  });

  test('téléphone saisi : normalisé en E.164', () => {
    const result = buildEditedShippingAddress(current, { ...corrected, phone: '351 234 5678' });
    expect(result.ok && result.address.phone).toBe('+393512345678');
    expect(buildEditedShippingAddress(current, { ...corrected, phone: '12' })).toMatchObject({ ok: false, field: 'phone' });
  });

  test('refus : nom dans la rue, numéro absent ou sans chiffre, autre pays', () => {
    expect(buildEditedShippingAddress(current, { ...current })).toEqual({ ok: false, field: 'line1', error: ADDRESS_COPY.streetHasName });
    expect(buildEditedShippingAddress(current, { ...corrected, line1: 'Via Felice Mendelssohn' }))
      .toEqual({ ok: false, field: 'line1', error: ADMIN_HOUSE_NUMBER_MESSAGE });
    expect(buildEditedShippingAddress(current, { ...corrected, line1: 'Via Felice Mendelssohn bis' }))
      .toEqual({ ok: false, field: 'line1', error: ADMIN_HOUSE_NUMBER_MESSAGE });
    expect(buildEditedShippingAddress(current, { ...corrected, line1: 'Via Felice Mendelssohn s.n.' })).toMatchObject({ ok: true });
    expect(buildEditedShippingAddress(current, { ...corrected, country: 'FR', postal_code: '75011' })).toMatchObject({ ok: false, field: 'country' });
    expect(buildEditedShippingAddress(current, { ...corrected, postal_code: '3513' })).toMatchObject({ ok: false, field: 'postal_code' });
  });

  test('code postal changé : signalé (le prix n’est pas recalculé)', () => {
    const result = buildEditedShippingAddress(current, { ...corrected, postal_code: '35131' });
    expect(result.ok && result.postalCodeChanged).toBe(true);
  });

  test('route protégée par orders.manage', () => {
    expect(permissionForAdminApi('/api/admin/orders/00000000-0000-0000-0000-000000000000/address', 'POST')).toBe('orders.manage');
  });
});
