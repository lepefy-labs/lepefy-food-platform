'use client';

import { useEffect, useState } from 'react';
import { IconArrowLeft, IconChevronRight, IconLock } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { StripePaymentStep } from '@/components/payments/StripePaymentStep';
import { StripeExpressWalletStep } from '@/components/payments/StripeExpressWalletStep';
import { cardPaymentReference, paymentIntentIdFromSecret, rememberCardPayment, type CardPaymentReceipt } from '@/lib/card/cardPaymentOutcome';
import { CardPaymentResult } from './CardPaymentResult';

const MIN_AMOUNT = 1;
const MAX_AMOUNT = 2000;
type Lang = 'fr' | 'it';
export type CardQuickPayStage = 'amount' | 'payment' | 'done';

const COPY = {
  fr: { title:'Paiement par carte', step1:'Étape 1 sur 2', step2:'Étape 2 sur 2', amount:'Combien payez-vous ?', amountPlaceholder:'0,00', range:(min:string,max:string)=>`Entre ${min} et ${max}`, name:'Votre nom', namePlaceholder:'Aïcha Mballa', email:'Email pour recevoir votre confirmation', emailHint:'Nous l’utiliserons pour vous envoyer la confirmation de ce paiement.', emailPlaceholder:'nom@email.com', continue:'Continuer vers le paiement', processing:'Traitement en cours…', pay:'Payer', toPay:'Montant à payer', edit:'Modifier', secure:'Paiement sécurisé par Stripe', back:'Retour', generic:'Une erreur est survenue. Veuillez réessayer.', invalid:`Le montant doit être compris entre ${MIN_AMOUNT} et ${MAX_AMOUNT} €.`, billing:'Si un pays est demandé ci-dessous, indiquez celui associé à votre carte bancaire (facturation), pas votre position actuelle.', warning:'N’interrompez pas le paiement : après l’initialisation, ne fermez pas et n’actualisez pas cette page jusqu’à la confirmation.',
        applePayTitle:'Apple Pay', wallet:{ secureTitle:'Paiement sécurisé', faceIdHint:'Vous confirmerez avec Face ID ou Touch ID.', notShowingHint:'Apple Pay ne s’affiche pas ? Revenez en arrière et choisissez Carte bancaire.', unavailableTitle:'Apple Pay n’est pas disponible sur cet appareil', unavailableText:'Aucune carte n’est configurée dans Apple Wallet, ou ce navigateur ne permet pas Apple Pay.', useCard:'Payer par carte bancaire', loading:'Chargement d’Apple Pay…' } },
  it: { title:'Pagamento con carta', step1:'Passaggio 1 di 2', step2:'Passaggio 2 di 2', amount:'Quanto paghi?', amountPlaceholder:'0,00', range:(min:string,max:string)=>`Tra ${min} e ${max}`, name:'Nome', namePlaceholder:'Aïcha Mballa', email:'Email per ricevere la conferma', emailHint:'La useremo per inviarti la conferma di questo pagamento.', emailPlaceholder:'nome@email.com', continue:'Continua verso il pagamento', processing:'Elaborazione in corso…', pay:'Paga', toPay:'Importo da pagare', edit:'Modifica', secure:'Pagamento sicuro con Stripe', back:'Indietro', generic:'Si è verificato un errore. Riprova.', invalid:`L'importo deve essere compreso tra ${MIN_AMOUNT} e ${MAX_AMOUNT} €.`, billing:'Se viene richiesto un paese qui sotto, indica quello associato alla tua carta (fatturazione), non la tua posizione attuale.', warning:'Non interrompere il pagamento: dopo l’avvio, non chiudere e non aggiornare questa pagina fino alla conferma.',
        applePayTitle:'Apple Pay', wallet:{ secureTitle:'Pagamento sicuro', faceIdHint:'Confermerai con Face ID o Touch ID.', notShowingHint:'Apple Pay non compare? Torna indietro e scegli Carta bancaria.', unavailableTitle:'Apple Pay non è disponibile su questo dispositivo', unavailableText:'Nessuna carta configurata in Apple Wallet, oppure questo browser non supporta Apple Pay.', useCard:'Paga con carta bancaria', loading:'Caricamento di Apple Pay…' } },
} as const;

function isValidEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }

// mode="apple_pay" : même étape 1 (montant, nom, email, même validation),
// étape 2 = bouton Apple Pay seul (StripeExpressWalletStep) au lieu du
// formulaire carte. tenantColor vaut alors le noir Apple Pay (methodColor).
// Le retour après une redirection (banque, méthode redirect-based) est géré par
// DigitalCard (useCardPaymentReturn) : ce composant n’est pas monté à ce moment-là.
// `embedded` : affiché sous les tuiles de PaymentMethodsAccordion (étape 1 sans
// bouton retour ni titre) ; `onStageChange` permet au parent de masquer ses
// tuiles pendant l'étape Stripe et l'écran d'issue (aucun changement de
// méthode possible pendant une confirmation).
export function CardQuickPay({ tenantColor, currency, lang, onBack, onReturnToCard, mode = 'card', onUseCard, tenantName, shop, embedded = false, onStageChange }: { tenantColor:string; currency:string; lang:Lang; onBack:()=>void; onReturnToCard:()=>void; mode?:'card'|'apple_pay'; onUseCard?:()=>void; tenantName:string; shop:{ color:string; foreground:string }|null; embedded?:boolean; onStageChange?:(stage:CardQuickPayStage)=>void }) {
  const t = COPY[lang];
  const [amount,setAmount]=useState(''); const [customerName,setCustomerName]=useState(''); const [customerEmail,setCustomerEmail]=useState('');
  const [step,setStep]=useState<1|2>(1); const [confirmedAmount,setConfirmedAmount]=useState(0); const [error,setError]=useState<string|null>(null); const [paid,setPaid]=useState(false);
  const [receipt,setReceipt]=useState<CardPaymentReceipt|null>(null);
  const stage: CardQuickPayStage = paid ? 'done' : step === 2 ? 'payment' : 'amount';

  useEffect(() => { onStageChange?.(stage); }, [stage, onStageChange]);

  function handleContinue(){ const parsed=parseFloat(amount.replace(',','.')); if(!Number.isFinite(parsed)||parsed<MIN_AMOUNT||parsed>MAX_AMOUNT){setError(t.invalid);return;} if(customerEmail&&!isValidEmail(customerEmail)){setError(t.generic);return;} setError(null);setConfirmedAmount(parsed);setStep(2); }
  async function createIntent(){ try{ const res=await fetch('/api/card/quick-pay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:confirmedAmount,customerName:customerName.trim()||null,customerEmail:customerEmail.trim()||null})}); const data=await res.json(); if(!res.ok)return{error:data.error??t.generic}; const next:CardPaymentReceipt={amount:confirmedAmount,reference:data.quickPaymentId?cardPaymentReference(data.quickPaymentId as string):null,email:customerEmail.trim()||null}; setReceipt(next); const intentId=paymentIntentIdFromSecret(data.clientSecret); if(intentId)rememberCardPayment(intentId,next); return{clientSecret:data.clientSecret,reference_id:data.quickPaymentId as string}; }catch{return{error:t.generic};} }

  if(paid) return <CardPaymentResult outcome="succeeded" receipt={receipt??{amount:confirmedAmount,reference:null,email:customerEmail.trim()||null}} currency={currency} lang={lang} tenantName={tenantName} shop={shop} onReturnToCard={onReturnToCard}/>;

  const ring = { '--tw-ring-color': tenantColor } as React.CSSProperties;
  const backButton = (onClick: () => void) => <button type="button" onClick={onClick} className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm ring-1 ring-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"><IconArrowLeft size={18} aria-hidden="true"/>{t.back}</button>;
  const secure = <p className="mt-4 flex items-center justify-center gap-1.5 text-xs font-medium text-gray-700"><IconLock size={14} aria-hidden="true"/>{t.secure}</p>;

  if (step === 2) return <div>
    {backButton(()=>{setError(null);setStep(1)})}
    <p className="text-sm font-bold" style={{color:tenantColor==='#000000'?'#111827':tenantColor}}>{t.step2}</p>
    <h2 className="mt-1 text-2xl font-extrabold text-gray-900" style={{fontFamily:'var(--font-card-heading)'}}>{mode==='apple_pay'?t.applePayTitle:t.title}</h2>
    <div className="my-5 flex items-center justify-between gap-3 rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgba(17,24,39,0.06)] ring-1 ring-black/[0.04]">
      <div><p className="text-sm font-medium text-gray-700">{t.toPay}</p><p className="mt-1 text-4xl font-extrabold text-gray-950" style={{fontFamily:'var(--font-card-heading)'}}>{formatPrice(confirmedAmount,currency)}</p></div>
      <button type="button" onClick={()=>{setError(null);setStep(1)}} className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-bold text-gray-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2" style={ring}>{t.edit}</button>
    </div>
    {mode==='apple_pay'?<StripeExpressWalletStep module="card" amount={confirmedAmount} currency={currency} returnUrl={`${window.location.origin}/card`} locale={lang} labels={t.wallet} createIntent={createIntent} onError={setError} onSucceeded={()=>setPaid(true)} onUseCard={onUseCard}/>:<StripePaymentStep module="card" amount={confirmedAmount} currency={currency} color={tenantColor} returnUrl={`${window.location.origin}/card`} referenceId={null} payLabel={`${t.pay} ${formatPrice(confirmedAmount,currency)}`} processingLabel={t.processing} billingCountryHint={t.billing} paymentWarning={t.warning} locale={lang} createIntent={createIntent} onError={setError} onSucceeded={()=>setPaid(true)}/>}
    {error&&<p role="alert" className="mt-3 text-sm font-medium text-red-700">{error}</p>}
    {secure}
  </div>;

  return <div>
    {!embedded && backButton(onBack)}
    {!embedded && <h2 className="mb-4 text-2xl font-extrabold text-gray-900" style={{fontFamily:'var(--font-card-heading)'}}>{mode==='apple_pay'?t.applePayTitle:t.title}</h2>}
    <form noValidate onSubmit={e=>{e.preventDefault();handleContinue();}} className="space-y-4">
      <div className="rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgba(17,24,39,0.06)] ring-1 ring-black/[0.04]">
        <p className="mb-2 text-sm font-bold" style={{color:tenantColor==='#000000'?'#111827':tenantColor}}>{t.step1}</p>
        <label className="block" htmlFor="card-quick-pay-amount"><span className="block text-lg font-extrabold text-gray-900" style={{fontFamily:'var(--font-card-heading)'}}>{t.amount}</span></label>
        <div className="relative mt-3">
          <input id="card-quick-pay-amount" type="number" inputMode="decimal" min={MIN_AMOUNT} max={MAX_AMOUNT} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder={t.amountPlaceholder} aria-describedby="card-quick-pay-range" className="sf-control !min-h-[84px] !rounded-2xl pr-14 !text-[2.5rem] font-extrabold tracking-tight [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" style={{fontFamily:'var(--font-card-heading)'}}/>
          <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-3xl font-extrabold text-gray-700" aria-hidden="true">€</span>
        </div>
        <p id="card-quick-pay-range" className="sf-hint mt-2">{t.range(formatPrice(MIN_AMOUNT,currency),formatPrice(MAX_AMOUNT,currency))}</p>
      </div>
      <div className="space-y-4 rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgba(17,24,39,0.06)] ring-1 ring-black/[0.04]">
        <label className="block"><span className="sf-label mb-2">{t.name}</span><input type="text" autoComplete="name" value={customerName} onChange={e=>setCustomerName(e.target.value)} placeholder={t.namePlaceholder} className="sf-control sf-control--md"/></label>
        <label className="block"><span className="sf-label mb-2">{t.email}</span><input type="email" inputMode="email" autoComplete="email" aria-describedby="card-quick-pay-email-hint" value={customerEmail} onChange={e=>setCustomerEmail(e.target.value)} placeholder={t.emailPlaceholder} className="sf-control sf-control--md"/><span id="card-quick-pay-email-hint" className="sf-hint mt-1.5 block">{t.emailHint}</span></label>
      </div>
      {error&&<p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
      <button type="submit" disabled={!amount} className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-lg font-extrabold text-white transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none" style={{backgroundColor:tenantColor,fontFamily:'var(--font-card-heading)',...ring}}>{t.continue}<IconChevronRight size={20} aria-hidden="true"/></button>
    </form>
    {secure}
  </div>;
}
