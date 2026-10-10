import { getTenant } from '@/lib/tenant/getTenant';
import PlatformSectionTabs from '../../../_components/PlatformSectionTabs';

// Technical shipping tools (Packlink simulations and diagnostics), reserved to
// the platform owner. They act on the tenant of this deployment.
export default async function PlatformLivraisonLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-10">
      <header>
        <h1 className="text-2xl font-semibold text-a-text">Livraison technique</h1>
        <p className="mt-1 text-sm text-a-text-3">
          Simulations Packlink et diagnostics du provider. Tenant interrogé : <span className="font-semibold text-a-text-2">{tenant.name}</span>.
        </p>
        <PlatformSectionTabs groupId="shipping" />
      </header>
      {children}
    </div>
  );
}
