'use client';

import { useState } from 'react';
import { IconClock, IconDeviceFloppy } from '@tabler/icons-react';

type Settings = {
  daily_digest_enabled: boolean;
  daily_digest_timezone: string;
  daily_digest_include_empty: boolean;
  daily_digest_prepare_hours: number;
  daily_digest_pickup_hours: number;
  daily_digest_payment_hours: number;
  daily_digest_shipping_hours: number;
};
const fallback: Settings = {
  daily_digest_enabled: false, daily_digest_timezone: 'Europe/Rome',
  daily_digest_include_empty: false, daily_digest_prepare_hours: 24,
  daily_digest_pickup_hours: 48, daily_digest_payment_hours: 48, daily_digest_shipping_hours: 72,
};
const inputClass='min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
export function DailyDigestSettingsSection({ initial, available }: { initial: Partial<Settings> | null; available: boolean }) {
  const [form,setForm]=useState<Settings>({...fallback,...initial});
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState<{ok:boolean;text:string}|null>(null);
  const set=<K extends keyof Settings>(key:K,value:Settings[K])=>setForm(prev=>({...prev,[key]:value}));
  async function save(){
    setSaving(true);setMessage(null);
    try{
      const response=await fetch('/api/admin/tenant',{method:'PATCH',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});
      const body=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)throw new Error(body.error||'Enregistrement impossible.');
      setMessage({ok:true,text:'Rapport quotidien configuré.'});
    }catch(error){
      setMessage({ok:false,text:error instanceof Error?error.message:'Enregistrement impossible.'});
    }finally{setSaving(false);}
  }
  return (
    <section className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="flex items-start gap-3 border-b border-sky-100 bg-sky-50/80 px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900">
        <IconClock className="mt-0.5 text-sky-600" size={22}/>
        <div><h2 className="text-sm font-semibold text-sky-700 dark:text-sky-200">Rapport des commandes à 08h</h2>
        <p className="mt-0.5 text-xs text-gray-500">Un résumé des commandes nécessitant une action.</p></div>
      </header>
      <div className="space-y-4 p-4 sm:p-5">
        {!available&&<p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">La migration 129 doit être appliquée avant d’utiliser ce rapport.</p>}
        <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <span><strong>Activer le rapport quotidien</strong><small className="mt-1 block text-gray-500">Nécessite le scheduler et le webhook e-mail n8n configurés.</small></span>
          <input type="checkbox" disabled={!available||saving} checked={form.daily_digest_enabled}
            onChange={e=>set('daily_digest_enabled',e.target.checked)} aria-label="Activer le rapport quotidien"/>
        </label>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">Fuseau horaire IANA
          <input className={inputClass+' mt-1'} disabled={!available||saving}
            value={form.daily_digest_timezone} onChange={e=>set('daily_digest_timezone',e.target.value)}
            placeholder="Europe/Rome" autoComplete="off"/>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ['daily_digest_prepare_hours','Préparation en retard (h)'],
            ['daily_digest_pickup_hours','Retrait en retard (h)'],
            ['daily_digest_payment_hours','Paiement à vérifier (h)'],
            ['daily_digest_shipping_hours','Suivi transporteur sans mouvement (h)'],
          ] as const).map(([key,label])=>(
            <label key={key} className="block text-xs font-medium text-gray-600 dark:text-gray-300">{label}
              <input className={inputClass+' mt-1'} type="number" min={key==='daily_digest_shipping_hours'?24:1} max={336} step={1}
                disabled={!available||saving} value={form[key]}
                onChange={e=>set(key,Number(e.target.value))}/>
            </label>
          ))}
        </div>
        <label className="flex min-h-10 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <input type="checkbox" disabled={!available||saving} checked={form.daily_digest_include_empty}
            onChange={e=>set('daily_digest_include_empty',e.target.checked)}/>
          Envoyer également un rapport lorsqu’aucune commande ne nécessite d’action
        </label>
        <p className="text-xs text-gray-500">L’envoi est prévu à 08h heure locale. Sélectionnez aussi au moins un destinataire « Rapport quotidien » dans Notifications.</p>
        {message&&<p role="status" className={'rounded-lg p-3 text-sm '+(message.ok?'bg-green-50 text-green-700':'bg-red-50 text-red-700')}>{message.text}</p>}
        <button type="button" onClick={()=>void save()} disabled={!available||saving}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50">
          <IconDeviceFloppy size={17}/>{saving?'Enregistrement…':'Enregistrer'}
        </button>
      </div>
    </section>
  );
}
