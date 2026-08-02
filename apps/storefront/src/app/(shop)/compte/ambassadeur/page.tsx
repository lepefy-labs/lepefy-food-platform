import { redirect } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { resolveReferralDownline } from '@/lib/loyalty/resolveReferralDownline';
import { generateReferralCode } from '@/lib/loyalty/generateReferralCode';
import { AmbassadorClient } from './AmbassadorClient';

export const dynamic = 'force-dynamic';

interface InviteeRow {
  customerId: string;
  email: string;
  fullName: string | null;
  status: 'CONFIRMED' | 'PAID' | 'PENDING_THRESHOLD';
  commissionAmount: number;
}

export default async function AmbassadeurPage() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);
  const customer   = await getSessionCustomer(tenant.id);

  if (!customer) redirect('/compte/connexion');

  const supabase = createServiceClient();

  const { data: customerRow } = await supabase
    .from('customers')
    .select('is_ambassador, ambassador_first_name, ambassador_last_name, ambassador_payment_method, ambassador_iban, ambassador_paypal_email, ambassador_profile_completed_at')
    .eq('id', customer.id)
    .eq('tenant_id', tenant.id)
    .single();

  if (!customerRow?.is_ambassador) redirect('/compte');

  // Le lien /invite/[code] est le même que pour le parrainage classique — un
  // ambassadeur utilise le même mécanisme de code, voir 046 (rien de nouveau
  // côté referral_codes).
  const code = await generateReferralCode({
    tenantId: tenant.id,
    customerId: customer.id,
    fullName: customer.full_name,
    email: customer.email,
  });

  // Profondeur 1 uniquement : le programme ambassadeur ne concerne que les
  // clients invités DIRECTEMENT (pas de commission multi-niveaux comme le
  // parrainage par points).
  const downline = await resolveReferralDownline(tenant.id, customer.id, 1);
  const directInvitees = downline.filter((n) => n.level === 1);

  const { data: commissions } = await supabase
    .from('ambassador_commissions')
    .select('referred_customer_id, commission_amount, status')
    .eq('tenant_id', tenant.id)
    .eq('ambassador_customer_id', customer.id);

  const commissionByReferred = new Map(
    (commissions ?? []).map((c) => [c.referred_customer_id as string, c]),
  );

  let invitees: InviteeRow[] = [];
  if (directInvitees.length > 0) {
    const { data: inviteeCustomers } = await supabase
      .from('customers')
      .select('id, email, full_name')
      .in('id', directInvitees.map((n) => n.customerId));

    invitees = (inviteeCustomers ?? []).map((c) => {
      const commission = commissionByReferred.get(c.id);
      return {
        customerId: c.id,
        email: c.email,
        fullName: c.full_name,
        status: commission ? (commission.status as 'CONFIRMED' | 'PAID') : 'PENDING_THRESHOLD',
        commissionAmount: commission ? Number(commission.commission_amount) : 0,
      };
    });
  }

  const confirmedBalance = (commissions ?? [])
    .filter((c) => c.status === 'CONFIRMED')
    .reduce((sum, c) => sum + Number(c.commission_amount), 0);
  const paidTotal = (commissions ?? [])
    .filter((c) => c.status === 'PAID')
    .reduce((sum, c) => sum + Number(c.commission_amount), 0);

  return (
    <AmbassadorClient
      code={code}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ''}
      currency={tenant.currency}
      profile={{
        firstName: customerRow.ambassador_first_name,
        lastName: customerRow.ambassador_last_name,
        paymentMethod: customerRow.ambassador_payment_method,
        iban: customerRow.ambassador_iban,
        paypalEmail: customerRow.ambassador_paypal_email,
        completedAt: customerRow.ambassador_profile_completed_at,
      }}
      confirmedBalance={confirmedBalance}
      paidTotal={paidTotal}
      invitees={invitees}
    />
  );
}
