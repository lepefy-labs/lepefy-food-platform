'use client';
import { useState } from 'react';
import { CONFIG, FOOD_CODES, REGIONS } from '@/lib/platform/prospects/config';
import type { DiscoveryFilters, Run } from '@/lib/platform/prospects/types';
import { api, button, card, field, secondary } from './ui';
export default function DiscoveryForm({onRun}:{onRun:(run:Run)=>void}) {
  const [summary,setSummary] = useState<DiscoveryFilters | null>(null), [busy,setBusy] = useState(false), [error,setError] = useState('');
  async function launch() {
    if (!summary || busy) return;
    setBusy(true); setError('');
    try {
      const data = await api<{run:Run}>('/api/admin/platform/prospects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'discover',filters:summary})});
      onRun(data.run); setSummary(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Découverte indisponible.'); } finally { setBusy(false); }
  }
  return <details className={card} id="discovery"><summary className="min-h-11 cursor-pointer font-semibold text-violet-700 dark:text-violet-300">Découvrir des prospects</summary>
    <p className="mb-4 text-sm text-gray-500">France · données publiques SIRENE. Les catégories ne prouvent ni indépendance, ni spécialité africaine, antillaise ou halal.</p>
    <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget); setError('');
      setSummary({country:'FR',region:String(f.get('region') ?? ''),department:String(f.get('department') ?? '').toUpperCase(),
        city:String(f.get('city') ?? '').trim(),codes:f.getAll('codes').map(String),activeOnly:f.has('activeOnly'),limit:Number(f.get('limit'))});
    }}>
      <label className="text-sm">Pays<input className={field} value="France" readOnly /></label>
      <label className="text-sm">Région<select className={field} name="region" defaultValue="11"><option value="">Toutes</option>{Object.entries(REGIONS).map(([code,name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <label className="text-sm">Département (code)<input className={field} name="department" placeholder="75" maxLength={3} pattern="[0-9]{2,3}|2A|2B" /></label>
      <label className="text-sm">Ville (facultatif)<input className={field} name="city" placeholder="Paris" maxLength={100} /></label>
      <label className="text-sm">Maximum de prospects<input className={field} type="number" name="limit" defaultValue={100} min={1} max={CONFIG.maxDiscovery} required /></label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input name="activeOnly" type="checkbox" defaultChecked />Établissements actifs uniquement</label>
      <fieldset className="sm:col-span-2 lg:col-span-3"><legend className="mb-2 text-sm font-medium">Activités NAF / APE</legend><div className="grid gap-2 sm:grid-cols-2">
        {Object.entries(FOOD_CODES).map(([code,label]) => <label className="flex min-h-11 items-center gap-2 text-sm" key={code}><input type="checkbox" name="codes" value={code} defaultChecked />{label} ({code})</label>)}
      </div></fieldset>
      <button className={secondary} disabled={busy}>Vérifier la sélection</button>
    </form>
    {summary && <div className="mt-4 space-y-3 rounded-xl bg-violet-50 p-4 text-violet-950">
      <p className="font-medium">Confirmer la découverte</p>
      <p className="text-sm">France · {REGIONS[summary.region] ?? 'Toutes régions'} · {summary.department || 'Tous départements'} · {summary.city || 'Toutes villes'} · {summary.codes.length} activités · maximum {summary.limit} établissements · {summary.activeOnly ? 'actifs' : 'tous états'}.</p>
      <p className="text-xs">Les doublons sont conservés comme tels, sans remplacer les notes. Une recherche récente identique réutilise son résultat.</p>
      <button className={button} disabled={busy || summary.codes.length === 0} onClick={() => void launch()}>{busy ? 'Préparation…' : 'Confirmer et préparer les lots'}</button>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </details>;
}
