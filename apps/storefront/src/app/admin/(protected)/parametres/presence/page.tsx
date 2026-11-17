import Link from 'next/link';
import { IconBrandWhatsapp, IconExternalLink, IconMapPin, IconStar } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { whatsappLink } from '@/lib/social/whatsappNumber';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { TenantFieldsForm } from '../_components/TenantFieldsForm';
import { loadSocialLinks } from '../_components/loadSettingsData';
import { SocialLinksSection } from '../SocialLinksSection';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

function TestLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-a-border bg-a-surface px-3 text-xs font-semibold text-a-text-2 hover:bg-a-hover hover:text-a-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
      {children} <IconExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

export default async function ParametresPresencePage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const socialLinks = await loadSocialLinks(createServiceClient(), tenant.id);

  return (
    <SettingsPageShell sectionKey="presence">
      <SocialLinksSection initialLinks={socialLinks} />

      <TenantFieldsForm
        id="contact-direct"
        title="Contact direct"
        description="Numéro des boutons WhatsApp de la carte digitale, de la boutique et des événements, de la fiche contact téléchargeable et des e-mails aux clients."
        initialValues={{ whatsapp_number: tenant.whatsapp_number }}
        fields={[
          {
            name: 'whatsapp_number',
            label: 'Numéro WhatsApp',
            type: 'tel',
            autoComplete: 'tel',
            placeholder: '+39 333 123 4567',
            hint: 'Avec l’indicatif du pays. Espaces et « + » acceptés : le numéro est enregistré au format international.',
          },
        ]}
        note={tenant.whatsapp_number ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-a-text-3">
            <IconBrandWhatsapp size={16} aria-hidden="true" className="text-a-text-2" />
            <span>Lien enregistré : {whatsappLink(tenant.whatsapp_number).replace('https://', '')}</span>
            <TestLink href={whatsappLink(tenant.whatsapp_number)}>Tester</TestLink>
          </div>
        ) : undefined}
      />

      <TenantFieldsForm
        id="avis-google"
        title="Google"
        description="Votre fiche Google : avis des clients et itinéraire vers la boutique."
        initialValues={{ google_review_url: tenant.google_review_url }}
        fields={[
          {
            name: 'google_review_url',
            label: 'Lien « laisser un avis »',
            type: 'url',
            placeholder: 'https://g.page/r/…/review',
            wide: true,
            hint: 'Dans Google Business Profile, bouton « Obtenir plus d’avis ». Proposé sur la carte digitale aux clients sans commande dans la boutique.',
          },
        ]}
        note={(
          <div className="space-y-3 border-t border-a-border pt-4 text-xs text-a-text-3">
            {tenant.google_review_url && (
              <div className="flex flex-wrap items-center gap-2">
                <IconStar size={16} aria-hidden="true" className="text-a-text-2" />
                <span>Lien d’avis enregistré</span>
                <TestLink href={tenant.google_review_url}>Tester</TestLink>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <IconMapPin size={16} aria-hidden="true" className="text-a-text-2" />
              {tenant.google_maps_url ? (
                <>
                  <span>Itinéraire Google Maps : réglé avec l’adresse du point de retrait.</span>
                  <TestLink href={tenant.google_maps_url}>Tester</TestLink>
                </>
              ) : (
                <span>Aucun lien Google Maps : la carte digitale n’affiche pas d’itinéraire.</span>
              )}
              <Link href="/admin/parametres/retrait#point-principal" className="font-semibold text-a-brand-fg hover:underline">Modifier dans Retrait &amp; horaires</Link>
            </div>
          </div>
        )}
      />
    </SettingsPageShell>
  );
}
