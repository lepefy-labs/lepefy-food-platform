'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { IconChevronRight, IconCreditCard, IconShoppingBag } from '@tabler/icons-react';
import { TenantLogo } from '@/components/branding/TenantLogo';
import type { CardHeroImage } from '@/lib/card/cardHero';
import { CARD_PAY_COLOR, darkenHex } from '@/lib/card/cardTheme';
import { hexToRgba } from '@/lib/card/methodColor';

type Lang = 'fr' | 'it';

const HERO_SIZES = '(min-width: 1024px) 600px, 100vw';

const COPY = {
  fr: { title: 'Payez ici, simplement.', subtitle: 'Réglez votre achat en quelques instants.', pay: 'Payer maintenant', shop: 'Commander sur la boutique', language: 'Langue' },
  it: { title: 'Paga qui, in modo semplice.', subtitle: 'Salda il tuo acquisto in pochi istanti.', pay: 'Paga ora', shop: 'Ordina sul negozio online', language: 'Lingua' },
} as const;

interface CardHeroProps {
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  tenant: { name: string; tagline: string | null; logo_url: string | null; primary_color: string };
  image: CardHeroImage | null;
  /** Absent : aucun moyen de paiement visible, la hero devient une simple présentation. */
  onPay?: () => void;
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
export function CardHero({ lang, onLangChange, tenant, image: configuredImage, onPay, showShop }: CardHeroProps) {
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

  return (
    <section
      className="relative isolate overflow-hidden text-white lg:grid lg:min-h-[560px] lg:grid-cols-2 lg:rounded-[2rem]"
      style={{ backgroundColor: background }}
    >
      <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-4 pt-[max(.875rem,env(safe-area-inset-top))] lg:px-7 lg:pt-6">
        <span className="inline-flex min-h-12 items-center rounded-2xl bg-white/95 px-3 py-1 shadow-sm">
          <TenantLogo variant="compact" priority identity={{ name: tenant.name, logo_url: tenant.logo_url }} className="max-w-[44vw]" fallbackClassName="text-gray-900" />
        </span>
        <div role="group" aria-label={t.language} className="inline-flex rounded-xl bg-black/40 p-1 backdrop-blur-sm">
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
        className={`relative lg:order-2 lg:h-auto ${image ? 'h-[clamp(220px,48svh,460px)]' : 'h-[clamp(120px,22svh,180px)]'}`}
        style={image ? undefined : { background: `radial-gradient(120% 90% at 80% 10%, ${hexToRgba(tenant.primary_color, 0.55)} 0%, transparent 70%)` }}
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
              className="absolute inset-0 h-full w-full object-cover"
              style={{ objectPosition: image.position }}
            />
          </picture>
        )}
        {/* Haut : lisibilité du logo et du sélecteur ; bas (mobile) / gauche (desktop) : fondu vers le fond du texte. */}
        <div aria-hidden className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/45 to-transparent" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/5 lg:hidden" style={{ background: `linear-gradient(180deg, ${fade(0)} 0%, ${fade(1)} 100%)` }} />
        <div aria-hidden className="absolute inset-y-0 left-0 hidden w-1/3 lg:block" style={{ background: `linear-gradient(90deg, ${fade(1)} 0%, ${fade(0)} 100%)` }} />
      </div>

      <div className="relative z-10 -mt-12 flex flex-col gap-3 px-5 pb-6 lg:order-1 lg:mt-0 lg:justify-end lg:px-14 lg:pb-14 lg:pt-28">
        {onPay && <p className="text-sm font-bold uppercase tracking-[0.08em] text-white/90">{tenant.name}</p>}
        <h1 className="text-[2.25rem] font-extrabold leading-[1.05] min-[390px]:text-[2.5rem] sm:text-5xl lg:text-6xl" style={{ fontFamily: 'var(--font-card-heading)' }}>
          {onPay ? t.title : tenant.name}
        </h1>
        {(onPay || tenant.tagline) && <p className="max-w-md text-[17px] leading-snug text-white/95 lg:text-xl">{onPay ? t.subtitle : tenant.tagline}</p>}
        <div className="mt-2 flex flex-col gap-3">
          {onPay && (
            <button
              type="button"
              onClick={onPay}
              className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl px-5 text-left text-lg font-extrabold text-white shadow-[0_10px_28px_rgba(0,0,0,0.35)] ring-1 ring-white/30 transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white active:scale-[0.99] motion-reduce:transition-none lg:max-w-md"
              style={{ backgroundColor: CARD_PAY_COLOR, fontFamily: 'var(--font-card-heading)' }}
            >
              <IconCreditCard size={26} aria-hidden="true" className="shrink-0" />
              <span className="flex-1">{t.pay}</span>
              <IconChevronRight size={22} aria-hidden="true" className="shrink-0" />
            </button>
          )}
          {showShop && (
            <Link
              href="/"
              className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl bg-white px-5 text-base font-bold text-gray-900 shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70 lg:max-w-md"
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
