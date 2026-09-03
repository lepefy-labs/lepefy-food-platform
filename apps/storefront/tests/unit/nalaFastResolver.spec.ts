import { test, expect } from '@playwright/test';
import { resolveNalaFastStoreInformation } from '../../src/lib/ai/nalaFastResolver';

const tenant = {
  click_collect_hours: 'Du lundi au samedi, de 09:00 à 19:00',
  click_collect_hours_it: 'Dal lunedì al sabato, dalle 09:00 alle 19:00',
  click_collect_address: '12 rue Exemple, Paris',
  whatsapp_number: '+33 1 23 45 67 89',
  chatbox_extra_context: 'Livraison locale. Nous sommes ouverts du lundi au samedi de 09:00 à 19:00. Retours sous conditions.',
};

test('Fast Resolver answers French opening-hours questions without inference', () => {
  expect(resolveNalaFastStoreInformation({
    message: 'vous ouvrez a quel heure', locale: 'fr', tenant,
  })).toEqual({
    subject: 'opening_hours',
    reply: 'Nos horaires sont : Du lundi au samedi, de 09:00 à 19:00',
  });
});

test('Fast Resolver prefers localized Italian hours', () => {
  expect(resolveNalaFastStoreInformation({
    message: 'A che ora aprite?', locale: 'it', tenant,
  })?.reply).toBe('I nostri orari sono: Dal lunedì al sabato, dalle 09:00 alle 19:00');
});

test('Fast Resolver handles authoritative address and WhatsApp fields', () => {
  expect(resolveNalaFastStoreInformation({
    message: 'Où se trouve la boutique ?', locale: 'fr', tenant,
  })?.subject).toBe('address');
  expect(resolveNalaFastStoreInformation({
    message: 'What is your WhatsApp number?', locale: 'en', tenant,
  })?.reply).toBe('You can contact us on WhatsApp at +33 1 23 45 67 89.');
});

test('Fast Resolver fails open to AI Core when intent or authoritative data is missing', () => {
  expect(resolveNalaFastStoreInformation({
    message: 'Avez-vous du manioc ?', locale: 'fr', tenant,
  })).toBeNull();
  expect(resolveNalaFastStoreInformation({
    message: 'Vous ouvrez à quelle heure ?', locale: 'fr',
    tenant: { ...tenant, click_collect_hours: null, click_collect_hours_it: null, chatbox_extra_context: null },
  })).toBeNull();
});

test('Fast Resolver can safely extract opening hours from curated tenant context as fallback', () => {
  expect(resolveNalaFastStoreInformation({
    message: 'quels sont vos horaires ?', locale: 'fr',
    tenant: { ...tenant, click_collect_hours: null, click_collect_hours_it: null },
  })?.reply).toBe('Nos horaires sont : Nous sommes ouverts du lundi au samedi de 09:00 à 19:00.');
});
