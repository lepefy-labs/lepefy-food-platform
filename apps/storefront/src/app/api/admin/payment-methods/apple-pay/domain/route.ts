import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import { resolveApplePayDomain } from '@/lib/payments/applePay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Enregistrement self-serve du domaine du tenant pour Apple Pay (Stripe
// payment method domains), sur le compte Stripe du module `card`
// (STRIPE_SECRET_KEY_CARD, repli STRIPE_SECRET_KEY). Enregistrer le domaine
// en live l'enregistre aussi automatiquement côté sandbox/test chez Stripe.
// Le domaine vient toujours des données du tenant (storefront_url, repli
// NEXT_PUBLIC_APP_URL), jamais d'une valeur par défaut.

interface DomainStatus {
  domain: string;
  registered: boolean | null;
  enabled: boolean | null;
  applePayStatus: string | null;
  applePayError: string | null;
  error?: string;
}

function toStatus(domain: string, pmd: Stripe.PaymentMethodDomain | undefined): DomainStatus {
  return {
    domain,
    registered: Boolean(pmd),
    enabled: pmd ? pmd.enabled : null,
    applePayStatus: pmd?.apple_pay?.status ?? null,
    applePayError: pmd?.apple_pay?.status_details?.error_message ?? null,
  };
}

function stripeMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `Stripe : ${message}`;
}

async function resolveContext() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return { denied } as const;

  const domain = resolveApplePayDomain(tenant.storefront_url, process.env.NEXT_PUBLIC_APP_URL);
  if (!domain) {
    return {
      denied: NextResponse.json(
        { error: 'Aucun domaine configuré pour ce tenant (URL de la boutique manquante). Renseignez-la avant d’enregistrer Apple Pay.' },
        { status: 422 },
      ),
    } as const;
  }
  return { domain } as const;
}

async function findDomain(stripe: Stripe, domain: string): Promise<Stripe.PaymentMethodDomain | undefined> {
  const list = await stripe.paymentMethodDomains.list({ domain_name: domain, limit: 1 });
  return list.data[0];
}

export async function GET() {
  const ctx = await resolveContext();
  if ('denied' in ctx) return ctx.denied;

  try {
    const stripe = getStripeClient('card');
    return NextResponse.json(toStatus(ctx.domain, await findDomain(stripe, ctx.domain)));
  } catch (err) {
    console.error('[apple-pay/domain][GET] stripe error:', err instanceof Error ? err.message : err);
    const status: DomainStatus = { domain: ctx.domain, registered: null, enabled: null, applePayStatus: null, applePayError: null, error: stripeMessage(err) };
    return NextResponse.json(status);
  }
}

// Idempotent : domaine existant = succès (réactivé s'il était désactivé),
// sinon création ; puis validation pour rafraîchir le statut Apple Pay.
export async function POST() {
  const ctx = await resolveContext();
  if ('denied' in ctx) return ctx.denied;

  try {
    const stripe = getStripeClient('card');
    let pmd = await findDomain(stripe, ctx.domain);

    if (!pmd) {
      pmd = await stripe.paymentMethodDomains.create({ domain_name: ctx.domain });
      console.info('[apple-pay/domain] domain created:', ctx.domain, pmd.id);
    } else if (!pmd.enabled) {
      pmd = await stripe.paymentMethodDomains.update(pmd.id, { enabled: true });
      console.info('[apple-pay/domain] domain re-enabled:', ctx.domain, pmd.id);
    }

    pmd = await stripe.paymentMethodDomains.validate(pmd.id);
    return NextResponse.json(toStatus(ctx.domain, pmd));
  } catch (err) {
    console.error('[apple-pay/domain][POST] stripe error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: stripeMessage(err) }, { status: 502 });
  }
}
