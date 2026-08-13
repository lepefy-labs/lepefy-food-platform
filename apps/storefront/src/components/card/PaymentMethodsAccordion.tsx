'use client';

import { useState } from 'react';
import {
  IconBuildingBank,
  IconCash,
  IconBrandPaypal,
  IconQrcode,
  IconWallet,
  IconCreditCard,
  IconCopy,
  IconCheck,
  IconChevronRight,
  IconExternalLink,
} from '@tabler/icons-react';
import { PAYMENT_METHOD_REGISTRY, type TenantPaymentMethod } from '@lepefy/types';
import { CardQuickPay } from './CardQuickPay';
import { methodColor, hexToRgba, isEmailValue } from '@/lib/card/methodColor';

const PAYMENT_ICONS = {
  IconBuildingBank,
  IconCash,
  IconBrandPaypal,
  IconQrcode,
  IconWallet,
  IconCreditCard,
};

type Lang = 'fr' | 'it';

// Aucun type `revolut` dédié dans le schéma (limitation de l'enum
// `tenant_payment_methods.method`) — Revolut reste `method: 'other'` côté
// données, distingué uniquement côté affichage via le label. Ne pas ajouter
// de migration pour ça : le contrat `tenant_payment_methods` n'est pas dans
// le scope de ce redesign.
function isRevolut(label: string | null): boolean {
  return /revolut/i.test(label ?? '');
}

interface AccordionCopy {
  payTitle:         string;
  subtitle:         string;
  copy:             string;
  copied:           string;
  cashNote:         string;
  cardDesc:         string;
  bankDesc:         string;
  paypalDesc:       string;
  satispayDesc:     string;
  revolutDesc:      string;
  otherDesc:        string;
  beneficiaryLabel: string;
  openLink:         (label: string) => string;
  copyIbanAria:     string;
  copyValueAria:    (label: string) => string;
}

const COPY: Record<Lang, AccordionCopy> = {
  fr: {
    payTitle:     'Comment payer',
    subtitle:     'Choisissez le mode de paiement qui vous convient.',
    copy:         'Copier',
    copied:       'Copié !',
    cashNote:     'Espèces acceptées en boutique',
    cardDesc:     'Visa, Mastercard et plus',
    bankDesc:     'Effectuez un virement sur notre compte',
    paypalDesc:   'Paiement rapide et sécurisé',
    satispayDesc: 'Payez avec l\'app Satispay',
    revolutDesc:  'Envoyez votre paiement via Revolut',
    otherDesc:    'Moyen de paiement alternatif',
    beneficiaryLabel: 'Bénéficiaire',
    openLink:      (label) => `Ouvrir ${label}`,
    copyIbanAria:  'Copier l\'IBAN',
    copyValueAria: (label) => `Copier ${label}`,
  },
  it: {
    payTitle:     'Come pagare',
    subtitle:     'Scegli il metodo di pagamento che preferisci.',
    copy:         'Copia',
    copied:       'Copiato!',
    cashNote:     'Contanti accettati in negozio',
    cardDesc:     'Visa, Mastercard e altro',
    bankDesc:     'Effettua un bonifico sul nostro conto',
    paypalDesc:   'Pagamento rapido e sicuro',
    satispayDesc: 'Paga con l\'app Satispay',
    revolutDesc:  'Invia il pagamento tramite Revolut',
    otherDesc:    'Metodo di pagamento alternativo',
    beneficiaryLabel: 'Beneficiario',
    openLink:      (label) => `Apri ${label}`,
    copyIbanAria:  'Copia IBAN',
    copyValueAria: (label) => `Copia ${label}`,
  },
};

// ─── Copy affordances — logique de copie inchangée (navigator.clipboard),
// seule l'affordance visuelle change : icône + libellé texte visible au lieu
// d'une icône isolée, cf. demande de redesign.

function CopyableValue({
  value, displayValue, color, copyLabel, copiedLabel, ariaLabel,
}: {
  value: string; displayValue?: string; color: string; copyLabel: string; copiedLabel: string; ariaLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={ariaLabel ?? copyLabel}
      className="flex items-center justify-between w-full gap-2 rounded-lg px-3 py-2 text-left border-2 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-primary)]"
      style={{
        backgroundColor: hexToRgba(color, copied ? 0.16 : 0.09),
        borderColor: hexToRgba(color, copied ? 0.5 : 0.3),
      }}
    >
      <span className="font-mono text-xs font-medium text-gray-800 truncate">{displayValue ?? value}</span>
      <span className="flex items-center gap-1 text-xs font-semibold shrink-0" style={{ color }}>
        {copied ? <IconCheck size={16} stroke={2.2} /> : <IconCopy size={16} stroke={2} />}
        {copied ? copiedLabel : copyLabel}
      </span>
    </button>
  );
}

function CopyableLine({ label, value, className }: { label?: string; value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={`${label ? `${label}: ` : ''}${value}`}
      className={`flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-primary)] rounded ${className ?? ''}`}
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

function ExternalLinkCta({ href, label, color }: { href: string; label: string; color: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-1.5 w-full rounded-lg border-2 py-2 text-xs font-semibold bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-primary)]"
      style={{ borderColor: color, color }}
    >
      <IconExternalLink size={14} stroke={2} />
      {label}
    </a>
  );
}

// Un item n'est un accordéon cliquable que s'il a effectivement du contenu à
// déplier — Espèces (et tout moyen 'other' laissé vide côté admin) reste un
// simple encart informatif, jamais un déclencheur sans effet.
function hasExpandableContent(pm: TenantPaymentMethod): boolean {
  if (pm.method === 'card') return true;
  if (pm.extra?.link) return true;
  return Boolean(pm.value);
}

function methodDescription(pm: TenantPaymentMethod, t: AccordionCopy): string | null {
  switch (pm.method) {
    case 'card':           return t.cardDesc;
    case 'bank_transfer':  return t.bankDesc;
    case 'paypal':         return t.paypalDesc;
    case 'satispay':       return t.satispayDesc;
    case 'cash':           return t.cashNote;
    case 'other':          return isRevolut(pm.label) ? t.revolutDesc : t.otherDesc;
    default:                return null;
  }
}

function AccordionBody({
  pm, color, currency, lang, t,
}: {
  pm: TenantPaymentMethod; color: string; currency: string; lang: Lang; t: AccordionCopy;
}) {
  const title = pm.label ?? PAYMENT_METHOD_REGISTRY[pm.method].label;

  if (pm.method === 'card') {
    return <CardQuickPay tenantColor={color} currency={currency} lang={lang} />;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {pm.extra?.link && (
        <ExternalLinkCta href={pm.extra.link} label={t.openLink(title)} color={color} />
      )}

      {pm.method === 'bank_transfer' && pm.value && (
        <div className="flex flex-col gap-2.5">
          {pm.extra?.beneficiary && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">{t.beneficiaryLabel}</p>
              <CopyableLine value={pm.extra.beneficiary} className="text-xs text-gray-700 font-semibold" />
            </div>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">IBAN</p>
            <CopyableValue
              value={pm.value}
              displayValue={pm.value}
              color={color}
              copyLabel={t.copy}
              copiedLabel={t.copied}
              ariaLabel={t.copyIbanAria}
            />
          </div>
          {pm.extra?.bic && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">BIC</p>
              <CopyableLine value={pm.extra.bic} className="text-xs text-gray-500" />
            </div>
          )}
        </div>
      )}

      {pm.method === 'satispay' && pm.value && (
        <ExternalLinkCta href={pm.value} label={t.openLink(title)} color={color} />
      )}

      {pm.method === 'paypal' && pm.value && (
        isEmailValue(pm.value) ? (
          <CopyableValue
            value={pm.value}
            color={color}
            copyLabel={t.copy}
            copiedLabel={t.copied}
            ariaLabel={t.copyValueAria(title)}
          />
        ) : (
          <ExternalLinkCta href={pm.value} label={t.openLink(title)} color={color} />
        )
      )}

      {pm.method === 'other' && pm.value && (
        <p className="text-xs text-gray-600">{pm.value}</p>
      )}
    </div>
  );
}

function AccordionItem({
  pm, primaryColor, currency, lang, t, isOpen, hasOpenedOnce, onToggle,
}: {
  pm:            TenantPaymentMethod;
  primaryColor:  string;
  currency:      string;
  lang:          Lang;
  t:             AccordionCopy;
  isOpen:        boolean;
  hasOpenedOnce: boolean;
  onToggle:      () => void;
}) {
  const meta        = PAYMENT_METHOD_REGISTRY[pm.method];
  const Icon         = PAYMENT_ICONS[meta.iconName];
  const title         = pm.label ?? meta.label;
  const description   = methodDescription(pm, t);
  const color          = methodColor(pm.method, primaryColor);
  const expandable     = hasExpandableContent(pm);
  const contentId      = `payment-method-panel-${pm.id}`;

  const header = (
    <div className="flex items-center gap-2.5">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: color }}
      >
        <Icon size={16} stroke={1.8} className="text-white" />
      </div>
      <span className="flex-1 min-w-0 text-left">
        <span className="block text-sm font-bold text-gray-800" style={{ fontFamily: 'var(--font-card-heading)' }}>
          {title}
        </span>
        {description && (
          <span className="block text-xs text-gray-400 mt-0.5 truncate">{description}</span>
        )}
      </span>
      {expandable && (
        <IconChevronRight
          size={16}
          stroke={2}
          className={`shrink-0 text-gray-300 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
        />
      )}
    </div>
  );

  return (
    <div
      className="rounded-2xl p-3.5 transition-colors duration-200"
      style={{
        background: hexToRgba(color, 0.08),
        border: isOpen
          ? `2px solid ${hexToRgba(primaryColor, 0.55)}`
          : `1px solid ${hexToRgba(color, 0.25)}`,
      }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={contentId}
          className="w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)]"
        >
          {header}
        </button>
      ) : (
        header
      )}

      {expandable && (
        <div
          id={contentId}
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            {hasOpenedOnce && (
              <div className="pt-3 mt-2 pl-[42px] border-t border-dashed border-gray-200">
                <AccordionBody pm={pm} color={color} currency={currency} lang={lang} t={t} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PaymentMethodsAccordion({
  paymentMethods, primaryColor, currency, lang,
}: {
  paymentMethods: TenantPaymentMethod[];
  primaryColor:   string;
  currency:       string;
  lang:           Lang;
}) {
  const t = COPY[lang];

  // Une seule card ouverte à la fois — état contrôlé, jamais d'accordéon
  // multi-ouvert. `openedIds` garde en mémoire les items déjà ouverts au
  // moins une fois : le contenu (dont le module Stripe pour 'card', chargé
  // paresseusement par CardQuickPay) reste monté après une première ouverture
  // pour que l'animation de fermeture ait un contenu à animer, au lieu de se
  // couper net.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openedIds, setOpenedIds]   = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpandedId((cur) => (cur === id ? null : id));
    setOpenedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  if (paymentMethods.length === 0) return null;

  return (
    <div className="mb-4">
      <p className="text-xs text-gray-400" style={{ fontFamily: 'var(--font-card-heading)' }}>{t.payTitle}</p>
      <p className="text-[11px] text-gray-400 mb-2">{t.subtitle}</p>
      <div className="flex flex-col gap-2">
        {paymentMethods.map((pm) => (
          <AccordionItem
            key={pm.id}
            pm={pm}
            primaryColor={primaryColor}
            currency={currency}
            lang={lang}
            t={t}
            isOpen={expandedId === pm.id}
            hasOpenedOnce={openedIds.has(pm.id)}
            onToggle={() => toggle(pm.id)}
          />
        ))}
      </div>
    </div>
  );
}
