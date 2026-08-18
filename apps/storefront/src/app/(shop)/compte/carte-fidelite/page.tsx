import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { renderBarcodeSVG, formatBarcodeDisplay } from '@/lib/barcode';
import { requireTermsConsentOrRedirect } from '@/lib/legal/requireTermsConsentOrRedirect';
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
  if (!tenant.loyalty_enabled) redirect('/compte');

  const supabase = createServiceClient();

  const { data: customerRow } = await supabase
    .from('customers')
    .select('loyalty_card_number')
    .eq('id', customer.id)
    .eq('tenant_id', tenant.id)
    .single();

  const cardNumber = customerRow?.loyalty_card_number ?? null;

  const { data: balanceRow } = await supabase
    .from('customer_points_balance')
    .select('confirmed_balance')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', customer.id)
    .maybeSingle();

  // QR code — encode uniquement le numéro de carte (pas d'URL), scanné en
  // caisse par /admin/loyalty/scan. Même package `qrcode` déjà utilisé par
  // /api/card/qr-code.
  const qrSvg = cardNumber
    ? await QRCode.toString(cardNumber, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
        color: { dark: tenant.primary_color, light: '#ffffff' },
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
      tenantName={tenant.name}
    />
  );
}
