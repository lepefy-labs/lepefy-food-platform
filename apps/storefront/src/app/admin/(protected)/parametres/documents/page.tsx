import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getCurrentAdminAccessContext, canAdmin } from '@/lib/auth/adminRbac';
import { readOrderDocumentSettings } from '@/lib/orders/documents/settings';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { OrderDocumentsSettingsSection } from '../OrderDocumentsSettingsSection';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ParametresDocumentsPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const db = createServiceClient();
  const [settings, access] = await Promise.all([
    readOrderDocumentSettings(db, tenant.id),
    getCurrentAdminAccessContext(tenant.id),
  ]);
  const canManage = Boolean(access && canAdmin(access, 'tenant_settings.manage'));

  return (
    <SettingsPageShell sectionKey="documents" description="Formats et contenu des documents imprimés pour vos commandes.">
      <OrderDocumentsSettingsSection initial={settings.config} available={settings.available} invalid={settings.status === 'invalid'} canManage={canManage} />
    </SettingsPageShell>
  );
}
