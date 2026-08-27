'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  IconClock, IconShoppingBag, IconUserPlus, IconBrandWhatsapp,
  IconBrandInstagram, IconBrandFacebook, IconBrandTiktok, IconBrandYoutube,
  IconBrandLinkedin, IconBrandX, IconCreditCard, IconExternalLink,
} from '@tabler/icons-react';
import { SOCIAL_PLATFORM_REGISTRY, type TenantSocialLink, type TenantPaymentMethod } from '@lepefy/types';
import { TenantLogo } from '@/components/branding/TenantLogo';
import { AddToHomeScreen } from './AddToHomeScreen';
import { CardLocation } from './CardLocation';
import { PaymentMethodsAccordion } from './PaymentMethodsAccordion';

const ICONS = { IconBrandInstagram, IconBrandFacebook, IconBrandTiktok, IconBrandYoutube, IconBrandLinkedin, IconBrandX };
type Lang = 'fr' | 'it';

const COPY = {
  fr: {
    descriptor: 'Carte digitale', heroSupport: 'Toutes nos infos, services et paiements à portée de main.',
    followUs: 'Suivez-nous', whatsapp: 'Contacter sur WhatsApp', products: 'Découvrir notre boutique',
    addContact: 'Ajouter aux contacts', comingSoon: 'Boutique en ligne bientôt disponible', payTitle: 'Comment payer ?',
    payText: 'Plusieurs méthodes sûres et rapides sont disponibles pour régler vos commandes.', payCta: 'Voir les moyens de paiement',
  },
  it: {
    descriptor: 'Card digitale', heroSupport: 'Tutte le informazioni, i servizi e i pagamenti sempre a portata di mano.',
    followUs: 'Seguici', whatsapp: 'Contatta su WhatsApp', products: 'Scopri il nostro negozio', addContact: 'Aggiungi ai contatti',
    comingSoon: 'Negozio online in arrivo', payTitle: 'Come pagare?', payText: 'Sono disponibili diversi metodi sicuri e rapidi per effettuare i tuoi pagamenti.',
    payCta: 'Vedi i metodi di pagamento',
  },
} as const;

interface Props {
  tenant: {
    name: string; tagline: string | null; logo_url: string | null; primary_color: string; secondary_color: string; accent_light: string;
    click_collect_address: string | null; google_maps_url: string | null; click_collect_hours: string | null; click_collect_hours_it: string | null;
    whatsapp_number: string | null; storefront_ready: boolean; currency: string;
  };
  socialLinks: TenantSocialLink[];
  paymentMethods: TenantPaymentMethod[];
}

function readableForeground(hex: string): '#111827' | '#ffffff' {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return '#111827';
  const r = parseInt(normalized.slice(0, 2), 16) / 255; const g = parseInt(normalized.slice(2, 4), 16) / 255; const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const linear = (v: number) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b) > 0.42 ? '#111827' : '#ffffff';
}

export function DigitalCard({ tenant, socialLinks, paymentMethods }: Props) {
  const [lang, setLang] = useState<Lang>(() => typeof window !== 'undefined' ? ((localStorage.getItem('lepefy-card-lang') as Lang) ?? 'fr') : 'fr');
  const [inPayment, setInPayment] = useState(false);
  const t = COPY[lang]; const initials = tenant.name.slice(0, 2).toUpperCase(); const secondaryForeground = readableForeground(tenant.secondary_color);
  const hours = lang === 'it' ? (tenant.click_collect_hours_it || tenant.click_collect_hours) : tenant.click_collect_hours;
  function changeLang(next: Lang) { setLang(next); localStorage.setItem('lepefy-card-lang', next); }

  return <div className="min-h-screen bg-gray-50 sm:flex sm:items-start sm:justify-center sm:px-4 sm:py-10">
    <div className="mx-auto w-full max-w-md overflow-hidden bg-white shadow-sm sm:rounded-[2rem] sm:border sm:border-gray-200" style={{ fontFamily: 'var(--font-card-body)' }}>
      <AddToHomeScreen lang={lang} tenant={{ name: tenant.name, primary_color: tenant.primary_color }} />
      {!inPayment && <header className="relative overflow-hidden px-5 pb-5 pt-3 text-center" style={{ backgroundColor: tenant.primary_color }}>
        <div aria-hidden className="absolute -left-12 top-10 h-28 w-28 rounded-full opacity-[0.045]" style={{ backgroundColor: tenant.secondary_color }} /><div aria-hidden className="absolute -right-14 -top-12 h-36 w-36 rounded-full opacity-[0.045]" style={{ backgroundColor: tenant.secondary_color }} />
        <div className="absolute right-3 top-2 z-10"><div className="inline-flex rounded-lg border border-white/15 bg-black/[0.05] p-px backdrop-blur-sm" aria-label="Language">{(['fr','it'] as Lang[]).map(l=><button key={l} type="button" onClick={()=>changeLang(l)} aria-pressed={lang===l} className="min-h-11 min-w-11 rounded-[7px] px-1.5 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" style={lang===l?{backgroundColor:tenant.secondary_color,color:secondaryForeground}:{color:'rgba(255,255,255,.66)'}}>{l.toUpperCase()}</button>)}</div></div>
        <div className="relative mx-auto flex min-h-24 items-center justify-center">{tenant.logo_url?<TenantLogo variant="hero" identity={{name:tenant.name,logo_url:tenant.logo_url}} priority className="mx-auto max-w-[72vw]"/>:<span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10 text-2xl font-extrabold text-white ring-1 ring-white/20" style={{fontFamily:'var(--font-card-heading)'}}>{initials}</span>}</div>
        <h1 className="relative mt-0.5 text-xl font-extrabold text-white" style={{fontFamily:'var(--font-card-heading)'}}>{tenant.name}</h1><p className="relative mt-0.5 text-sm font-bold text-white/95" style={{fontFamily:'var(--font-card-heading)'}}>{t.descriptor}</p><p className="relative mx-auto mt-0.5 max-w-xs text-[13px] leading-snug text-white/75">{t.heroSupport}</p><div className="relative mx-auto mt-2 h-0.5 w-8 rounded-full" style={{backgroundColor:tenant.secondary_color}}/>
      </header>}
      <div className={inPayment?'p-5 sm:p-7':'relative -mt-4 rounded-t-[1.75rem] bg-white px-4 pb-28 pt-5 sm:px-5'}>{inPayment?<PaymentMethodsAccordion paymentMethods={paymentMethods} primaryColor={tenant.primary_color} currency={tenant.currency} lang={lang} onClose={()=>setInPayment(false)}/>:<>
        <section className="mb-4 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.035)]">
          {tenant.whatsapp_number&&<div className="p-2.5"><a href={`https://wa.me/${tenant.whatsapp_number}`} target="_blank" rel="noopener noreferrer" className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-[11px] px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2" style={{backgroundColor:tenant.secondary_color,color:secondaryForeground,'--tw-ring-color':tenant.primary_color} as React.CSSProperties}><IconBrandWhatsapp size={20} stroke={2}/>{t.whatsapp}</a></div>}
          <CardLocation address={tenant.click_collect_address} googleMapsUrl={tenant.google_maps_url} lang={lang} primaryColor={tenant.primary_color} secondaryColor={tenant.secondary_color}/>
          {hours&&<div className="flex items-start gap-3 border-t border-gray-100 px-4 py-3.5"><IconClock size={18} className="mt-0.5 shrink-0" style={{color:tenant.primary_color}}/><span className="text-sm leading-5 text-gray-700">{hours}</span></div>}
        </section>
        {paymentMethods.length>0&&<section className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.035)]"><div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-white" style={{backgroundColor:tenant.primary_color}}><IconCreditCard size={18}/></div><div className="min-w-0 flex-1"><h2 className="font-bold text-gray-900" style={{fontFamily:'var(--font-card-heading)'}}>{t.payTitle}</h2><div className="mt-1 h-0.5 w-7 rounded-full" style={{backgroundColor:tenant.secondary_color}}/><p className="mt-2 text-sm leading-relaxed text-gray-500">{t.payText}</p></div></div><button type="button" onClick={()=>setInPayment(true)} className="mt-3.5 min-h-12 w-full rounded-xl px-4 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2" style={{backgroundColor:tenant.primary_color,'--tw-ring-color':tenant.primary_color} as React.CSSProperties}>{t.payCta}</button></section>}
        <section className="mb-4">{tenant.storefront_ready?<Link href="/" className="flex min-h-12 items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-800 shadow-[0_1px_3px_rgba(0,0,0,0.025)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2" style={{'--tw-ring-color':tenant.primary_color} as React.CSSProperties}><IconShoppingBag size={18} style={{color:tenant.primary_color}}/><span className="flex-1">{t.products}</span><IconExternalLink size={16} className="text-gray-400"/></Link>:<div className="flex min-h-12 items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 text-sm italic text-gray-500"><IconShoppingBag size={18} style={{color:tenant.primary_color}}/>{t.comingSoon}</div>}</section>
        {socialLinks.length>0&&<section className="mb-1 px-1"><h2 className="mb-2.5 text-sm font-bold text-gray-800" style={{fontFamily:'var(--font-card-heading)'}}>{t.followUs}</h2><div className="flex flex-wrap gap-3">{socialLinks.map(link=>{const meta=SOCIAL_PLATFORM_REGISTRY[link.platform];const Icon=ICONS[meta.iconName];return <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={meta.label} className="flex h-11 w-11 items-center justify-center rounded-full shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2" style={{background:meta.badgeBackground,'--tw-ring-color':tenant.primary_color} as React.CSSProperties}><Icon size={19} style={{color:'#fff'}}/></a>})}</div></section>}
      </>}</div>
    </div>
    {!inPayment&&<div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center border-t border-gray-200/70 bg-white/90 px-4 pt-2 backdrop-blur-md" style={{paddingBottom:'calc(.5rem + env(safe-area-inset-bottom))'}}><a href="/api/card/vcard" download className="flex min-h-12 w-full max-w-md items-center justify-center gap-2 rounded-xl text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2" style={{backgroundColor:tenant.primary_color,'--tw-ring-color':tenant.primary_color} as React.CSSProperties}><IconUserPlus size={18}/><span style={{fontFamily:'var(--font-card-heading)'}}>{t.addContact}</span></a></div>}
  </div>;
}
