import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { hasValidTermsConsent } from '@/lib/legal/hasValidTermsConsent';
import { createServiceClient } from '@/lib/supabase/server';
import { getLoyaltySettings } from '@/lib/loyalty/loyaltyConfig';
import { getLoyaltyBrand } from '@/lib/loyalty/wallet/brand';
import { getWalletConfig, getWalletAvailability } from '@/lib/loyalty/wallet/config';
import { issueGoogleWallet, type WalletCard } from '@/lib/loyalty/wallet/google';
import { issueAppleWallet } from '@/lib/loyalty/wallet/apple';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
function failure(status: number, message: string) {
  return NextResponse.json({ message }, { status, headers });
}

export async function GET(_request: Request, { params }: { params: { provider: string } }) {
  if (params.provider !== 'google' && params.provider !== 'apple') return failure(404, 'Wallet inconnu.');
  try {
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const customer = await getSessionCustomer(tenant.id);
    if (!customer) return failure(401, 'Connectez-vous à votre compte pour ajouter votre carte.');
    const loyalty = await getLoyaltySettings(createServiceClient(), tenant.id);
    if (!loyalty.enabled) return failure(404, 'Le programme fidélité est indisponible.');
    if (!await hasValidTermsConsent(tenant.id, customer.id)) {
      return failure(403, 'Acceptez les conditions dans votre compte avant d’ajouter la carte.');
    }
    const config = getWalletConfig(tenant.slug);
    const availability = getWalletAvailability(tenant.slug, tenant.logo_url);
    if (!availability[params.provider]) return failure(503, 'Ce Wallet n’est pas encore disponible.');
    const supabase = createServiceClient();
    const [member, points] = await Promise.all([
      supabase.from('customers').select('loyalty_card_number, full_name')
        .eq('tenant_id', tenant.id).eq('id', customer.id).single(),
      supabase.from('customer_points_balance').select('confirmed_balance')
        .eq('tenant_id', tenant.id).eq('customer_id', customer.id).maybeSingle(),
    ]);
    if (member.error || points.error) throw new Error('Wallet card lookup failed');
    const number = member.data?.loyalty_card_number;
    if (!number) return failure(409, 'Votre carte est en cours de génération. Réessayez dans un instant.');
    const appUrl = tenant.storefront_url || process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl || new URL(appUrl).protocol !== 'https:') throw new Error('Canonical HTTPS storefront URL required');
    const card: WalletCard = {
      tenantId: tenant.id, tenantSlug: tenant.slug, customerId: customer.id, cardNumber: number,
      fullName: member.data.full_name, balance: points.data?.confirmed_balance ?? 0,
      brand: getLoyaltyBrand(tenant), accountUrl: new URL('/compte/carte-fidelite', appUrl).href,
    };
    if (params.provider === 'google' && config.google) {
      const url = await issueGoogleWallet(card, config.google);
      return NextResponse.json({ url }, { headers });
    }
    if (config.apple) {
      const pass = await issueAppleWallet(card, config.apple);
      return new NextResponse(new Uint8Array(pass), {
        headers: { ...headers, 'Content-Type': 'application/vnd.apple.pkpass',
          'Content-Disposition': 'attachment; filename="carte-fidelite.pkpass"' },
      });
    }
    return failure(503, 'Ce Wallet n’est pas encore disponible.');
  } catch {
    // Never log payloads, save URLs, customer identifiers or signing secrets.
    console.error('[loyalty-wallet] Pass issuance failed');
    return failure(502, 'Impossible de préparer la carte. Réessayez dans un instant.');
  }
}
