import Link from 'next/link';
import {
  IconBell,
  IconBuildingStore,
  IconCreditCard,
  IconExternalLink,
  IconFileDescription,
  IconMapPin,
  IconQrcode,
  IconShare,
  IconSparkles,
} from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { SocialLinksSection } from './SocialLinksSection';
import { BoutiqueInfoSection } from './BoutiqueInfoSection';
import { OriginSection } from './OriginSection';
import { LegalInfoSection } from './LegalInfoSection';
import { NotificationRecipientsSection } from './NotificationRecipientsSection';
import type { TenantSocialLink, TenantNotificationRecipient } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const settingsNav = [
  { href: '#boutique', label: 'Boutique', description: 'Contact, adresse et horaires', icon: IconBuildingStore },
  { href: '#contenu', label: 'Contenu', description: 'Histoire et présence sociale', icon: IconSparkles },
  { href: '#legal', label: 'Légal', description: 'Informations d’entreprise', icon: IconFileDescription },
  { href: '#notifications', label: 'Notifications', description: 'Destinataires internes', icon: IconBell },
  { href: '#qr', label: 'QR & supports', description: 'Carte digitale et boutique', icon: IconQrcode },
];

export default async function ParametresPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const { data: socialLinks } = await supabase
    .from('tenant_social_links')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('sort_order', { ascending: true });

  const { data: notificationRecipients } = await supabase
    .from('tenant_notification_recipients')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: true });

  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-gray-400">Configuration</p>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">Paramètres</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            Gérez les informations utilisées par la boutique, la carte digitale et les communications internes.
          </p>
        </div>

        <Link
          href="/admin/parametres/paiements"
          className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <IconCreditCard size={18} stroke={1.6} />
          Moyens de paiement
          <IconExternalLink size={15} stroke={1.5} />
        </Link>
      </div>

      <nav aria-label="Sections des paramètres" className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {settingsNav.map(({ href, label, description, icon: Icon }) => (
          <a
            key={href}
            href={href}
            className="group rounded-xl border border-gray-200 bg-white p-3 transition hover:border-gray-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
          >
            <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-gray-50 text-gray-500 transition group-hover:bg-[var(--color-primary-light)] group-hover:text-[var(--color-primary-dark)] dark:bg-gray-800 dark:text-gray-400">
              <Icon size={18} stroke={1.6} />
            </span>
            <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">{label}</span>
            <span className="mt-0.5 hidden text-xs leading-4 text-gray-400 lg:block">{description}</span>
          </a>
        ))}
      </nav>

      <div className="space-y-8">
        <section id="boutique" className="scroll-mt-24">
          <div className="mb-3 flex items-center gap-2">
            <IconMapPin size={18} className="text-gray-400" stroke={1.6} />
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Boutique & point de vente</h2>
              <p className="text-xs text-gray-400">Informations visibles par vos clients.</p>
            </div>
          </div>
          <BoutiqueInfoSection
            tagline={tenant.tagline}
            whatsapp_number={tenant.whatsapp_number}
            click_collect_address={tenant.click_collect_address}
            google_maps_url={tenant.google_maps_url}
            click_collect_hours={tenant.click_collect_hours}
            click_collect_hours_it={tenant.click_collect_hours_it}
          />
        </section>

        <section id="contenu" className="scroll-mt-24">
          <div className="mb-3 flex items-center gap-2">
            <IconSparkles size={18} className="text-gray-400" stroke={1.6} />
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Contenu & présence</h2>
              <p className="text-xs text-gray-400">Histoire de la marque et liens sociaux.</p>
            </div>
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <OriginSection
              tenantId={tenant.id}
              story_heading={tenant.story_heading}
              story_text={tenant.story_text}
              story_image_url={tenant.story_image_url}
              countries_served={tenant.countries_served}
            />
            <SocialLinksSection initialLinks={(socialLinks ?? []) as TenantSocialLink[]} />
          </div>
        </section>

        <section id="legal" className="scroll-mt-24">
          <div className="mb-3 flex items-center gap-2">
            <IconFileDescription size={18} className="text-gray-400" stroke={1.6} />
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Informations légales</h2>
              <p className="text-xs text-gray-400">Données utilisées sur les supports officiels.</p>
            </div>
          </div>
          <LegalInfoSection
            legal_name={tenant.legal_name}
            legal_address={tenant.legal_address}
            legal_email={tenant.legal_email}
          />
        </section>

        <section id="notifications" className="scroll-mt-24">
          <div className="mb-3 flex items-center gap-2">
            <IconBell size={18} className="text-gray-400" stroke={1.6} />
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Notifications internes</h2>
              <p className="text-xs text-gray-400">Choisissez qui doit être informé des événements opérationnels.</p>
            </div>
          </div>
          <NotificationRecipientsSection
            initialRecipients={(notificationRecipients ?? []) as TenantNotificationRecipient[]}
          />
        </section>

        <section id="qr" className="scroll-mt-24">
          <div className="mb-3 flex items-center gap-2">
            <IconQrcode size={18} className="text-gray-400" stroke={1.6} />
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">QR codes & supports</h2>
              <p className="text-xs text-gray-400">Téléchargez les supports prêts à imprimer ou partager.</p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Carte digitale</h3>
                  <p className="mt-1 text-xs leading-5 text-gray-400">Pour envoyer les clients vers votre fiche contact.</p>
                </div>
                <IconShare size={19} className="shrink-0 text-gray-300" stroke={1.5} />
              </div>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/api/card/qr-code?size=240" alt="QR code carte digitale" width={120} height={120} className="mx-auto rounded-xl border border-gray-100 sm:mx-0" />
                <div className="flex flex-1 flex-col gap-2">
                  <a href="/api/card/qr-code?format=svg&size=1000&download=1" className="min-h-10 rounded-lg border border-gray-200 px-3 py-2 text-center text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">QR SVG · impression</a>
                  <a href="/api/card/qr-code?format=png&size=1000&download=1" className="min-h-10 rounded-lg border border-gray-200 px-3 py-2 text-center text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">QR PNG</a>
                  <a href="/api/admin/card/poster" className="min-h-10 rounded-lg bg-gray-900 px-3 py-2 text-center text-sm font-medium text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900">Affiche PDF A5</a>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Boutique en ligne</h3>
                  <p className="mt-1 text-xs leading-5 text-gray-400">Pour envoyer directement les clients vers votre shop.</p>
                </div>
                <IconBuildingStore size={19} className="shrink-0 text-gray-300" stroke={1.5} />
              </div>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/api/shop/qr-code?size=240" alt="QR code boutique" width={120} height={120} className="mx-auto rounded-xl border border-gray-100 sm:mx-0" />
                <div className="flex flex-1 flex-col gap-2">
                  <a href="/api/shop/qr-code?format=svg&size=1000&download=1" className="min-h-10 rounded-lg border border-gray-200 px-3 py-2 text-center text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">QR SVG · impression</a>
                  <a href="/api/shop/qr-code?format=png&size=1000&download=1" className="min-h-10 rounded-lg border border-gray-200 px-3 py-2 text-center text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">QR PNG</a>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}
