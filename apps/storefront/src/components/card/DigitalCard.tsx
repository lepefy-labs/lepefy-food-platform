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
  IconBuildingBank,
  IconCash,
  IconBrandPaypal,
  IconQrcode,
  IconWallet,
  IconCopy,
  IconCheck,
} from '@tabler/icons-react';
import { SOCIAL_PLATFORM_REGISTRY, PAYMENT_METHOD_REGISTRY, type TenantSocialLink, type TenantPaymentMethod } from '@lepefy/types';
import { AddToHomeScreen } from './AddToHomeScreen';
import { methodColor, hexToRgba, maskSensitiveValue, isEmailValue } from '@/lib/card/methodColor';

const ICONS = {
  IconBrandInstagram,
  IconBrandFacebook,
  IconBrandTiktok,
  IconBrandYoutube,
  IconBrandLinkedin,
  IconBrandX,
};

const PAYMENT_ICONS = {
  IconBuildingBank,
  IconCash,
  IconBrandPaypal,
  IconQrcode,
  IconWallet,
};

type Lang = 'fr' | 'it';

const COPY: Record<Lang, {
  followUs: string;
  whatsapp: string;
  products: string;
  addContact: string;
  payTitle: string;
  copy: string;
  copied: string;
  cashNote: string;
  comingSoon: string;
}> = {
  fr: {
    followUs: 'Suivez-nous',
    whatsapp: 'Contacter sur WhatsApp',
    products: 'Voir nos produits',
    addContact: 'Ajouter aux contacts',
    payTitle: 'Comment payer',
    copy: 'Copier',
    copied: 'Copié !',
    cashNote: 'Espèces acceptées en boutique',
    comingSoon: 'Boutique en ligne bientôt disponible',
  },
  it: {
    followUs: 'Seguici',
    whatsapp: 'Contatta su WhatsApp',
    products: 'Vedi i nostri prodotti',
    addContact: 'Aggiungi ai contatti',
    payTitle: 'Come pagare',
    copy: 'Copia',
    copied: 'Copiato!',
    cashNote: 'Contanti accettati in negozio',
    comingSoon: 'Negozio online in arrivo',
  },
};

function CopyableValue({ value, displayValue, copyLabel: _copyLabel, copiedLabel: _copiedLabel }: {
  value: string; displayValue?: string; copyLabel: string; copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex items-center justify-between w-full gap-2 rounded-md bg-gray-50 px-2.5 py-1.5 text-left"
    >
      <span className="font-mono text-xs text-gray-700 truncate">{displayValue ?? value}</span>
      {copied ? (
        <IconCheck size={14} stroke={2} className="text-green-600 shrink-0" />
      ) : (
        <IconCopy size={14} stroke={1.5} className="text-gray-400 shrink-0" />
      )}
    </button>
  );
}

function CopyableLine({ label, value, className }: { label?: string; value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={`flex items-center gap-1 ${className ?? ''}`}
    >
      <span>{label ? `${label}: ${value}` : value}</span>
      {copied ? (
        <IconCheck size={11} className="text-green-600 shrink-0" />
      ) : (
        <IconCopy size={11} className="text-gray-400 shrink-0" />
      )}
    </button>
  );
}

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
    click_collect_hours_it: string | null;
    whatsapp_number: string | null;
    storefront_ready: boolean;
  };
  socialLinks: TenantSocialLink[];
  paymentMethods: TenantPaymentMethod[];
}

export function DigitalCard({ tenant, socialLinks, paymentMethods }: DigitalCardProps) {
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
      <div
        className="w-full max-w-sm bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden"
        style={{ fontFamily: 'var(--font-card-body)' }}
      >

        <AddToHomeScreen lang={lang} tenant={{ name: tenant.name, primary_color: tenant.primary_color }} />

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
          <p className="text-white text-lg font-semibold" style={{ fontFamily: 'var(--font-card-heading)' }}>{tenant.name}</p>
          {tenant.tagline && (
            <p className="text-sm italic mt-1" style={{ color: tenant.accent_light }}>{tenant.tagline}</p>
          )}
        </div>

        <div className="p-5 pb-28">

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

          {(() => {
            const hoursText = lang === 'it'
              ? (tenant.click_collect_hours_it || tenant.click_collect_hours)
              : tenant.click_collect_hours;
            return hoursText ? (
              <div className="flex items-center gap-2.5 py-2.5 mb-3 border-b border-gray-100">
                <IconClock size={17} stroke={1.5} className="text-gray-400 shrink-0" />
                <span className="text-sm text-gray-600">{hoursText}</span>
              </div>
            ) : null;
          })()}

          {paymentMethods.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-gray-400 mb-2" style={{ fontFamily: 'var(--font-card-heading)' }}>{t.payTitle}</p>
              <div className="flex flex-col gap-2">
                {paymentMethods.map((pm) => {
                  const meta = PAYMENT_METHOD_REGISTRY[pm.method];
                  const Icon = PAYMENT_ICONS[meta.iconName];
                  const label = pm.label ?? meta.label;

                  const color = methodColor(pm.method, tenant.primary_color);

                  return (
                    <div
                      key={pm.id}
                      className="rounded-2xl p-3.5"
                      style={{
                        background: hexToRgba(color, 0.08),
                        border: `1px solid ${hexToRgba(color, 0.25)}`,
                      }}
                    >
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: color }}
                        >
                          <Icon size={16} stroke={1.8} className="text-white" />
                        </div>
                        <span className="text-sm font-bold text-gray-800" style={{ fontFamily: 'var(--font-card-heading)' }}>{label}</span>
                      </div>

                      {pm.method === 'cash' && (
                        <p className="text-xs text-gray-400 pl-[42px]">{t.cashNote}</p>
                      )}

                      {pm.method === 'bank_transfer' && pm.value && (
                        <div className="pl-[42px] flex flex-col gap-1">
                          {pm.extra?.beneficiary && (
                            <CopyableLine value={pm.extra.beneficiary} className="text-xs text-gray-500" />
                          )}
                          <CopyableValue
                            value={pm.value}
                            displayValue={maskSensitiveValue(pm.value)}
                            copyLabel={t.copy}
                            copiedLabel={t.copied}
                          />
                          {pm.extra?.bic && (
                            <CopyableLine label="BIC" value={pm.extra.bic} className="text-[11px] text-gray-400" />
                          )}
                        </div>
                      )}

                      {pm.method === 'satispay' && pm.value && (
                        <a
                          href={pm.value}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pl-[42px] text-xs font-medium underline"
                          style={{ color: tenant.primary_color }}
                        >
                          {pm.value}
                        </a>
                      )}

                      {pm.method === 'paypal' && pm.value && (
                        isEmailValue(pm.value) ? (
                          <div className="pl-[42px]">
                            <CopyableValue value={pm.value} copyLabel={t.copy} copiedLabel={t.copied} />
                          </div>
                        ) : (
                          <a
                            href={pm.value}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pl-[42px] text-xs font-medium underline"
                            style={{ color: tenant.primary_color }}
                          >
                            {pm.value}
                          </a>
                        )
                      )}

                      {pm.method === 'other' && pm.value && (
                        <p className="text-xs text-gray-500 pl-[42px]">{pm.value}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div
            className="rounded-2xl p-3.5 mb-3"
            style={{ backgroundColor: tenant.accent_light }}
          >
            <div className="flex items-center gap-2.5">
              <IconShoppingBag size={17} stroke={1.5} className="text-gray-400 shrink-0" />
              {tenant.storefront_ready ? (
                <Link href="/" className="text-sm font-medium" style={{ color: tenant.primary_color }}>
                  {t.products} →
                </Link>
              ) : (
                <span className="text-sm text-gray-400 italic">{t.comingSoon}</span>
              )}
            </div>

            {socialLinks.length > 0 && (
              <>
                <div className="border-t my-3" style={{ borderColor: 'rgba(0,0,0,0.06)' }} />
                <p className="text-xs text-gray-400 text-center mb-2">{t.followUs}</p>
                <div className="flex justify-center gap-2.5">
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
                        className="w-9 h-9 rounded-full flex items-center justify-center"
                        style={{ background: meta.badgeBackground }}
                      >
                        <Icon size={18} stroke={1.5} style={{ color: '#ffffff' }} />
                      </a>
                    );
                  })}
                </div>
              </>
            )}
          </div>

        </div>
      </div>

      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex justify-center bg-gradient-to-t from-white via-white/95 to-transparent px-5 pt-3"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        <a
          href="/api/card/vcard"
          download
          className="w-full max-w-sm flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium text-white shadow-sm"
          style={{ backgroundColor: tenant.primary_color }}
        >
          <IconUserPlus size={18} stroke={1.5} />
          <span style={{ fontFamily: 'var(--font-card-heading)' }}>{t.addContact}</span>
        </a>
      </div>
    </div>
  );
}
