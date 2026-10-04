import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantServiceState, isModuleAvailable } from '@/lib/billing/tenantServiceState';
import { ServiceSuspendedPage } from '@/components/billing/ServiceSuspendedPage';

export const metadata: Metadata = {
  title: 'Contact',
  robots: { index: false, follow: false },
};

export default async function CardLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  if (!isModuleAvailable(await getTenantServiceState(tenant.id), 'digital_card')) {
    return <ServiceSuspendedPage tenantName={tenant.name} logoUrl={tenant.logo_url} />;
  }
  return <>{children}</>;
}
