import Image from 'next/image';
import Link from 'next/link';
import { IconDownload, IconExternalLink, IconQrcode } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import { SocialLinksSection } from './SocialLinksSection';
import { BoutiqueInfoSection } from './BoutiqueInfoSection';
import { OriginSection } from './OriginSection';
import { LegalInfoSection } from './LegalInfoSection';
import { NotificationRecipientsSection } from './NotificationRecipientsSection';
import type { TenantSocialLink, TenantNotificationRecipient } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ParametresPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();

  const [{ data: socialLinks }, { data: notificationRecipients }] = await Promise.all([
    supabase.from('tenant_social_links').select('*').eq('tenant_id', tenant.id).order('sort_order', { ascending: true }),
    supabase.from('tenant_notification_recipients').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: true }),
  ]);

  const tenantContext = (
    <div className="flex min-w-[220px] items-center gap-3 rounded-2xl border border-[var(--admin-border)] bg-white px-3.5 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-100 bg-gray-50">
        {tenant.logo_url ? (
          <Image src={tenant.logo_url} alt={tenant.name} width={40} height={40} className="h-full w-full object-contain" />
        ) : (
          <span className="text-xs font-semibold text-gray-500">{tenant.name.slice(0, 2).toUpperCase()}</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{tenant.name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Boutique active</p>
      </div>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl pb-10">
      <AdminPageHeader
        title="Paramètres"
        description="Configurez votre espace Lepefy Commerce et les informations utilisées par vos services."
        actions={tenantContext}
      />

      <div className="mb-5 inline-flex gap-1 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface-subtle)] p-1.5" role="tablist" aria-label="Paramètres">
        <span className="min-h-10 rounded-xl bg-[var(--admin-primary-soft)] px-3.5 py-2 text-sm font-medium text-[var(--admin-primary-fg)] ring-1 ring-[#D9D3FF]">Général</span>
        <Link href="/admin/parametres/paiements" className="min-h-10 rounded-xl px-3.5 py-2 text-sm font-medium text-gray-500 transition hover:bg-white hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-gray-100">Paiements</Link>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <BoutiqueInfoSection
          tagline={tenant.tagline}
          storefront_url={tenant.storefront_url}
          whatsapp_number={tenant.whatsapp_number}
          click_collect_address={tenant.click_collect_address}
          google_maps_url={tenant.google_maps_url}
          click_collect_hours={tenant.click_collect_hours}
          click_collect_hours_it={tenant.click_collect_hours_it}
        />

        <OriginSection
          tenantId={tenant.id}
          story_heading={tenant.story_heading}
          story_text={tenant.story_text}
          story_image_url={tenant.story_image_url}
          countries_served={tenant.countries_served}
        />

        <LegalInfoSection legal_name={tenant.legal_name} legal_address={tenant.legal_address} legal_email={tenant.legal_email} />
        <NotificationRecipientsSection initialRecipients={(notificationRecipients ?? []) as TenantNotificationRecipient[]} />

        <div className="xl:col-span-2">
          <SocialLinksSection initialLinks={(socialLinks ?? []) as TenantSocialLink[]} />
        </div>

        <section className="overflow-hidden rounded-2xl border border-[#E8E4FF] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 xl:col-span-2">
          <header className="flex items-start gap-3 border-b border-[#E8E4FF] bg-[var(--admin-primary-soft)] px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-[var(--admin-primary-fg)] shadow-sm dark:bg-gray-800"><IconQrcode size={19} stroke={1.7} /></div>
            <div><h2 className="text-sm font-semibold text-[var(--admin-primary-fg)] dark:text-violet-200">Outils & QR</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Générez et partagez vos QR codes</p></div>
          </header>

          <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
            <div className="flex gap-4 rounded-xl border border-gray-200 bg-[var(--admin-surface-subtle)] p-4 dark:border-gray-800 dark:bg-gray-950/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/api/card/qr-code?size=180" alt="QR Card" width={92} height={92} className="h-[92px] w-[92px] shrink-0 rounded-lg border border-gray-200 bg-white" />
              <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">QR Card</h3><p className="mt-1 text-xs leading-5 text-gray-500">QR code pour votre carte digitale à partager avec vos clients.</p><div className="mt-3 flex flex-wrap gap-2"><a href="/api/card/qr-code?format=svg&size=1000&download=1" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50"><IconDownload size={14} />Télécharger</a><a href="/api/admin/card/poster" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#D9D3FF] bg-white px-3 text-xs font-medium text-[var(--admin-primary-fg)] hover:bg-[var(--admin-primary-soft)]"><IconExternalLink size={14} />Affiche PDF</a></div></div>
            </div>

            <div className="flex gap-4 rounded-xl border border-gray-200 bg-[var(--admin-surface-subtle)] p-4 dark:border-gray-800 dark:bg-gray-950/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/api/shop/qr-code?size=180" alt="QR Shop" width={92} height={92} className="h-[92px] w-[92px] shrink-0 rounded-lg border border-gray-200 bg-white" />
              <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">QR Shop</h3><p className="mt-1 text-xs leading-5 text-gray-500">QR code pour accéder directement à votre boutique en ligne.</p><div className="mt-3 flex flex-wrap gap-2"><a href="/api/shop/qr-code?format=svg&size=1000&download=1" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50"><IconDownload size={14} />Télécharger</a><a href="/api/shop/qr-code?format=png&size=1000&download=1" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#D9D3FF] bg-white px-3 text-xs font-medium text-[var(--admin-primary-fg)] hover:bg-[var(--admin-primary-soft)]"><IconExternalLink size={14} />PNG</a></div></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
