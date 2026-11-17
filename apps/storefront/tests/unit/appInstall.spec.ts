import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { TenantNotificationContext } from '../../src/lib/notifications/getTenantNotificationContext';
import { orderCompletedEmail, orderConfirmedEmail, orderCancelledEmail } from '../../src/lib/notifications/customerEmails';
import {
  APP_EVENTS, APP_SOURCES, appInstallUrl, appSourceFromParam, detectInstallContext,
} from '../../src/lib/pwa/appInstall';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneGmail: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GSA/340.0.0',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0',
  ipadOs: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

test.describe('detectInstallContext', () => {
  test('déjà ouverte depuis l’icône, quel que soit l’appareil', () => {
    expect(detectInstallContext(UA.iphoneSafari, true)).toBe('installed');
  });
  test('Safari iPhone et iPadOS (Mac tactile) → geste Partager', () => {
    expect(detectInstallContext(UA.iphoneSafari, false)).toBe('ios');
    expect(detectInstallContext(UA.ipadOs, false, 5)).toBe('ios');
    expect(detectInstallContext(UA.ipadOs, false, 0)).toBe('desktop');
  });
  test('navigateurs intégrés (Gmail, Instagram, WebView Android) → ouvrir dans le navigateur', () => {
    expect(detectInstallContext(UA.iphoneGmail, false)).toBe('in_app_browser');
    expect(detectInstallContext(UA.iphoneInstagram, false)).toBe('in_app_browser');
    expect(detectInstallContext(UA.androidWebView, false)).toBe('in_app_browser');
  });
  test('Chrome Android et ordinateur', () => {
    expect(detectInstallContext(UA.androidChrome, false)).toBe('android');
    expect(detectInstallContext(UA.windowsChrome, false)).toBe('desktop');
  });
});

test.describe('sources et liens', () => {
  test('?src= inconnu ou absent = direct', () => {
    expect(appSourceFromParam('email_completed')).toBe('email_completed');
    expect(appSourceFromParam('newsletter')).toBe('direct');
    expect(appSourceFromParam(null)).toBe('direct');
  });
  test('lien absolu vers /app, jamais depuis une URL non http(s)', () => {
    expect(appInstallUrl('https://shop.example/', 'email_confirmed')).toBe('https://shop.example/app?src=email_confirmed');
    expect(appInstallUrl('javascript:alert(1)', 'email_confirmed')).toBeNull();
    expect(appInstallUrl('', 'email_completed')).toBeNull();
  });
  test('événements et sources identiques à la migration 186', () => {
    const sql = readFileSync(path.join(__dirname, '../../../../supabase/migrations/186_storefront_app_counts.sql'), 'utf8');
    for (const value of [...APP_EVENTS, ...APP_SOURCES]) expect(sql, value).toContain(`'${value}'`);
  });
});

test.describe('e-mails commande', () => {
  const context = {
    tenantId: '11111111-1111-4111-8111-111111111111', tenantSlug: 'chloefood', tenantName: 'Chloé Food',
    storefrontUrl: 'https://shop.example', locale: 'fr-FR', currency: 'EUR',
    branding: { logoUrl: null, primaryColor: '#8a2be2', secondaryColor: '#ffb000', accentColor: '#fff' },
    emailBranding: { fromName: 'Chloé Food', fromEmail: 'noreply@lepefy.com', supportEmail: 'aide@shop.example', whatsappNumber: null },
    business: { city: 'Milano', country: 'IT', legalAddress: null },
    pickup: { address: null, mapsUrl: null, hours: null },
  } satisfies TenantNotificationContext;
  const order = { orderNumber: '#ABCD1234', fullName: 'Awa', orderTrackingLink: 'https://shop.example/orders/1?token=t' };
  const ctaHrefs = (html: string) => [...html.matchAll(/class="cta" href="([^"]+)"/g)].map((m) => m[1]);

  test('commande terminée : l’installation est le seul bouton, « Voir ma commande » devient un lien', () => {
    for (const completionType of ['delivered', 'picked_up'] as const) {
      const { html } = orderCompletedEmail(context, { ...order, completionType });
      expect(ctaHrefs(html)).toEqual(['https://shop.example/app?src=email_completed']);
      expect(html).toContain('class="secondary-link" href="https://shop.example/orders/1?token=t">Voir ma commande');
    }
  });

  test('commande terminée sans URL boutique valable : retour au bouton « Voir ma commande »', () => {
    const { html } = orderCompletedEmail({ ...context, storefrontUrl: '' }, { ...order, completionType: 'delivered' });
    expect(ctaHrefs(html)).toEqual(['https://shop.example/orders/1?token=t']);
    expect(html).not.toContain('/app?src=');
  });

  test('commande confirmée : « Voir ma commande » reste le bouton, l’app est une astuce', () => {
    const { html } = orderConfirmedEmail(context, { ...order, fulfillmentType: 'pickup', total: 20, shippingTotal: 0, shippingAddress: null });
    expect(ctaHrefs(html)).toEqual(['https://shop.example/orders/1?token=t']);
    expect(html).toContain('class="app-tip"');
    expect(html).toContain('href="https://shop.example/app?src=email_confirmed"');
  });

  test('aucune invitation dans l’e-mail d’annulation', () => {
    expect(orderCancelledEmail(context, order).html).not.toContain('/app?src=');
  });
});
