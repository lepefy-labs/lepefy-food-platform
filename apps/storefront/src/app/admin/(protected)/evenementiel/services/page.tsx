import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import ModuleSettingsToggle from '../ModuleSettingsToggle';
import ServicesListClient from './ServicesListClient';
import type { ServiceOffering } from '@lepefy/types';

export const dynamic = 'force-dynamic';

export default async function AdminServicesPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const { data: services } = await supabase
    .from('service_offerings')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: true });

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h1 className="text-xl font-semibold text-gray-900">Services</h1>
        <ModuleSettingsToggle field="services_enabled" label="Module services" initialValue={tenant.services_enabled} />
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Traiteur (devis) et location de matériel (catalogue payant) — chaque service ouvre sur
        sa propre page publique <code>/evenementiel/services/[slug]</code>.
      </p>

      <ServicesListClient initialServices={(services ?? []) as ServiceOffering[]} />
    </div>
  );
}
