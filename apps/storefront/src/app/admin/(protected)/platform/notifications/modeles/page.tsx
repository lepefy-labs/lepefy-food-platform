import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { buildTemplatePreviews } from '@/lib/notifications/templateCatalog';
import TemplatePreviewBrowser from './TemplatePreviewBrowser';

export const dynamic = 'force-dynamic';

// Platform-owner access is enforced by app/admin/(protected)/platform/layout.tsx.
export default async function PlatformNotificationTemplatesPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const context = await getTenantNotificationContext(tenant.id);
  if (!context) {
    return <p className="rounded-xl border border-tone-danger-border bg-tone-danger-bg p-4 text-sm text-tone-danger-fg">Contexte de notification du tenant indisponible.</p>;
  }
  return <TemplatePreviewBrowser previews={buildTemplatePreviews(context)} tenantName={context.tenantName} />;
}
