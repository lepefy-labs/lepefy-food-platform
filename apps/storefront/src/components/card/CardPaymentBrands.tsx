import { IconLock } from '@tabler/icons-react';
import type { CardPaymentBrand, CardPaymentBrandStrip, CardPaymentChip } from '@/lib/card/cardPaymentBrands';

type Lang = 'fr' | 'it';

const COPY = {
  fr: { title: 'Moyens de paiement acceptés', stripe: 'Carte sécurisée par Stripe', also: 'Aussi :', bank_transfer: 'virement', cash: 'espèces' },
  it: { title: 'Metodi di pagamento accettati', stripe: 'Carta protetta da Stripe', also: 'Anche:', bank_transfer: 'bonifico', cash: 'contanti' },
} as const;

// Marques d'acceptation : tracés Simple Icons (CC0) pour Visa, Apple Pay et le
// monogramme PayPal, cercles Mastercard aux couleurs officielles. Affichés sans
// déformation ni recoloration fantaisiste, uniquement pour dire « accepté ici ».
const VISA_PATH = 'M9.112 8.262L5.97 15.758H3.92L2.374 9.775c-.094-.368-.175-.503-.461-.658C1.447 8.864.677 8.627 0 8.479l.046-.217h3.3a.904.904 0 01.894.764l.817 4.338 2.018-5.102zm8.033 5.049c.008-1.979-2.736-2.088-2.717-2.972.006-.269.262-.555.822-.628a3.66 3.66 0 011.913.336l.34-1.59a5.207 5.207 0 00-1.814-.333c-1.917 0-3.266 1.02-3.278 2.479-.012 1.079.963 1.68 1.698 2.04.756.367 1.01.603 1.006.931-.005.504-.602.725-1.16.734-.975.015-1.54-.263-1.992-.473l-.351 1.642c.453.208 1.289.39 2.156.398 2.037 0 3.37-1.006 3.377-2.564m5.061 2.447H24l-1.565-7.496h-1.656a.883.883 0 00-.826.55l-2.909 6.946h2.036l.405-1.12h2.488zm-2.163-2.656l1.02-2.815.588 2.815zm-8.16-4.84l-1.603 7.496H8.34l1.605-7.496z';
const APPLE_PAY_PATH = 'M2.15 4.318a42.16 42.16 0 0 0-.454.003c-.15.005-.303.013-.452.04a1.44 1.44 0 0 0-1.06.772c-.07.138-.114.278-.14.43-.028.148-.037.3-.04.45A10.2 10.2 0 0 0 0 6.222v11.557c0 .07.002.138.003.207.004.15.013.303.04.452.027.15.072.291.142.429a1.436 1.436 0 0 0 .63.63c.138.07.278.115.43.142.148.027.3.036.45.04l.208.003h20.194l.207-.003c.15-.004.303-.013.452-.04.15-.027.291-.071.428-.141a1.432 1.432 0 0 0 .631-.631c.07-.138.115-.278.141-.43.027-.148.036-.3.04-.45.002-.07.003-.138.003-.208l.001-.246V6.221c0-.07-.002-.138-.004-.207a2.995 2.995 0 0 0-.04-.452 1.446 1.446 0 0 0-1.2-1.201 3.022 3.022 0 0 0-.452-.04 10.448 10.448 0 0 0-.453-.003zm0 .512h19.942c.066 0 .131.002.197.003.115.004.25.01.375.032.109.02.2.05.287.094a.927.927 0 0 1 .407.407.997.997 0 0 1 .094.288c.022.123.028.258.031.374.002.065.003.13.003.197v11.552c0 .065 0 .13-.003.196-.003.115-.009.25-.032.375a.927.927 0 0 1-.5.693 1.002 1.002 0 0 1-.286.094 2.598 2.598 0 0 1-.373.032l-.2.003H1.906c-.066 0-.133-.002-.196-.003a2.61 2.61 0 0 1-.375-.032c-.109-.02-.2-.05-.288-.094a.918.918 0 0 1-.406-.407 1.006 1.006 0 0 1-.094-.288 2.531 2.531 0 0 1-.032-.373 9.588 9.588 0 0 1-.002-.197V6.224c0-.065 0-.131.002-.197.004-.114.01-.248.032-.375.02-.108.05-.199.094-.287a.925.925 0 0 1 .407-.406 1.03 1.03 0 0 1 .287-.094c.125-.022.26-.029.375-.032.065-.002.131-.002.196-.003zm4.71 3.7c-.3.016-.668.199-.88.456-.191.22-.36.58-.316.918.338.03.675-.169.888-.418.205-.258.345-.603.308-.955zm2.207.42v5.493h.852v-1.877h1.18c1.078 0 1.835-.739 1.835-1.812 0-1.07-.742-1.805-1.808-1.805zm.852.719h.982c.739 0 1.161.396 1.161 1.089 0 .692-.422 1.092-1.164 1.092h-.979zm-3.154.3c-.45.01-.83.28-1.05.28-.235 0-.593-.264-.981-.257a1.446 1.446 0 0 0-1.23.747c-.527.908-.139 2.255.374 2.995.249.366.549.769.944.754.373-.014.52-.242.973-.242.454 0 .586.242.98.235.41-.007.667-.366.915-.733.286-.417.403-.82.41-.841-.007-.008-.79-.308-.797-1.209-.008-.754.615-1.113.644-1.135-.352-.52-.9-.578-1.09-.593a1.123 1.123 0 0 0-.092-.002zm8.204.397c-.99 0-1.606.533-1.652 1.256h.777c.072-.358.369-.586.845-.586.502 0 .803.266.803.711v.309l-1.097.064c-.951.054-1.488.484-1.488 1.184 0 .72.548 1.207 1.332 1.207.526 0 1.032-.281 1.264-.727h.019v.659h.788v-2.76c0-.803-.62-1.317-1.591-1.317zm1.94.072l1.446 4.009c0 .003-.073.24-.073.247-.125.41-.33.571-.711.571-.069 0-.206 0-.267-.015v.666c.06.011.267.019.335.019.83 0 1.226-.312 1.568-1.283l1.5-4.214h-.868l-1.012 3.259h-.015l-1.013-3.26zm-1.167 2.189v.316c0 .521-.45.917-1.024.917-.442 0-.731-.228-.731-.579 0-.342.278-.56.769-.593z';
const PAYPAL_PATH = 'M7.016 19.198h-4.2a.562.562 0 0 1-.555-.65L5.093.584A.692.692 0 0 1 5.776 0h7.222c3.417 0 5.904 2.488 5.846 5.5-.006.25-.027.5-.066.747A6.794 6.794 0 0 1 12.071 12H8.743a.69.69 0 0 0-.682.583l-.325 2.056-.013.083-.692 4.39-.015.087zM19.79 6.142c-.01.087-.01.175-.023.261a7.76 7.76 0 0 1-7.695 6.598H9.007l-.283 1.795-.013.083-.692 4.39-.134.843-.014.088H6.86l-.497 3.15a.562.562 0 0 0 .555.65h3.612c.34 0 .63-.249.683-.585l.952-6.031a.692.692 0 0 1 .683-.584h2.126a6.793 6.793 0 0 0 6.707-5.752c.306-1.95-.466-3.744-1.89-4.906z';

export function PaymentBrandMark({ brand, size = 'md' }: { brand: CardPaymentBrand; size?: 'sm' | 'md' }) {
  const h = size === 'sm' ? 18 : 24;
  switch (brand) {
    case 'visa':
      return <svg role="img" aria-label="Visa" viewBox="0 7.6 24 8.8" height={h * 0.8} width={h * 2.2}><path fill="#1A1F71" d={VISA_PATH} /></svg>;
    case 'mastercard':
      return (
        <svg role="img" aria-label="Mastercard" viewBox="0 0 38 24" height={h} width={h * 38 / 24}>
          <defs><clipPath id="card-mc-left"><circle cx="13" cy="12" r="10" /></clipPath></defs>
          <circle cx="13" cy="12" r="10" fill="#EB001B" />
          <circle cx="25" cy="12" r="10" fill="#F79E1B" />
          <circle cx="25" cy="12" r="10" fill="#FF5F00" clipPath="url(#card-mc-left)" />
        </svg>
      );
    case 'apple_pay':
      return <svg role="img" aria-label="Apple Pay" viewBox="0 4.2 24 15.6" height={h * 1.05} width={h * 1.05 * 24 / 15.6}><path fill="#000" d={APPLE_PAY_PATH} /></svg>;
    case 'paypal':
      return (
        <span role="img" aria-label="PayPal" className="inline-flex items-center gap-1">
          <svg aria-hidden="true" viewBox="0 0 24 24" height={h * 0.85} width={h * 0.85}><path fill="#003087" d={PAYPAL_PATH} /></svg>
          <span aria-hidden="true" className="font-extrabold italic tracking-tight" style={{ fontSize: h * 0.68 }}><span style={{ color: '#003087' }}>Pay</span><span style={{ color: '#0070E0' }}>Pal</span></span>
        </span>
      );
    case 'satispay':
      return <span role="img" aria-label="Satispay" className="font-extrabold tracking-tight" style={{ color: '#D7262F', fontSize: h * 0.7 }}>satispay</span>;
    case 'revolut':
      return <span role="img" aria-label="Revolut" className="font-extrabold tracking-tight" style={{ color: '#191C1F', fontSize: h * 0.7 }}>Revolut</span>;
  }
}

/** Fascia orizzontale compacte sous les CTA : uniquement les moyens réellement proposés, logos sur une ligne. */
export function CardPaymentBrands({ strip, lang, className = '' }: { strip: CardPaymentBrandStrip; lang: Lang; className?: string }) {
  const t = COPY[lang];
  if (strip.brands.length === 0 && strip.chips.length === 0) return null;
  const others = strip.chips.map((chip: CardPaymentChip) => t[chip]).join(', ');
  return (
    <section aria-label={t.title} className={`rounded-2xl bg-white px-2.5 py-2 shadow-[0_1px_2px_rgba(17,24,39,0.06)] ring-1 ring-black/[0.04] ${className}`}>
      <h2 className="sr-only">{t.title}</h2>
      {strip.brands.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5">
          {strip.brands.map((brand) => (
            <li key={brand} className="flex h-9 min-w-[2.75rem] items-center justify-center rounded-lg border border-gray-200 bg-white px-2">
              <PaymentBrandMark brand={brand} size="sm" />
            </li>
          ))}
        </ul>
      )}
      {(strip.processedByStripe || others) && (
        <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-gray-700 ${strip.brands.length > 0 ? 'mt-1.5' : ''}`}>
          {strip.processedByStripe && <span className="inline-flex items-center gap-1"><IconLock size={14} aria-hidden="true" />{t.stripe}</span>}
          {strip.processedByStripe && others && <span aria-hidden="true">·</span>}
          {others && <span>{t.also} {others}</span>}
        </p>
      )}
    </section>
  );
}
