import { test, expect } from '@playwright/test';
import {
  campaignChannelLabel, campaignRecipientStatusLabel, consentSourceLabel, customerSourceLabel, parseCustomerSort, pointTypeLabel,
} from '../../src/lib/admin/crmLabels';
import { buildWhatsAppShareUrl } from '../../src/lib/orders/assisted/assistedOrderPolicy';

test('raw CRM values are translated; unknown values stay as received', () => {
  expect(customerSourceLabel('guest_checkout')).toBe('Commande invité');
  expect(consentSourceLabel('checkout')).toBe('Paiement en ligne');
  expect(pointTypeLabel('IN_STORE_PURCHASE_EARNED')).toBe('Achat en boutique');
  expect(campaignRecipientStatusLabel('opened')).toBe('Ouverte');
  expect(campaignChannelLabel('whatsapp')).toBe('WhatsApp');
  expect(pointTypeLabel('FUTURE_TYPE')).toBe('FUTURE_TYPE');
  expect(customerSourceLabel(null)).toBe('—');
});

test('customer list sort from the query string', () => {
  expect(parseCustomerSort(undefined)).toEqual({ sort: 'last_activity', direction: 'desc' });
  expect(parseCustomerSort('spent')).toEqual({ sort: 'spent', direction: 'desc' });
  expect(parseCustomerSort('name')).toEqual({ sort: 'name', direction: 'asc' });
  expect(parseCustomerSort('drop')).toEqual({ sort: 'last_activity', direction: 'desc' });
});

test('WhatsApp link targets international numbers only', () => {
  expect(buildWhatsAppShareUrl('0032471312994', '')).toBe('https://wa.me/32471312994?text=');
  expect(buildWhatsAppShareUrl('+39 333 123 4567', '')).toBe('https://wa.me/393331234567?text=');
  expect(buildWhatsAppShareUrl('333 123 4567', '')).toBe('https://wa.me/?text=');
});
