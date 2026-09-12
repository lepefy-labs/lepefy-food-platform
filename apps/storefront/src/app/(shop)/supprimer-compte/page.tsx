import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { AccountDeletionClient } from './AccountDeletionClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export const metadata: Metadata = {
  title: 'Supprimer mon compte',
  description: 'Demander la suppression de votre compte client.',
};

export default async function SupprimerComptePage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const customer = await getSessionCustomer(tenant.id);

  return (
    <AccountDeletionClient
      tenantName={tenant.name}
      initialEmail={customer?.email ?? null}
      legalEmail={tenant.legal_email ?? null}
    />
  );
}
