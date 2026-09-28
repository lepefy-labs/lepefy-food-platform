import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { TenantFieldsForm } from '../_components/TenantFieldsForm';
import { loadSocialLinks } from '../_components/loadSettingsData';
import { SocialLinksSection } from '../SocialLinksSection';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ParametresPresencePage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const socialLinks = await loadSocialLinks(createServiceClient(), tenant.id);

  return (
    <SettingsPageShell sectionKey="presence">
      <SocialLinksSection initialLinks={socialLinks} />
      <TenantFieldsForm
        id="avis-google"
        title="Avis Google"
        description="Invitez vos clients à laisser un avis sur votre fiche Google."
        initialValues={{ google_review_url: tenant.google_review_url }}
        fields={[
          {
            name: 'google_review_url',
            label: 'Lien « laisser un avis »',
            type: 'url',
            placeholder: 'https://g.page/r/…/review',
            wide: true,
            hint: 'Disponible dans Google Business Profile (bouton « Obtenir plus d’avis »). Affiché sur la carte digitale pour les clients sans commande dans le système.',
          },
        ]}
      />
    </SettingsPageShell>
  );
}
