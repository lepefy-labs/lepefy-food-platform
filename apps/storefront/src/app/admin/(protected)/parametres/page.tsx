import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { PaymentMethodsSection } from './PaymentMethodsSection';
import { SocialLinksSection } from './SocialLinksSection';
import { BoutiqueInfoSection } from './BoutiqueInfoSection';
import { LegalInfoSection } from './LegalInfoSection';
import type { TenantPaymentMethod, TenantSocialLink } from '@lepefy/types';

export const dynamic = 'force-dynamic';

export default async function ParametresPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const [{ data: paymentMethods }, { data: socialLinks }] = await Promise.all([
    supabase
      .from('tenant_payment_methods')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('tenant_social_links')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('sort_order', { ascending: true }),
  ]);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Paramètres</h1>
      <p className="text-sm text-gray-500 mb-6">
        Configuration de votre boutique
      </p>

      <div className="space-y-6">
        <BoutiqueInfoSection
          tagline={tenant.tagline}
          whatsapp_number={tenant.whatsapp_number}
          click_collect_address={tenant.click_collect_address}
          click_collect_hours={tenant.click_collect_hours}
          click_collect_hours_it={tenant.click_collect_hours_it}
        />

        <SocialLinksSection initialLinks={(socialLinks ?? []) as TenantSocialLink[]} />

        <PaymentMethodsSection initialMethods={(paymentMethods ?? []) as TenantPaymentMethod[]} />

        <LegalInfoSection
          legal_name={tenant.legal_name}
          legal_address={tenant.legal_address}
          legal_email={tenant.legal_email}
        />

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Carte digitale</h2>
          <p className="text-xs text-gray-400 mb-4">
            À imprimer ou partager pour renvoyer vos clients vers votre fiche contact.
          </p>

          <div className="flex items-start gap-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/api/card/qr-code?size=240"
              alt="QR code carte digitale"
              width={120}
              height={120}
              className="rounded-lg border border-gray-100"
            />

            <div className="flex flex-col gap-2">
              <a
                href="/api/card/qr-code?format=svg&size=1000&download=1"
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-center"
              >
                Télécharger QR (SVG, impression)
              </a>
              <a
                href="/api/card/qr-code?format=png&size=1000&download=1"
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-center"
              >
                Télécharger QR (PNG)
              </a>
              <a
                href="/api/admin/card/poster"
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-center"
              >
                Télécharger l&apos;affiche à imprimer (PDF A5)
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
