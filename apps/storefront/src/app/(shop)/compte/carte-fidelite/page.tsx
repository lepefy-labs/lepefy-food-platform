import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { getLoyaltySettings } from '@/lib/loyalty/loyaltyConfig';
import { renderBarcodeSVG, formatBarcodeDisplay } from '@/lib/barcode';
import { requireTermsConsentOrRedirect } from '@/lib/legal/requireTermsConsentOrRedirect';
import { getLoyaltyBrand } from '@/lib/loyalty/wallet/brand';
import { getWalletAvailability } from '@/lib/loyalty/wallet/config';
import { LoyaltyCardClient } from './LoyaltyCardClient';

// Session obligatoire — même garde que /compte/parrainage.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function CarteFideliteePage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) redirect('/compte/connexion');
  await requireTermsConsentOrRedirect(tenant.id, customer.id, '/compte/carte-fidelite');
  // La carte affiche un solde de points — sans programme actif pour ce
  // tenant, rien de pertinent à montrer (même principe que le bandeau points
  // conditionnel de AccountDashboard, cf. tenant.loyaltyEnabled).
  const loyalty = await getLoyaltySettings(createServiceClient(), tenant.id, tenant);
  if (!loyalty.enabled) redirect('/compte');

  const supabase = createServiceClient();

  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .select('loyalty_card_number')
    .eq('id', customer.id)
    .eq('tenant_id', tenant.id)
    .single();

  if (customerError) throw new Error('Unable to load loyalty card');

  const cardNumber = customerRow?.loyalty_card_number ?? null;

  const { data: balanceRow, error: balanceError } = await supabase
    .from('customer_points_balance')
    .select('confirmed_balance')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', customer.id)
    .maybeSingle();

  if (balanceError) throw new Error('Unable to load loyalty balance');

  // QR code — encode uniquement le numéro de carte (pas d'URL), scanné en
  // caisse par /admin/loyalty/scan. Même package `qrcode` déjà utilisé par
  // /api/card/qr-code.
  const qrSvg = cardNumber
    ? await QRCode.toString(cardNumber, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 4,
        color: { dark: '#000000', light: '#ffffff' },
      })
    : null;

  // Code-barres linéaire EAN-13 — réutilise renderBarcodeSVG (lib/barcode.ts,
  // déjà utilisée pour les produits) via import, sans dupliquer bwip-js.
  const barcodeSvg = cardNumber ? renderBarcodeSVG(cardNumber, { widthMm: 65 }) : null;

  return (
    <LoyaltyCardClient
      fullName={customer.full_name}
      cardNumber={cardNumber}
      cardNumberDisplay={cardNumber ? formatBarcodeDisplay(cardNumber) : null}
      confirmedBalance={balanceRow?.confirmed_balance ?? 0}
      qrSvg={qrSvg}
      barcodeSvg={barcodeSvg}
      brand={getLoyaltyBrand(tenant)}
      wallets={getWalletAvailability(tenant.slug, tenant.logo_url)}
    />
  );
}
