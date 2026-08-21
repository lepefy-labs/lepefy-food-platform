'use client';

import { useState } from 'react';
import { IconArrowLeft, IconCheck, IconLock } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { StripePaymentStep } from '@/components/payments/StripePaymentStep';
import { usePaymentRedirectRecovery } from '@/lib/payments/usePaymentRedirectRecovery';

const MIN_AMOUNT = 1;
const MAX_AMOUNT = 2000;
type Lang = 'fr' | 'it';

const COPY = {
  fr: { title:'Paiement par carte', step1:'Étape 1 sur 2', step2:'Étape 2 sur 2', amount:'Montant à payer', amountPlaceholder:'0,00', name:'Votre nom', namePlaceholder:'Jean Dupont', email:'Votre email', emailPlaceholder:'nom@email.com', continue:'Continuer', processing:'Traitement en cours…', pay:'Payer', secure:'Paiement sécurisé par Stripe', thanks:'Merci !', received:'Paiement reçu.', back:'Retour', returnCard:'Retour à la carte', generic:'Une erreur est survenue. Veuillez réessayer.', invalid:`Le montant doit être compris entre ${MIN_AMOUNT} et ${MAX_AMOUNT} €.`, billing:'Si un pays est demandé ci-dessous, indiquez celui associé à votre carte bancaire (facturation), pas votre position actuelle.' },
  it: { title:'Pagamento con carta', step1:'Passaggio 1 di 2', step2:'Passaggio 2 di 2', amount:'Importo da pagare', amountPlaceholder:'0,00', name:'Nome', namePlaceholder:'Mario Rossi', email:'Email', emailPlaceholder:'nome@email.com', continue:'Continua', processing:'Elaborazione in corso…', pay:'Paga', secure:'Pagamento sicuro con Stripe', thanks:'Grazie!', received:'Pagamento ricevuto.', back:'Indietro', returnCard:'Torna alla card', generic:'Si è verificato un errore. Riprova.', invalid:`L'importo deve essere compreso tra ${MIN_AMOUNT} e ${MAX_AMOUNT} €.`, billing:'Se viene richiesto un paese qui sotto, indica quello associato alla tua carta (fatturazione), non la tua posizione attuale.' },
} as const;

function isValidEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }

export function CardQuickPay({ tenantColor, currency, lang, onBack, onReturnToCard }: { tenantColor:string; currency:string; lang:Lang; onBack:()=>void; onReturnToCard:()=>void }) {
  const t = COPY[lang];
  const [amount,setAmount]=useState(''); const [customerName,setCustomerName]=useState(''); const [customerEmail,setCustomerEmail]=useState('');
  const [step,setStep]=useState<1|2>(1); const [confirmedAmount,setConfirmedAmount]=useState(0); const [error,setError]=useState<string|null>(null); const [paid,setPaid]=useState(false);
  usePaymentRedirectRecovery('card', () => setPaid(true));

  function handleContinue(){ const parsed=parseFloat(amount.replace(',','.')); if(!Number.isFinite(parsed)||parsed<MIN_AMOUNT||parsed>MAX_AMOUNT){setError(t.invalid);return;} if(customerEmail&&!isValidEmail(customerEmail)){setError(t.generic);return;} setError(null);setConfirmedAmount(parsed);setStep(2); }
  async function createIntent(){ try{ const res=await fetch('/api/card/quick-pay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:confirmedAmount,customerName:customerName.trim()||null,customerEmail:customerEmail.trim()||null})}); const data=await res.json(); if(!res.ok)return{error:data.error??t.generic}; return{clientSecret:data.clientSecret,reference_id:data.quickPaymentId as string}; }catch{return{error:t.generic};} }

  if(paid) return <div className="py-8 text-center"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full" style={{backgroundColor:`${tenantColor}14`,color:tenantColor}}><IconCheck size={32} stroke={2.2}/></div><h2 className="text-2xl font-bold text-gray-900" style={{fontFamily:'var(--font-card-heading)'}}>{t.thanks}</h2><p className="mt-1 text-sm text-gray-500">{t.received}</p>{confirmedAmount>0&&<p className="mt-4 text-3xl font-extrabold text-gray-900">{formatPrice(confirmedAmount,currency)}</p>}<button type="button" onClick={onReturnToCard} className="mt-8 min-h-12 w-full rounded-xl px-4 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2" style={{backgroundColor:tenantColor}}>{t.returnCard}</button></div>;

  return <div>
    <button type="button" onClick={step===2?()=>{setError(null);setStep(1)}:onBack} className="mb-5 flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-medium text-gray-600 focus-visible:outline-none focus-visible:ring-2" style={{'--tw-ring-color':tenantColor} as React.CSSProperties}><IconArrowLeft size={18}/>{t.back}</button>
    <div className="mb-6"><p className="text-xs font-semibold uppercase tracking-wide" style={{color:tenantColor}}>{step===1?t.step1:t.step2}</p><h2 className="mt-1 text-2xl font-bold text-gray-900" style={{fontFamily:'var(--font-card-heading)'}}>{t.title}</h2></div>
    {step===1 ? <div className="space-y-5">
      <label className="block"><span className="mb-2 block text-sm font-semibold text-gray-700">{t.amount}</span><div className="relative"><input aria-label={t.amount} type="number" inputMode="decimal" min={MIN_AMOUNT} max={MAX_AMOUNT} step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder={t.amountPlaceholder} className="min-h-16 w-full rounded-2xl border border-gray-200 bg-white px-4 pr-14 text-2xl font-bold text-gray-900 outline-none focus:ring-2" style={{'--tw-ring-color':tenantColor} as React.CSSProperties}/><span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-gray-400">€</span></div></label>
      <label className="block"><span className="mb-2 block text-sm font-medium text-gray-700">{t.name}</span><input type="text" value={customerName} onChange={e=>setCustomerName(e.target.value)} placeholder={t.namePlaceholder} className="min-h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-sm outline-none focus:ring-2" style={{'--tw-ring-color':tenantColor} as React.CSSProperties}/></label>
      <label className="block"><span className="mb-2 block text-sm font-medium text-gray-700">{t.email}</span><input type="email" inputMode="email" value={customerEmail} onChange={e=>setCustomerEmail(e.target.value)} placeholder={t.emailPlaceholder} className="min-h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-sm outline-none focus:ring-2" style={{'--tw-ring-color':tenantColor} as React.CSSProperties}/></label>
      {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="button" onClick={handleContinue} disabled={!amount} className="min-h-12 w-full rounded-xl px-4 font-semibold text-white disabled:opacity-50" style={{backgroundColor:tenantColor}}>{t.continue}</button>
      <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400"><IconLock size={14}/>{t.secure}</p>
    </div> : <div><div className="mb-5 rounded-2xl border border-gray-100 bg-gray-50 p-4"><p className="text-xs text-gray-500">{t.amount}</p><p className="mt-1 text-2xl font-bold text-gray-900">{formatPrice(confirmedAmount,currency)}</p></div><StripePaymentStep module="card" amount={confirmedAmount} currency={currency} color={tenantColor} returnUrl={`${window.location.origin}/card`} referenceId={null} payLabel={`${t.pay} ${formatPrice(confirmedAmount,currency)}`} processingLabel={t.processing} billingCountryHint={t.billing} createIntent={createIntent} onError={setError} onSucceeded={()=>setPaid(true)}/>{error&&<p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}<p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-400"><IconLock size={14}/>{t.secure}</p></div>}
  </div>;
}
