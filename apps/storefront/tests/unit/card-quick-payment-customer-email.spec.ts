import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  androidAppState,
  tenantEmailHeroUrl,
  type TenantNotificationContext,
} from '../../src/lib/notifications/getTenantNotificationContext';
import { cardPaymentReference, cardQuickPaymentCustomerEmail } from '../../src/lib/notifications/customerEmails';
import { notifyCardQuickPaymentPaid, type PaidCardQuickPayment } from '../../src/lib/notifications/notifyCardQuickPayment';
import { sendWithLedger } from '../../src/lib/notifications/deliveryLedger';
import type { sendTenantEmail } from '../../src/lib/notifications/sendEmail';

const context: TenantNotificationContext = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  tenantSlug: 'boutique',
  tenantName: 'Chloé <Food>',
  storefrontUrl: 'https://shop.example',
  locale: 'fr-FR',
  currency: 'EUR',
  branding: { logoUrl: 'https://cdn.example/logo.png', primaryColor: '#1f7a3a', secondaryColor: '#ffb000', accentColor: '#fff' },
  emailBranding: { fromName: 'Chloé Food', fromEmail: 'noreply@lepefy.com', supportEmail: 'aide@shop.example', whatsappNumber: '+39 333 123 4567' },
  business: { city: 'Milano', country: 'IT', legalAddress: null },
  pickup: { address: null, mapsUrl: null, hours: null },
  commerce: { storefrontReady: true, clickCollectEnabled: true, showPoweredBy: true },
  mobileApp: { android: null },
};

const input = {
  quickPaymentId: 'a82f31c4-9d1e-4b2a-8c3f-000000000001',
  amount: 38,
  currency: 'eur',
  customerName: 'Marie',
  paidAt: '2026-09-28T16:42:00.000Z',
};

const euros = (value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);

test('confirmation: reassuring subject, amount, readable reference, never the Stripe id', () => {
  const email = cardQuickPaymentCustomerEmail(context, input);
  expect(email.subject).toBe(`✅ Votre paiement de ${euros(38)} chez Chloé <Food> est confirmé`);
  expect(email.html).toContain('✓ Paiement confirmé');
  expect(email.html).toContain(euros(38));
  expect(email.html).toContain('Bonjour <strong>Marie</strong>,');
  expect(cardPaymentReference(input.quickPaymentId)).toBe('CP-A82F31');
  expect(email.html).toContain('CP-A82F31');
  expect(email.html).toContain('28 septembre 2026 · 18:42');
  expect(email.html).toContain('✓ Payé');
  expect(email.html).not.toMatch(/pi_/);
  expect(email.html).not.toContain('cher client');
  expect(email.replyTo).toBe('aide@shop.example');
});

test('storefront CTA is absolute, brand-colored, and only promises configured options', () => {
  const email = cardQuickPaymentCustomerEmail(context, input);
  expect(email.html).toContain('href="https://shop.example"');
  expect(email.html).toContain('COMMANDER EN LIGNE →');
  expect(email.html).toContain('bgcolor="#1f7a3a"');
  expect(email.html).toContain('color:#ffffff;text-decoration:none');
  expect(email.html).toContain('Commande en ligne &nbsp;•&nbsp; Paiement sécurisé &nbsp;•&nbsp; Livraison &nbsp;•&nbsp; Retrait en boutique');
  expect(email.html).toContain('Vos produits préférés, aussi chez vous.');
  expect(email.html).toContain('Propulsé par');
  expect(email.html).not.toMatch(/utm_|coupon|newsletter|PWA/i);

  const noPickup = cardQuickPaymentCustomerEmail({ ...context, commerce: { storefrontReady: true, clickCollectEnabled: false, showPoweredBy: false } }, input);
  expect(noPickup.html).not.toContain('Retrait en boutique');
  expect(noPickup.html).not.toContain('Propulsé par');

  const light = cardQuickPaymentCustomerEmail({ ...context, branding: { ...context.branding, primaryColor: '#ffd84d' } }, input);
  expect(light.html).toContain('color:#111111;text-decoration:none');
});

test('tenant hero image leads to the storefront; missing or unsafe image keeps a branded fallback', () => {
  const withImage = cardQuickPaymentCustomerEmail({ ...context, branding: { ...context.branding, heroImageUrl: 'https://cdn.example/tenant-hero.jpg' } }, input);
  expect(withImage.html).toContain('<img src="https://cdn.example/tenant-hero.jpg"');
  expect(withImage.html).toContain('alt="Chloé &lt;Food&gt;"');
  expect(withImage.html).toContain('<a href="https://shop.example" style="display:block;text-decoration:none;"><img');
  const tenantSpecific = cardQuickPaymentCustomerEmail({ ...context, branding: { ...context.branding, heroImageUrl: 'https://cdn.example/storefront-hero.jpg', emailHeroImageUrl: 'https://shop.example/images/email/shop-art.png' } }, input);
  expect(tenantSpecific.html).toContain('<img src="https://shop.example/images/email/shop-art.png"');
  expect(tenantSpecific.html).not.toContain('storefront-hero.jpg');
  expect(tenantEmailHeroUrl('chloefood', 'https://shop.example')).toBe('https://shop.example/images/email/chloefood-shop-assortment.png');
  expect(tenantEmailHeroUrl('another-tenant', 'https://shop.example')).toBeNull();
  expect(tenantEmailHeroUrl('chloefood', null)).toBeNull();
  const withoutImage = cardQuickPaymentCustomerEmail(context, input);
  expect(withoutImage.html).not.toContain('tenant-hero.jpg');
  expect(withoutImage.html).toContain('bgcolor="#1f7a3a"');
  const unsafe = cardQuickPaymentCustomerEmail({ ...context, branding: { ...context.branding, heroImageUrl: 'javascript:alert(1)' } }, input);
  expect(unsafe.html).not.toContain('javascript:');
});

test('Italian tenant gets Italian receipt, shop and Android copy', () => {
  const it = cardQuickPaymentCustomerEmail({ ...context, locale: 'it-IT', mobileApp: { android: androidAppState('com.example.shop', false) } }, input);
  expect(it.subject).toContain('Il tuo pagamento di');
  expect(it.html).toContain('✓ Pagamento confermato');
  expect(it.html).toContain('I tuoi prodotti preferiti, anche a casa tua.');
  expect(it.html).toContain('ORDINA ONLINE →');
  expect(it.html).toContain('Presto disponibile su Google Play');
  expect(it.html).not.toContain('Bientôt disponible sur Google Play');
});

test('no storefront URL or shop not ready: no commercial block and no dead link', () => {
  for (const variant of [{ ...context, storefrontUrl: '' }, { ...context, commerce: { ...context.commerce!, storefrontReady: false } }]) {
    const email = cardQuickPaymentCustomerEmail(variant, input);
    expect(email.html).not.toContain('COMMANDER EN LIGNE');
    expect(email.html).not.toContain('Visiter notre boutique');
    expect(email.html).not.toMatch(/href="(?!https:\/\/|mailto:)/);
    expect(email.html).toContain('CP-A82F31');
  }
});

test('Android: public listing is a link, release in progress is plain text, no app is no block', () => {
  const live = androidAppState('com.example.shop', true);
  expect(live).toEqual({ status: 'available', playStoreUrl: 'https://play.google.com/store/apps/details?id=com.example.shop' });
  const liveEmail = cardQuickPaymentCustomerEmail({ ...context, mobileApp: { android: live } }, input);
  expect(liveEmail.html).toContain('href="https://play.google.com/store/apps/details?id=com.example.shop"');
  expect(liveEmail.html).toContain('Disponible sur Google Play');
  expect(liveEmail.html).not.toContain('badges/google-play-fr.png');

  const badgeEmail = cardQuickPaymentCustomerEmail({ ...context, assetBaseUrl: 'https://shop.example/', mobileApp: { android: live } }, input);
  expect(badgeEmail.html).toContain('<img src="https://shop.example/badges/google-play-fr.png"');
  expect(badgeEmail.html).toContain('alt="Disponible sur Google Play"');
  expect(badgeEmail.html).toContain('marques de Google LLC');
  expect(badgeEmail.html).toContain('href="https://play.google.com/store/apps/details?id=com.example.shop"');

  const soon = androidAppState('com.example.shop', false);
  expect(soon).toEqual({ status: 'coming_soon', playStoreUrl: null });
  const soonEmail = cardQuickPaymentCustomerEmail({ ...context, assetBaseUrl: 'https://shop.example', mobileApp: { android: soon } }, input);
  expect(soonEmail.html).not.toContain('<img src="https://shop.example/badges');
  expect(soonEmail.html).toContain('Bientôt disponible sur Google Play');
  expect(soonEmail.html).not.toContain('play.google.com');

  expect(androidAppState(null, true)).toBeNull();
  expect(androidAppState('not a package', true)).toBeNull();
  const none = cardQuickPaymentCustomerEmail(context, input);
  expect(none.html).not.toContain('Google Play');
  expect(none.html).not.toContain('Android');
});

test('name and tenant are escaped; no name falls back to a neutral greeting', () => {
  const email = cardQuickPaymentCustomerEmail(context, { ...input, customerName: '<img src=x onerror=alert(1)>' });
  expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(email.html).not.toContain('<img src=x');
  expect(email.html).toContain('Chloé &lt;Food&gt;');
  expect(email.html).not.toContain('Chloé <Food>');
  const anonymous = cardQuickPaymentCustomerEmail(context, { ...input, customerName: '  ' });
  expect(anonymous.html).toContain('<p>Bonjour,</p>');
});

// ─── Webhook side effects ────────────────────────────────────────────────────

const payment: PaidCardQuickPayment = {
  id: input.quickPaymentId, tenant_id: context.tenantId, amount: 38, currency: 'eur', customer_name: 'Marie', customer_email: 'marie@example.com',
};

type SendInput = Parameters<typeof sendTenantEmail>[0];

function recordingSend(options: { failCustomer?: boolean } = {}) {
  const calls: Array<SendInput & { rendered: { subject: string; html: string } }> = [];
  const send = (async (call: SendInput) => {
    calls.push({ ...call, rendered: call.render(context) });
    if (options.failCustomer && call.notificationType === 'card_quick_payment_customer') throw new Error('smtp down');
    return true;
  }) as typeof sendTenantEmail;
  return { send, calls };
}

test('customer email present: tenant alert unchanged, then customer confirmation with its own key', async () => {
  const { send, calls } = recordingSend();
  const result = await notifyCardQuickPaymentPaid({ payment, paymentIntentId: 'pi_123', paidAt: input.paidAt, tenantRecipients: ['equipe@shop.example'] }, send);
  expect(result).toEqual({ tenant: true, customer: true });
  expect(calls.map((c) => [c.notificationType, c.idempotencyKey, c.recipients])).toEqual([
    ['card_quick_payment', 'card-quick-payment:pi_123', ['equipe@shop.example']],
    ['card_quick_payment_customer', 'card-quick-payment-customer:pi_123', ['marie@example.com']],
  ]);
  expect(calls[0]!.rendered.subject).toContain('Paiement carte reçu');
  expect(calls[0]!.rendered.html).toContain('pi_123');
  expect(calls[1]!.rendered.html).toContain('CP-A82F31');
  expect(calls[1]!.rendered.html).not.toContain('pi_123');
});

test('no customer email: only the tenant alert is sent', async () => {
  const { send, calls } = recordingSend();
  const result = await notifyCardQuickPaymentPaid({ payment: { ...payment, customer_email: '  ' }, paymentIntentId: 'pi_123', paidAt: input.paidAt, tenantRecipients: ['equipe@shop.example'] }, send);
  expect(result).toEqual({ tenant: true, customer: 'skipped' });
  expect(calls.map((c) => c.notificationType)).toEqual(['card_quick_payment']);
});

test('customer email failure is isolated and never throws', async () => {
  const { send, calls } = recordingSend({ failCustomer: true });
  const result = await notifyCardQuickPaymentPaid({ payment, paymentIntentId: 'pi_123', paidAt: input.paidAt, tenantRecipients: ['equipe@shop.example'] }, send);
  expect(result).toEqual({ tenant: true, customer: false });
  expect(calls).toHaveLength(2);
});

test('Stripe retry: the delivery ledger sends each email once', async () => {
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    from: () => ({
      upsert: (row: Record<string, unknown>) => ({
        select: async () => {
          if (rows.some((r) => r.tenant_id === row.tenant_id && r.idempotency_key === row.idempotency_key)) return { data: [], error: null };
          const created = { id: `d${rows.length + 1}`, max_attempts: 5, ...row };
          rows.push(created);
          return { data: [created], error: null };
        },
      }),
      select: () => {
        const chain = { eq: () => chain, maybeSingle: async () => ({ data: { status: 'accepted' }, error: null }) };
        return chain;
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  } as unknown as SupabaseClient;
  const transported: string[] = [];
  const send = (async (call: SendInput) => {
    const rendered = call.render(context);
    return sendWithLedger('/webhook/send-email', { ...rendered, recipients: call.recipients }, {
      tenantId: call.tenantId, idempotencyKey: call.idempotencyKey, notificationType: call.notificationType,
    }, async () => { transported.push(call.idempotencyKey); return true; }, db);
  }) as typeof sendTenantEmail;

  const args = { payment, paymentIntentId: 'pi_retry', paidAt: input.paidAt, tenantRecipients: ['equipe@shop.example'] };
  await notifyCardQuickPaymentPaid(args, send);
  await notifyCardQuickPaymentPaid(args, send);
  expect(transported).toEqual(['card-quick-payment:pi_retry', 'card-quick-payment-customer:pi_retry']);
});
