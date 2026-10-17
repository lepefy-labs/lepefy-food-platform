'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { IconChevronRight, IconShoppingBag } from '@tabler/icons-react';
import { TenantLogo } from '@/components/branding/TenantLogo';
import type { CardHeroImage } from '@/lib/card/cardHero';
import { darkenHex, readableForeground } from '@/lib/card/cardTheme';
import { PaymentBrandMark } from './CardPaymentBrands';
import type { CardPaymentBrandStrip } from '@/lib/card/cardPaymentBrands';
import { hexToRgba } from '@/lib/card/methodColor';

type Lang = 'fr' | 'it';

const HERO_SIZES = '(min-width: 1024px) 600px, (min-width: 540px) 50vw, 100vw';

const COPY = {
  fr: { title: 'Payer ici en quelques secondes.', pay: 'Payer maintenant', shop: 'Commander sur la boutique', language: 'Langue', bank_transfer: 'Virement', cash: 'Espèces' },
  it: { title: 'Paga qui in pochi secondi.', pay: 'Paga ora', shop: 'Ordina sul negozio online', language: 'Lingua', bank_transfer: 'Bonifico', cash: 'Contanti' },
} as const;

interface CardHeroProps {
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  tenant: { name: string; tagline: string | null; logo_url: string | null; primary_color: string; secondary_color: string };
  image: CardHeroImage | null;
  /** Absent : aucun moyen de paiement visible, la hero devient une simple présentation. */
  onPay?: () => void;
  paymentBrands: CardPaymentBrandStrip;
  showShop: boolean;
}

/**
 * Hero payment-first de /card. Mobile : photo en haut (hauteur bornée en svh
 * pour garder « Payer maintenant » au-dessus de la ligne de flottaison dès
 * 320×568), texte et boutons dessous sur un fond sombre dérivé de la couleur
 * du tenant, dans lequel la photo se fond. Desktop : texte à gauche, photo à
 * droite. La photo (slot tenant, lib/card/cardHero.ts) est décorative : les
 * dimensions ne dépendent jamais d'elle (pas de CLS) et les boutons sont
 * utilisables avant son chargement.
 */
export function CardHero({ lang, onLangChange, tenant, image: configuredImage, onPay, paymentBrands, showShop }: CardHeroProps) {
  const t = COPY[lang];
  // Photo introuvable ou refusée : la hero se replie sur le dégradé compact, jamais une icône d'image cassée.
  const [imageFailed, setImageFailed] = useState(false);
  const image = imageFailed ? null : configuredImage;
  const imageRef = useRef<HTMLImageElement>(null);
  // Une erreur survenue avant l'hydratation ne déclenche pas onError côté React.
  useEffect(() => {
    const element = imageRef.current;
    if (element?.complete && element.naturalWidth === 0) setImageFailed(true);
  }, []);
  const background = darkenHex(tenant.primary_color, 0.8);
  const fade = (alpha: number) => hexToRgba(background, alpha);

  // Photo présente : bande basse au cadrage centré sur le geste de paiement
  // (mobile), puis texte et photo côte à côte dès 540 px. Sans photo : une
  // seule colonne, bande décorative courte.
  const split = Boolean(image);
  const positions = image
    ? ({ '--hero-pos': image.mobilePosition ?? image.position, '--hero-pos-wide': image.position } as React.CSSProperties)
    : undefined;

  return (
    <section
      className={`relative isolate overflow-hidden text-white lg:rounded-[2rem] ${split ? 'min-[540px]:grid min-[540px]:min-h-[400px] min-[540px]:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:grid-cols-2 lg:min-h-[470px]' : ''}`}
      style={{ backgroundColor: background }}
    >
      <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-4 pt-[max(.75rem,env(safe-area-inset-top))] lg:px-7 lg:pt-6">
        <span className="inline-flex min-h-11 items-center rounded-2xl bg-white/95 px-2.5 py-1 shadow-sm">
          <TenantLogo variant="compact" unoptimized priority identity={{ name: tenant.name, logo_url: tenant.logo_url }} className="max-w-[40vw]" fallbackClassName="text-gray-900" />
        </span>
        <div role="group" aria-label={t.language} className="inline-flex rounded-xl bg-black/45 p-1 backdrop-blur-sm">
          {(['fr', 'it'] as const).map((code) => (
            <button
              key={code}
              type="button"
              lang={code}
              onClick={() => onLangChange(code)}
              aria-pressed={lang === code}
              className={`min-h-11 min-w-11 rounded-lg px-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${lang === code ? 'bg-white text-gray-900' : 'text-white'}`}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`relative ${split ? 'aspect-[4/3] max-h-[300px] w-full min-[540px]:order-2 min-[540px]:aspect-auto min-[540px]:h-full min-[540px]:max-h-none' : 'h-[clamp(84px,14svh,128px)]'}`}
        style={split ? positions : { background: `radial-gradient(120% 90% at 80% 10%, ${hexToRgba(tenant.primary_color, 0.55)} 0%, transparent 70%)` }}
      >
        {image && (
          // <picture> statique, jamais /_next/image (quota Vercel épuisée → 402, cf. lib/card/cardHero.ts).
          <picture>
            {image.sources?.map((source) => <source key={source.type} type={source.type} srcSet={source.srcSet} sizes={HERO_SIZES} />)}
            {/* eslint-disable-next-line @next/next/no-img-element -- variantes AVIF/WebP pré-générées, servies sans transformation */}
            <img
              ref={imageRef}
              src={image.src}
              alt=""
              sizes={image.sources ? HERO_SIZES : undefined}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              onError={() => setImageFailed(true)}
              className="absolute inset-0 h-full w-full object-cover [object-position:var(--hero-pos)] min-[540px]:[object-position:var(--hero-pos-wide)]"
            />
          </picture>
        )}
        {/* Haut : lisibilité du logo et du sélecteur ; bas (mobile) / gauche (côte à côte) : fondu court vers le fond du texte, qui ne recouvre jamais le geste de paiement. */}
        <div aria-hidden className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/45 to-transparent" />
        {split && <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/5 min-[540px]:hidden" style={{ background: `linear-gradient(180deg, ${fade(0)} 0%, ${fade(1)} 100%)` }} />}
        {split && <div aria-hidden className="absolute inset-y-0 left-0 hidden w-1/4 min-[540px]:block" style={{ background: `linear-gradient(90deg, ${fade(1)} 0%, ${fade(0)} 100%)` }} />}
      </div>

      <div className={`relative z-10 flex flex-col gap-2.5 px-5 pb-5 ${split ? '-mt-3 min-[540px]:order-1 min-[540px]:mt-0 min-[540px]:justify-end min-[540px]:px-6 min-[540px]:pb-7 min-[540px]:pt-24 lg:gap-3 lg:px-14 lg:pb-12' : 'lg:px-14 lg:pb-12'}`}>
        {onPay && <p className="hidden text-sm font-bold uppercase tracking-[0.08em] text-white/90 min-[540px]:block">{tenant.name}</p>}
        <h1 className="text-[2rem] font-extrabold leading-[1.05] min-[390px]:text-[2.25rem] md:text-5xl lg:text-[3.5rem]" style={{ fontFamily: 'var(--font-card-heading)' }}>
          {onPay ? t.title : tenant.name}
        </h1>
        {!onPay && tenant.tagline && <p className="max-w-md text-base leading-snug text-white/95 lg:text-xl">{tenant.tagline}</p>}
        <div className="mt-1.5 flex flex-col gap-2.5">
          {onPay && (
            <button
              type="button"
              onClick={onPay}
              aria-label={t.pay}
              className="group flex min-h-14 w-full flex-wrap items-center justify-center gap-2 rounded-2xl border-2 border-white/80 bg-white px-3 py-3 text-gray-900 shadow-[0_8px_0_rgba(0,0,0,0.16),0_16px_28px_rgba(0,0,0,0.22)] transition-[transform,box-shadow] hover:shadow-[0_5px_0_rgba(0,0,0,0.16),0_10px_20px_rgba(0,0,0,0.2)] active:translate-y-1 active:shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white motion-reduce:transition-none lg:max-w-md"
            >
              {paymentBrands.brands.map((brand) => (
                <span key={brand} aria-hidden="true" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-2.5 shadow-sm transition-colors group-hover:bg-white">
                  <PaymentBrandMark brand={brand} size="sm" />
                </span>
              ))}
              {paymentBrands.chips.map((chip) => (
                <span key={chip} aria-hidden="true" className="flex min-h-11 items-center rounded-xl border border-gray-200 bg-gray-50 px-2.5 text-sm font-bold shadow-sm transition-colors group-hover:bg-white">
                  {t[chip]}
                </span>
              ))}
              <IconChevronRight size={20} aria-hidden="true" className="shrink-0 text-gray-500" />
            </button>
          )}
          {showShop && (
            <Link
              href="/"
              className="flex min-h-[52px] w-full items-center gap-2.5 rounded-2xl px-4 text-base font-bold shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70 md:gap-3 md:px-5 lg:min-h-14 lg:max-w-md"
              style={{ backgroundColor: tenant.secondary_color, color: readableForeground(tenant.secondary_color) }}
            >
              <IconShoppingBag size={24} aria-hidden="true" className="shrink-0" />
              <span className="flex-1">{t.shop}</span>
              <IconChevronRight size={20} aria-hidden="true" className="shrink-0" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
