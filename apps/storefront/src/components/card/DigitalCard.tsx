'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  IconMapPin,
  IconClock,
  IconShoppingBag,
  IconUserPlus,
  IconBrandWhatsapp,
  IconBrandInstagram,
  IconBrandFacebook,
  IconBrandTiktok,
  IconBrandYoutube,
  IconBrandLinkedin,
  IconBrandX,
} from '@tabler/icons-react';
import { SOCIAL_PLATFORM_REGISTRY, type TenantSocialLink } from '@lepefy/types';

const ICONS = {
  IconBrandInstagram,
  IconBrandFacebook,
  IconBrandTiktok,
  IconBrandYoutube,
  IconBrandLinkedin,
  IconBrandX,
};

type Lang = 'fr' | 'it';

const COPY: Record<Lang, {
  followUs: string;
  whatsapp: string;
  products: string;
  addContact: string;
}> = {
  fr: {
    followUs: 'Suivez-nous',
    whatsapp: 'Contacter sur WhatsApp',
    products: 'Voir nos produits',
    addContact: 'Ajouter aux contacts',
  },
  it: {
    followUs: 'Seguici',
    whatsapp: 'Contatta su WhatsApp',
    products: 'Vedi i nostri prodotti',
    addContact: 'Aggiungi ai contatti',
  },
};

interface DigitalCardProps {
  tenant: {
    name: string;
    tagline: string | null;
    logo_url: string | null;
    primary_color: string;
    secondary_color: string;
    accent_light: string;
    click_collect_address: string | null;
    click_collect_hours: string | null;
    whatsapp_number: string | null;
  };
  socialLinks: TenantSocialLink[];
}

export function DigitalCard({ tenant, socialLinks }: DigitalCardProps) {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('lepefy-card-lang') as Lang) ?? 'fr';
    }
    return 'fr';
  });

  function changeLang(next: Lang) {
    setLang(next);
    localStorage.setItem('lepefy-card-lang', next);
  }

  const t = COPY[lang];
  const initials = tenant.name.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">

        <div
          className="px-6 pt-8 pb-6 text-center"
          style={{ backgroundColor: tenant.primary_color }}
        >
          <div className="w-16 h-16 rounded-full bg-white mx-auto mb-3 flex items-center justify-center overflow-hidden">
            {tenant.logo_url ? (
              <Image src={tenant.logo_url} alt={tenant.name} width={64} height={64} className="object-contain" />
            ) : (
              <span className="font-semibold text-lg" style={{ color: tenant.primary_color }}>{initials}</span>
            )}
          </div>
          <p className="text-white text-lg font-semibold">{tenant.name}</p>
          {tenant.tagline && (
            <p className="text-sm italic mt-1" style={{ color: tenant.accent_light }}>{tenant.tagline}</p>
          )}
        </div>

        <div className="p-5">

          <div className="flex gap-1.5 mb-4">
            {(['fr', 'it'] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => changeLang(l)}
                className="flex-1 py-1.5 text-xs rounded-md border"
                style={
                  lang === l
                    ? { backgroundColor: tenant.accent_light, color: tenant.primary_color, borderColor: tenant.accent_light }
                    : { borderColor: '#e5e7eb', color: '#6b7280' }
                }
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>

          {tenant.whatsapp_number && (
            <a
              href={`https://wa.me/${tenant.whatsapp_number}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-lg px-3 py-3 mb-2.5"
              style={{ backgroundColor: tenant.secondary_color }}
            >
              <IconBrandWhatsapp size={20} stroke={1.5} />
              <span className="text-sm font-medium">{t.whatsapp}</span>
            </a>
          )}

          {tenant.click_collect_address && (
            <div className="flex items-start gap-2.5 py-2.5 border-b border-gray-100">
              <IconMapPin size={17} stroke={1.5} className="text-gray-400 mt-0.5 shrink-0" />
              <span className="text-sm text-gray-600 leading-relaxed">{tenant.click_collect_address}</span>
            </div>
          )}

          {tenant.click_collect_hours && (
            <div className="flex items-center gap-2.5 py-2.5 border-b border-gray-100">
              <IconClock size={17} stroke={1.5} className="text-gray-400 shrink-0" />
              <span className="text-sm text-gray-600">{tenant.click_collect_hours}</span>
            </div>
          )}

          <div className="flex items-center gap-2.5 py-2.5 mb-3 border-b border-gray-100">
            <IconShoppingBag size={17} stroke={1.5} className="text-gray-400 shrink-0" />
            <Link href="/" className="text-sm font-medium" style={{ color: tenant.primary_color }}>
              {t.products} →
            </Link>
          </div>

          {socialLinks.length > 0 && (
            <>
              <p className="text-xs text-gray-400 text-center mb-2">{t.followUs}</p>
              <div className="flex justify-center gap-2.5 mb-4">
                {socialLinks.map((link) => {
                  const meta = SOCIAL_PLATFORM_REGISTRY[link.platform];
                  const Icon = ICONS[meta.iconName];
                  return (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={meta.label}
                      className="w-9 h-9 rounded-full bg-gray-50 flex items-center justify-center"
                    >
                      <Icon size={18} stroke={1.5} className="text-gray-600" />
                    </a>
                  );
                })}
              </div>
            </>
          )}

          <a
            href="/api/card/vcard"
            download
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-700"
          >
            <IconUserPlus size={16} stroke={1.5} />
            {t.addContact}
          </a>

        </div>
      </div>
    </div>
  );
}
