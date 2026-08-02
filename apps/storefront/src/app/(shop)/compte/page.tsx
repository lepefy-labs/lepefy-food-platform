import { redirect } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { getCustomerProfile } from '@/lib/customers/getCustomerProfile';
import { createServiceClient } from '@/lib/supabase/server';
import { renderBarcodeSVG, formatBarcodeDisplay } from '@/lib/barcode';
import { contrastRatio } from '@/lib/utils/color';
import type { Address } from '@lepefy/types';
import { AccountDashboard } from './AccountDashboard';

// Tableau de bord "Mon compte" — lit la session à chaque requête (comme
// connexion/page.tsx et parrainage/page.tsx), jamais statique/ISR.
export const dynamic = 'force-dynamic';

export default async function ComptePage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) redirect('/compte/connexion');

  const profile = await getCustomerProfile(customer.id, tenant.id);

  const supabase = createServiceClient();

  const { data: ambassadorRow } = await supabase
    .from('customers')
    .select('is_ambassador, ambassador_profile_completed_at')
    .eq('id', customer.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  const { data: addresses } = await supabase
    .from('addresses')
    .select('*')
    .eq('customer_id', customer.id)
    .eq('tenant_id', tenant.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  // Le solde de points et le numéro de carte ne sont interrogés que si le
  // programme est actif pour ce tenant — un tenant qui n'a pas activé
  // loyalty_enabled n'a pas de ledger pertinent à afficher (cf. rapport
  // final : aucun "niveau" fictif n'est affiché non plus, la notion n'existe
  // nulle part côté données réelles), et le widget tessera n'est pas rendu.
  let confirmedPoints = 0;
  let loyaltyCardNumberDisplay: string | null = null;
  let loyaltyCardBarcodeSvg: string | null = null;

  if (tenant.loyalty_enabled) {
    const [{ data: balance }, { data: customerCard }] = await Promise.all([
      supabase
        .from('customer_points_balance')
        .select('confirmed_balance')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', customer.id)
        .maybeSingle(),
      supabase
        .from('customers')
        .select('loyalty_card_number')
        .eq('id', customer.id)
        .eq('tenant_id', tenant.id)
        .maybeSingle(),
    ]);

    confirmedPoints = balance?.confirmed_balance ?? 0;

    // Réutilise renderBarcodeSVG (lib/barcode.ts) et formatBarcodeDisplay —
    // mêmes fonctions déjà utilisées par /compte/carte-fidelite, aucune
    // logique de rendu dupliquée. Le SVG est généré ici côté serveur (bwip-js
    // dépend de Node) puis passé en chaîne jusqu'au widget client.
    const cardNumber = customerCard?.loyalty_card_number ?? null;
    loyaltyCardNumberDisplay = cardNumber ? formatBarcodeDisplay(cardNumber) : null;
    loyaltyCardBarcodeSvg = cardNumber ? renderBarcodeSVG(cardNumber, { widthMm: 60 }) : null;
  }

  // Couleur de texte lisible sur le gradient de la tessera — même
  // raisonnement que CategoryBlock.tsx (contrastRatio contre blanc, repli sur
  // un texte sombre si le primary_color du tenant est trop clair). Calculé
  // ici (valeurs hex réelles disponibles côté serveur) et transmis déjà
  // résolu, pas de recalcul côté client.
  const loyaltyCardTextColor = contrastRatio(tenant.primary_color, '#ffffff') >= 4.5 ? '#ffffff' : '#1a1a1a';

  return (
    <AccountDashboard
      tenant={{
        name:             tenant.name,
        logoUrl:          tenant.logo_url,
        countriesServed:  tenant.countries_served,
        loyaltyEnabled:   tenant.loyalty_enabled,
        country:          tenant.country,
      }}
      email={customer.email}
      fullName={profile?.fullName ?? customer.full_name}
      phone={profile?.phone ?? null}
      confirmedPoints={confirmedPoints}
      addresses={(addresses ?? []) as Address[]}
      isAmbassador={ambassadorRow?.is_ambassador ?? false}
      ambassadorProfileCompleted={!!ambassadorRow?.ambassador_profile_completed_at}
      loyaltyCardNumberDisplay={loyaltyCardNumberDisplay}
      loyaltyCardBarcodeSvg={loyaltyCardBarcodeSvg}
      loyaltyCardTextColor={loyaltyCardTextColor}
    />
  );
}
