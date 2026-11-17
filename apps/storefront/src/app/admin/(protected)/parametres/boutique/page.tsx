import Link from 'next/link';
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
        description={<>Affichées à vos clients sous le nom <strong className="font-semibold text-a-text-2">{tenant.name}</strong>.</>}
        initialValues={{ tagline: tenant.tagline, storefront_url: tenant.storefront_url }}
        fields={[
          { name: 'tagline', label: 'Slogan', placeholder: 'ex : Les saveurs de chez nous', wide: true },
          { name: 'storefront_url', label: 'URL de la boutique', type: 'url', placeholder: 'https://shop.exemple.com', wide: true, hint: 'URL HTTPS publique utilisée dans les emails, les liens de suivi et les outils de la plateforme.' },
        ]}
        note={<p className="text-xs text-a-text-3">Le numéro WhatsApp, les réseaux sociaux et le lien d’avis Google se règlent dans <Link href="/admin/parametres/presence#contact-direct" className="font-semibold text-a-brand-fg hover:underline">Présence en ligne</Link>.</p>}
      />
    </SettingsPageShell>
  );
}
