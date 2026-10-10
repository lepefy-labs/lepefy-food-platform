import Image from 'next/image';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { SettingsHub } from './_components/SettingsHub';
import { loadSettingsStatuses } from './_components/loadSettingsData';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ParametresPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const statuses = await loadSettingsStatuses(tenant);

  const tenantContext = (
    <div className="flex min-w-[200px] items-center gap-3 rounded-2xl border border-a-border bg-a-surface px-3.5 py-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-a-border bg-a-surface-2">
        {tenant.logo_url ? (
          <Image src={tenant.logo_url} alt="" width={40} height={40} className="h-full w-full object-contain" />
        ) : (
          <span className="text-xs font-semibold text-a-text-3">{tenant.name.slice(0, 2).toUpperCase()}</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-a-text">{tenant.name}</p>
        <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${tenant.active ? 'text-tone-success-fg' : 'text-a-text-3'}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tenant.active ? 'bg-tone-success-solid' : 'bg-tone-neutral-solid'}`} />
          {tenant.active ? 'Boutique active' : 'Boutique inactive'}
        </p>
      </div>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Paramètres"
        description="Gérez votre boutique, vos services et vos intégrations."
        actions={tenantContext}
      />
      <SettingsHub statuses={statuses} />
    </div>
  );
}
