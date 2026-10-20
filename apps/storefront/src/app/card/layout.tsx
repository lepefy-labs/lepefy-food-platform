import type { Metadata } from 'next';
import { getDisplayTenant } from '@/lib/tenant/getTenant';
import { getDisplayTenantServiceState, isModuleAvailable } from '@/lib/billing/tenantServiceState';
import { ServiceSuspendedPage } from '@/components/billing/ServiceSuspendedPage';

export const metadata: Metadata = {
  title: 'Contact',
  robots: { index: false, follow: false },
};

export default async function CardLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getDisplayTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  if (!isModuleAvailable(await getDisplayTenantServiceState(tenant.id), 'digital_card')) {
    return <ServiceSuspendedPage tenantName={tenant.name} logoUrl={tenant.logo_url} />;
  }
  return <>{children}</>;
}
