/**
 * Module registry: which repository paths belong to which functional module.
 * A module is "documented" only through a reviewed document (docs/engineering/modules),
 * never because it appears here. The registry is versioned with the code and stored
 * per index run, so a module card always matches the indexed commit.
 */
import type { IndexedModule } from './domain';

const S = 'apps/storefront/src/';
const API = `${S}app/api/`;
const ADM = `${S}app/admin/(protected)/`;

export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] ?? '';
    if (char === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

export const ENGINEERING_MODULES: IndexedModule[] = [
  {
    moduleKey: 'auth-rbac', title: 'Auth e RBAC', category: 'Sicurezza', position: 10,
    summary: 'Accesso admin con Supabase Auth, ruoli e permessi dinamici, guardie delle API, invito admin e email di autenticazione per tenant.',
    pathGlobs: [`${S}lib/auth/**`, `${S}lib/authMailer/**`, `${S}lib/audit/**`, `${S}middleware.ts`, `${S}app/admin/login/**`, `${S}app/admin/accept-invite/**`,
      `${ADM}team/**`, `${ADM}securite/**`, `${ADM}activite/**`, `${API}admin/login/**`, `${API}admin/team/**`, `${API}admin/activite/**`, `${API}auth/**`,
      'docs/ADMIN_RBAC_PERMISSIONS.md', 'docs/AUTH_MAILER_MULTITENANT.md', 'docs/ADMIN_ACTIVITY_AUDIT.md',
      'supabase/migrations/039_*', 'supabase/migrations/085_*', 'supabase/migrations/086_*', 'supabase/migrations/087_*', 'supabase/migrations/153_*', 'supabase/migrations/173_*'],
  },
  {
    moduleKey: 'orders-preparation', title: 'Ordini e preparazione', category: 'Operazioni', position: 20,
    summary: 'Ordini, conversione delle sessioni di checkout, preparazione, chiusura, documenti PDF e portale QR.',
    pathGlobs: [`${S}lib/orders/**`, `${ADM}orders/**`, `${API}admin/orders/**`, `${API}admin/order-preparation/**`, `${API}admin/order-documents/**`,
      `${API}admin/assisted-orders/**`, `${API}admin/checkout-sessions/**`, `${API}order-portal/**`, `${API}webhooks/orders/**`,
      'docs/ORDER_*.md', 'docs/ASSISTED_ORDERS.md', 'supabase/migrations/128_*', 'supabase/migrations/160_*', 'supabase/migrations/161_*'],
  },
  {
    moduleKey: 'payments-stripe', title: 'Pagamenti e Stripe', category: 'Pagamenti', position: 30,
    summary: 'Checkout, PaymentIntent Stripe, webhook, pagamenti con carta e link di pagamento esterni.',
    pathGlobs: [`${S}lib/payments/**`, `${S}lib/checkout/**`, `${API}checkout/**`, `${API}checkout-sessions/**`, `${API}webhooks/stripe/**`, `${API}pay/**`,
      `${S}app/pay/**`, `${ADM}paiements-carte/**`, `${ADM}paiements-en-attente/**`, `${API}admin/card-payments/**`, `${API}admin/payment-methods/**`,
      'docs/CHECKOUT_RECOVERY_V2_ROLLOUT.md'],
  },
  {
    moduleKey: 'shipping-packlink', title: 'Spedizioni e Packlink', category: 'Logistica', position: 40,
    summary: 'Preventivi di spedizione, tariffe forfait, bozze di spedizione Packlink, tracking e shipping intelligence.',
    pathGlobs: [`${S}lib/shipping/**`, `${API}shipping/**`, `${API}admin/shipping-*/**`, `${API}admin/packlink-*/**`, `${API}internal/shipping-*/**`, `${ADM}livraison/**`,
      'docs/SHIPPING_*.md', 'supabase/migrations/124_*', 'supabase/migrations/151_*', 'supabase/migrations/159_*'],
  },
  {
    moduleKey: 'help-center', title: 'Help Center', category: 'Piattaforma', position: 50,
    summary: 'Guide contestuali per gli admin dei tenant, console editoriale della piattaforma, livelli commerciali.',
    pathGlobs: [`${S}lib/helpCenter/**`, `${S}app/admin/_components/help/**`, `${ADM}aide/**`, `${ADM}platform/knowledge/**`, `${API}admin/help/**`,
      `${API}admin/platform/knowledge/**`, 'docs/HELP_CENTER.md', 'supabase/migrations/174_*', 'supabase/tests/174_*'],
  },
  {
    moduleKey: 'assistance', title: 'Assistance', category: 'Piattaforma', position: 60,
    summary: 'Richieste e conversazioni fra negozio e Lepefy, ticket, allegati e notifiche di risposta.',
    pathGlobs: [`${S}lib/support/**`, `${S}app/admin/_components/support/**`, `${ADM}assistance/**`, `${ADM}platform/assistance/**`, `${API}admin/assistance/**`,
      `${API}admin/platform/assistance/**`, 'docs/SMART_ASSISTANCE.md', 'supabase/migrations/163_*', 'supabase/tests/163_*'],
  },
  {
    moduleKey: 'catalog-promotions', title: 'Catalogo e promozioni', category: 'Catalogo', position: 70,
    summary: 'Prodotti, categorie, regole di quantità minima, promozioni programmate, novità, petits plus e duplicazione prodotto.',
    pathGlobs: [`${S}lib/catalog/**`, `${S}lib/purchaseQuantityRules.ts`, `${S}lib/cart/**`, `${ADM}catalogue/**`, `${ADM}products/**`, `${API}admin/catalogue/**`,
      `${API}products/**`, `${API}quantity-groups/**`, `${API}cart/**`, `${API}internal/catalog-schedule/**`,
      'docs/PURCHASE_QUANTITY_RULES.md', 'docs/CATALOG_CAMPAIGNS.md', 'docs/CART_SYNC.md', 'supabase/migrations/121_*', 'supabase/migrations/156_*', 'supabase/migrations/165_*'],
  },
  {
    moduleKey: 'notifications', title: 'Notifiche', category: 'Comunicazione', position: 80,
    summary: 'Email ai clienti, destinatari interni, dispatcher staff (WhatsApp), ledger delle consegne e analytics Brevo.',
    pathGlobs: [`${S}lib/notifications/**`, `${API}admin/notification-recipients/**`, `${API}internal/notifications/**`, `${API}webhooks/brevo/**`,
      `${ADM}platform/notifications/**`, 'docs/NOTIFICATION_*.md', 'docs/STAFF_NOTIFICATIONS_RUNBOOK.md', 'docs/BREVO_EMAIL_ANALYTICS.md', 'docs/DAILY_ORDER_DIGEST.md',
      'supabase/migrations/143_*', 'supabase/migrations/158_*', 'supabase/migrations/170_*'],
  },
  {
    moduleKey: 'events', title: 'Événementiel', category: 'Servizi', position: 90,
    summary: 'Eventi, prenotazioni, catering, noleggi, biglietti e scansione sul posto.',
    pathGlobs: [`${S}lib/events/**`, `${S}lib/rental/**`, `${S}app/(evenementiel)/**`, `${ADM}evenementiel/**`, `${API}evenementiel/**`, `${API}events/**`,
      `${API}admin/evenementiel/**`, `${API}rental/**`, `${S}app/scan/**`, 'docs/EVENT_*.md'],
  },
  {
    moduleKey: 'gestion', title: 'Gestion du commerce', category: 'Operazioni', position: 100,
    summary: 'Fornitori, acquisti, giacenze, registro movimenti e tesoreria.',
    pathGlobs: [`${S}lib/gestion/**`, `${ADM}gestion/**`, `${API}admin/gestion/**`, 'docs/BUSINESS_MANAGEMENT.md', 'supabase/migrations/139_*', 'supabase/tests/139_*'],
  },
];

const COMPILED = ENGINEERING_MODULES.map((module) => ({
  moduleKey: module.moduleKey,
  patterns: module.pathGlobs.map(globToRegExp),
}));

/** First registered module whose globs match, or null (the file belongs to no documented module). */
export function moduleForPath(path: string): string | null {
  for (const entry of COMPILED) {
    if (entry.patterns.some((pattern) => pattern.test(path))) return entry.moduleKey;
  }
  return null;
}
