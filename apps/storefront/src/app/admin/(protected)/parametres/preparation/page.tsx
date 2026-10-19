import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getCurrentAdminAccessContext, canAdmin } from '@/lib/auth/adminRbac';
import { readOrderPreparationSettings } from '@/lib/orders/preparation/settings';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { OrderPreparationSettingsSection } from '../OrderPreparationSettingsSection';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ParametresPreparationPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const db = createServiceClient();
  const [settings, access] = await Promise.all([
    readOrderPreparationSettings(db, tenant.id),
    getCurrentAdminAccessContext(tenant.id),
  ]);
  const canManage = Boolean(access && canAdmin(access, 'tenant_settings.manage'));

  return (
    <SettingsPageShell sectionKey="preparation" description="Choisissez comment votre équipe confirme la préparation et l’emballage des commandes.">
      <OrderPreparationSettingsSection initial={settings.config} available={settings.available} invalid={settings.status === 'invalid'} canManage={canManage} />
    </SettingsPageShell>
  );
}
