import { getTenant } from '@/lib/tenant/getTenant';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { TenantFieldsForm } from '../_components/TenantFieldsForm';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ParametresBoutiquePage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return (
    <SettingsPageShell sectionKey="boutique">
      <TenantFieldsForm
        id="profil"
        title="Informations publiques"
        description={<>Affichées à vos clients sous le nom <strong className="font-semibold text-gray-700 dark:text-gray-200">{tenant.name}</strong>.</>}
        initialValues={{ tagline: tenant.tagline, storefront_url: tenant.storefront_url, whatsapp_number: tenant.whatsapp_number }}
        fields={[
          { name: 'tagline', label: 'Slogan', placeholder: 'ex : Les saveurs de chez nous', wide: true },
          { name: 'storefront_url', label: 'URL de la boutique', type: 'url', placeholder: 'https://shop.exemple.com', wide: true, hint: 'URL HTTPS publique utilisée dans les emails, les liens de suivi et les outils de la plateforme.' },
          { name: 'whatsapp_number', label: 'WhatsApp', type: 'tel', autoComplete: 'tel', placeholder: 'ex : 393331234567', hint: 'Format international, sans espaces ni symboles.' },
        ]}
      />
    </SettingsPageShell>
  );
}
