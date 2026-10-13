'use client';

import { useCallback, useState } from 'react';
import {
  IconArrowLeft, IconBuildingBank, IconCash, IconBrandPaypal, IconQrcode, IconWallet, IconCreditCard,
  IconCopy, IconCheck, IconChevronRight, IconExternalLink, IconBrandApple, IconLock, IconInfoCircle,
} from '@tabler/icons-react';
import { PAYMENT_METHOD_REGISTRY, type TenantPaymentMethod } from '@lepefy/types';
import { TenantLogo } from '@/components/branding/TenantLogo';
import { CardQuickPay, type CardQuickPayStage } from './CardQuickPay';
import { PaymentBrandMark } from './CardPaymentBrands';
import { methodColor, hexToRgba, isEmailValue } from '@/lib/card/methodColor';
import { isOnlineCardMethod, isRevolutMethod } from '@/lib/card/cardPaymentBrands';
import { CARD_PAY_COLOR } from '@/lib/card/cardTheme';

const PAYMENT_ICONS = { IconBuildingBank, IconCash, IconBrandPaypal, IconQrcode, IconWallet, IconCreditCard, IconBrandApple };
type Lang = 'fr' | 'it';

const COPY = {
  fr: {
    back: 'Retour', secure: 'Paiement sécurisé', title: 'Comment voulez-vous payer ?', subtitle: 'Réglez votre achat en quelques instants.',
    online: 'Payer maintenant, en ligne', others: 'Autres moyens de paiement',
    othersText: 'Vous payez dans l’application du service ou en boutique : ce paiement n’est pas confirmé ici automatiquement.',
    card: 'Carte bancaire', applePay: 'Apple Pay', onlineInfo: 'Carte et Apple Pay : confirmation immédiate à l’écran, et par e-mail si vous indiquez votre adresse.',
    bank: 'Copiez l’IBAN et payez depuis votre banque', paypal: 'Ouvre PayPal pour payer', satispay: 'Ouvre Satispay pour payer', revolut: 'Ouvre Revolut pour payer',
    cash: 'À régler directement en boutique', other: 'Moyen de paiement alternatif',
    beneficiary: 'Bénéficiaire', copy: 'Copier', copied: 'Copié !', bankTitle: 'Virement bancaire', cashTitle: 'Paiement en espèces',
    cashText: 'Les espèces sont acceptées directement en boutique.', externalText: 'Vous allez continuer dans l’application ou le site du service de paiement.',
    open: (x: string) => `Ouvrir ${x}`, choose: 'Moyen de paiement',
  },
  it: {
    back: 'Indietro', secure: 'Pagamento sicuro', title: 'Come vuoi pagare?', subtitle: 'Salda il tuo acquisto in pochi istanti.',
    online: 'Paga ora, online', others: 'Altri metodi di pagamento',
    othersText: 'Paghi nell’app del servizio o in negozio: questo pagamento non viene confermato qui automaticamente.',
    card: 'Carta bancaria', applePay: 'Apple Pay', onlineInfo: 'Carta e Apple Pay: conferma immediata sullo schermo, e via email se indichi il tuo indirizzo.',
    bank: 'Copia l’IBAN e paga dalla tua banca', paypal: 'Apre PayPal per pagare', satispay: 'Apre Satispay per pagare', revolut: 'Apre Revolut per pagare',
    cash: 'Da saldare direttamente in negozio', other: 'Metodo di pagamento alternativo',
    beneficiary: 'Beneficiario', copy: 'Copia', copied: 'Copiato!', bankTitle: 'Bonifico bancario', cashTitle: 'Pagamento in contanti',
    cashText: 'I contanti sono accettati direttamente in negozio.', externalText: 'Continuerai nell’app o nel sito del servizio di pagamento.',
    open: (x: string) => `Apri ${x}`, choose: 'Metodo di pagamento',
  },
} as const;

type Copy = typeof COPY.fr | typeof COPY.it;

function description(pm: TenantPaymentMethod, t: Copy) {
  switch (pm.method) {
    case 'bank_transfer': return t.bank;
    case 'paypal': return t.paypal;
    case 'satispay': return t.satispay;
    case 'cash': return t.cash;
    case 'other': return isRevolutMethod(pm) ? t.revolut : t.other;
    default: return t.other;
  }
}

function CopyValue({ value, color, label, copiedLabel }: { value: string; color: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border bg-white px-3 text-left focus-visible:outline-none focus-visible:ring-2"
      style={{ borderColor: hexToRgba(color, 0.35), '--tw-ring-color': color } as React.CSSProperties}
    >
      <span className="min-w-0 break-all font-mono text-sm font-semibold text-gray-900">{value}</span>
      <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-gray-900" aria-live="polite">{copied ? <IconCheck size={16} aria-hidden="true" /> : <IconCopy size={16} aria-hidden="true" />} {copied ? copiedLabel : label}</span>
    </button>
  );
}

const SURFACE = 'rounded-3xl bg-white shadow-[0_1px_2px_rgba(17,24,39,0.06)] ring-1 ring-black/[0.04]';

export function PaymentMethodsAccordion({ paymentMethods, primaryColor, currency, lang, onClose, tenantName, tenantLogoUrl, shop }: {
  paymentMethods: TenantPaymentMethod[]; primaryColor: string; currency: string; lang: Lang; onClose: () => void;
  tenantName: string; tenantLogoUrl: string | null; shop: { color: string; foreground: string } | null;
}) {
  const t = COPY[lang];
  // La liste reçue est déjà filtrée par DigitalCard (tuile apple_pay seulement
  // si activée ET supportée par l'appareil).
  const onlineMethods = [...paymentMethods.filter(isOnlineCardMethod)].sort((a, b) => (a.method === 'card' ? -1 : b.method === 'card' ? 1 : 0));
  const otherMethods = paymentMethods.filter((m) => !isOnlineCardMethod(m));
  const cardRow = onlineMethods.find((m) => m.method === 'card');
  // La carte (ou à défaut Apple Pay) est présélectionnée : le montant se saisit tout de suite.
  const [onlineId, setOnlineId] = useState<string | null>(onlineMethods[0]?.id ?? null);
  const [detail, setDetail] = useState<TenantPaymentMethod | null>(null);
  const [stage, setStage] = useState<CardQuickPayStage>('amount');
  const handleStage = useCallback((next: CardQuickPayStage) => setStage(next), []);
  const ring = { '--tw-ring-color': primaryColor } as React.CSSProperties;
  const selectedOnline = onlineMethods.find((m) => m.id === onlineId) ?? null;

  if (paymentMethods.length === 0) return null;

  const backButton = (onClick: () => void) => (
    <button type="button" onClick={onClick} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm ring-1 ring-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900">
      <IconArrowLeft size={18} aria-hidden="true" />{t.back}
    </button>
  );

  const quickPay = selectedOnline && (
    <CardQuickPay
      key={selectedOnline.id}
      embedded
      mode={selectedOnline.method === 'apple_pay' ? 'apple_pay' : 'card'}
      tenantColor={selectedOnline.method === 'apple_pay' ? methodColor('apple_pay', primaryColor) : CARD_PAY_COLOR}
      currency={currency}
      lang={lang}
      onBack={onClose}
      onReturnToCard={onClose}
      tenantName={tenantName}
      shop={shop}
      onStageChange={handleStage}
      onUseCard={selectedOnline.method === 'apple_pay' && cardRow ? () => { setStage('amount'); setOnlineId(cardRow.id); } : undefined}
    />
  );

  // Étape Stripe ou écran d'issue : plus de tuiles ni d'autres moyens, aucun
  // changement de méthode en cours de confirmation. CardQuickPay garde la même
  // place dans l'arbre (enfants conditionnels à position fixe) pour ne jamais
  // être remonté — il perdrait montant et étape.
  const focus = Boolean(quickPay) && stage !== 'amount';

  if (detail) {
    const color = methodColor(detail.method, primaryColor);
    const meta = PAYMENT_METHOD_REGISTRY[detail.method];
    const Icon = PAYMENT_ICONS[meta.iconName];
    const title = detail.label ?? meta.label;
    const bank = detail.method === 'bank_transfer';
    const cash = detail.method === 'cash';
    const externalLink = detail.extra?.link || (detail.method === 'satispay' ? detail.value : null) || (detail.method === 'paypal' && detail.value && !isEmailValue(detail.value) ? detail.value : null);
    const label = (text: string) => <p className="mb-2 text-sm font-semibold text-gray-700">{text}</p>;
    const openButton = (href: string) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl px-4 font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2" style={{ backgroundColor: color, '--tw-ring-color': color } as React.CSSProperties}>
        <IconExternalLink size={18} aria-hidden="true" />{t.open(title)}
      </a>
    );
    return (
      <div>
        {backButton(() => setDetail(null))}
        <div className={`${SURFACE} mt-4 p-5`}>
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white" style={{ backgroundColor: color }}><Icon size={24} aria-hidden="true" /></span>
            <h2 className="text-2xl font-extrabold text-gray-900" style={{ fontFamily: 'var(--font-card-heading)' }}>{bank ? t.bankTitle : cash ? t.cashTitle : title}</h2>
          </div>
          {cash ? (
            <p className="rounded-2xl bg-gray-50 p-4 text-base leading-relaxed text-gray-800">{t.cashText}</p>
          ) : bank ? (
            <div className="space-y-5">
              {detail.extra?.beneficiary && <div>{label(t.beneficiary)}<CopyValue value={detail.extra.beneficiary} color={color} label={t.copy} copiedLabel={t.copied} /></div>}
              {detail.value && <div>{label('IBAN')}<CopyValue value={detail.value} color={color} label={t.copy} copiedLabel={t.copied} /></div>}
              {detail.extra?.bic && <div>{label('BIC')}<CopyValue value={detail.extra.bic} color={color} label={t.copy} copiedLabel={t.copied} /></div>}
              {detail.extra?.link && openButton(detail.extra.link)}
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-base leading-relaxed text-gray-700">{t.externalText}</p>
              {detail.method === 'paypal' && detail.value && isEmailValue(detail.value) && <CopyValue value={detail.value} color={color} label={t.copy} copiedLabel={t.copied} />}
              {externalLink && openButton(externalLink)}
              {detail.method === 'other' && !externalLink && detail.value && <p className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-800">{detail.value}</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!focus && (
        <div className="flex items-center justify-between gap-3">
          {backButton(onClose)}
          <TenantLogo variant="compact" identity={{ name: tenantName, logo_url: tenantLogoUrl }} className="max-w-[40vw]" fallbackClassName="text-gray-900" />
        </div>
      )}
      {!focus && (
        <header>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 shadow-sm ring-1 ring-black/5"><IconLock size={15} aria-hidden="true" />{t.secure}</p>
          <h1 className="mt-3 text-[1.75rem] font-extrabold leading-tight text-gray-900" style={{ fontFamily: 'var(--font-card-heading)' }}>{t.title}</h1>
          <p className="mt-1 text-base text-gray-700">{t.subtitle}</p>
        </header>
      )}
      {!focus && onlineMethods.length > 0 && (
        <section aria-labelledby="card-online-title" className="space-y-4">
          <h2 id="card-online-title" className="text-sm font-bold uppercase tracking-wide text-gray-800">{t.online}</h2>
          <div role="group" aria-label={t.choose} className="grid grid-cols-2 gap-3">
            {onlineMethods.map((pm) => {
              const selected = pm.id === onlineId;
              const isCard = pm.method === 'card';
              return (
                <button
                  key={pm.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => { setStage('amount'); setOnlineId(pm.id); }}
                  className={`flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-2xl border-2 bg-white px-2 py-3 text-center text-sm font-bold text-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none ${selected ? '' : 'border-gray-200'}`}
                  style={{ ...(selected ? { borderColor: CARD_PAY_COLOR, backgroundColor: hexToRgba(CARD_PAY_COLOR, 0.05) } : {}), '--tw-ring-color': CARD_PAY_COLOR } as React.CSSProperties}
                >
                  {isCard ? (
                    <span className="flex h-10 w-12 items-center justify-center rounded-lg text-white" style={{ backgroundColor: CARD_PAY_COLOR }}><IconCreditCard size={24} aria-hidden="true" /></span>
                  ) : (
                    <span className="flex h-10 items-center"><PaymentBrandMark brand="apple_pay" /></span>
                  )}
                  <span>{isCard ? (pm.label ?? t.card) : t.applePay}</span>
                  {isCard && <span className="flex items-center gap-1.5" aria-hidden="true"><PaymentBrandMark brand="visa" size="sm" /><PaymentBrandMark brand="mastercard" size="sm" /></span>}
                </button>
              );
            })}
          </div>
        </section>
      )}
      {quickPay}
      {!focus && otherMethods.length > 0 && (
        <section aria-labelledby="card-other-title">
          <h2 id="card-other-title" className="text-sm font-bold uppercase tracking-wide text-gray-800">{t.others}</h2>
          <p className="mt-1 text-sm leading-snug text-gray-700">{t.othersText}</p>
          <ul className={`${SURFACE} mt-3 overflow-hidden [&>li+li]:border-t [&>li+li]:border-gray-100`}>
            {otherMethods.map((pm) => {
              const meta = PAYMENT_METHOD_REGISTRY[pm.method];
              const Icon = PAYMENT_ICONS[meta.iconName];
              const color = methodColor(pm.method, primaryColor);
              return (
                <li key={pm.id}>
                  <button type="button" onClick={() => setDetail(pm)} className="flex min-h-[72px] w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset" style={ring}>
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: hexToRgba(color, 0.12), color }}><Icon size={22} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-gray-900">{pm.label ?? meta.label}</span>
                      <span className="mt-0.5 block text-sm text-gray-700">{description(pm, t)}</span>
                    </span>
                    <IconChevronRight size={20} aria-hidden="true" className="shrink-0 text-gray-500" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {!focus && onlineMethods.length > 0 && (
        <p className="flex items-start gap-2.5 rounded-2xl bg-blue-50 p-4 text-sm leading-snug text-blue-900">
          <IconInfoCircle size={20} aria-hidden="true" className="mt-px shrink-0" />{t.onlineInfo}
        </p>
      )}
    </div>
  );
}
