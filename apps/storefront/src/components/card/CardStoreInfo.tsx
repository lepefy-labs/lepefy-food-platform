'use client';

import Link from 'next/link';
import {
  IconBrandWhatsapp, IconBrandInstagram, IconBrandFacebook, IconBrandTiktok, IconBrandYoutube,
  IconBrandLinkedin, IconBrandX, IconChevronRight, IconClock, IconStar,
} from '@tabler/icons-react';
import { SOCIAL_PLATFORM_REGISTRY, type TenantSocialLink } from '@lepefy/types';
import { CardLocation } from './CardLocation';

type Lang = 'fr' | 'it';

const ICONS = { IconBrandInstagram, IconBrandFacebook, IconBrandTiktok, IconBrandYoutube, IconBrandLinkedin, IconBrandX };

const COPY = {
  fr: {
    title: 'La boutique', whatsapp: 'WhatsApp', whatsappText: 'Une question ? Écrivez-nous', hours: 'Horaires',
    reviewsTitle: 'Votre avis compte', reviewsText: 'Avis de nos clients vérifiés', reviewsCta: 'Voir les avis',
    googleReviewText: 'Acheté en boutique ?', googleReviewCta: 'Laissez un avis Google', followUs: 'Suivez-nous',
  },
  it: {
    title: 'Il negozio', whatsapp: 'WhatsApp', whatsappText: 'Una domanda? Scrivici', hours: 'Orari',
    reviewsTitle: 'La tua opinione conta', reviewsText: 'Recensioni dei nostri clienti verificati', reviewsCta: 'Vedi le recensioni',
    googleReviewText: 'Hai acquistato in negozio?', googleReviewCta: 'Lascia una recensione Google', followUs: 'Seguici',
  },
} as const;

const PANEL = 'overflow-hidden rounded-3xl bg-white shadow-[0_1px_2px_rgba(17,24,39,0.06)] ring-1 ring-black/[0.04]';
const HEADING = 'mb-3 px-1 text-xl font-extrabold text-gray-900';

interface CardStoreInfoProps {
  lang: Lang;
  tenant: {
    primary_color: string; secondary_color: string; whatsapp_number: string | null;
    click_collect_address: string | null; google_maps_url: string | null;
    click_collect_hours: string | null; click_collect_hours_it: string | null; google_review_url: string | null;
  };
  socialLinks: TenantSocialLink[];
  reviewsEnabled: boolean;
}

/** Contacts, adresse, horaires, avis et réseaux : regroupés en deux surfaces au lieu d'une pile de cartes grises. */
export function CardStoreInfo({ lang, tenant, socialLinks, reviewsEnabled }: CardStoreInfoProps) {
  const t = COPY[lang];
  const hours = lang === 'it' ? (tenant.click_collect_hours_it || tenant.click_collect_hours) : tenant.click_collect_hours;
  const ring = { '--tw-ring-color': tenant.primary_color } as React.CSSProperties;
  const hasStore = Boolean(tenant.whatsapp_number || tenant.click_collect_address || tenant.google_maps_url || hours);
  const hasReviews = reviewsEnabled || Boolean(tenant.google_review_url);

  return (
    <>
      {hasStore && (
        <section aria-labelledby="card-store-title">
          <h2 id="card-store-title" className={HEADING} style={{ fontFamily: 'var(--font-card-heading)' }}>{t.title}</h2>
          <div className={`${PANEL} [&>*+*]:border-t [&>*+*]:border-gray-100`}>
            {tenant.whatsapp_number && (
              <a
                href={`https://wa.me/${tenant.whatsapp_number}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[72px] items-center gap-3 px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset"
                style={ring}
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#25D366] text-white"><IconBrandWhatsapp size={24} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-gray-900">{t.whatsapp}</span>
                  <span className="block text-sm text-gray-700">{t.whatsappText}</span>
                </span>
                <IconChevronRight size={20} aria-hidden="true" className="shrink-0 text-gray-500" />
              </a>
            )}
            <CardLocation address={tenant.click_collect_address} googleMapsUrl={tenant.google_maps_url} lang={lang} primaryColor={tenant.primary_color} secondaryColor={tenant.secondary_color} />
            {hours && (
              <div className="flex items-start gap-3 px-4 py-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gray-50" style={{ color: tenant.primary_color }} aria-hidden><IconClock size={19} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-bold uppercase tracking-wide text-gray-600">{t.hours}</span>
                  <span className="mt-1 block whitespace-pre-line text-sm leading-5 text-gray-800">{hours}</span>
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {hasReviews && (
        <section aria-label={t.reviewsTitle} className={`${PANEL} p-4`}>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700" aria-hidden><IconStar size={22} /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-gray-900">{t.reviewsTitle}</span>
              {reviewsEnabled && <span className="block text-sm text-gray-700">{t.reviewsText}</span>}
            </span>
            {reviewsEnabled && (
              <Link href="/avis" className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-gray-900 px-3.5 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2" style={ring}>{t.reviewsCta}</Link>
            )}
          </div>
          {tenant.google_review_url && (
            <p className="mt-3 flex flex-wrap items-center gap-x-1.5 border-t border-gray-100 pt-3 text-sm text-gray-700">
              {t.googleReviewText}
              <a href={tenant.google_review_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-bold text-gray-900 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2" style={ring}>{t.googleReviewCta}</a>
            </p>
          )}
        </section>
      )}

      {socialLinks.length > 0 && (
        <section aria-labelledby="card-social-title" className="px-1">
          <h2 id="card-social-title" className="mb-2.5 text-sm font-bold text-gray-800">{t.followUs}</h2>
          <ul className="flex flex-wrap gap-3">
            {socialLinks.map((link) => {
              const meta = SOCIAL_PLATFORM_REGISTRY[link.platform];
              const Icon = ICONS[meta.iconName];
              return (
                <li key={link.id}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer" aria-label={meta.label} className="flex h-11 w-11 items-center justify-center rounded-full shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2" style={{ background: meta.badgeBackground, ...ring }}>
                    <Icon size={19} style={{ color: '#fff' }} aria-hidden="true" />
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
