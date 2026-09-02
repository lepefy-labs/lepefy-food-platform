'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AiProvider, AiModel } from '@/lib/ai/core/types';

interface Policy { id: string; consumer: string; capability: string; enabled: boolean }
interface PolicyModel {
  policy_id: string; model_id: string; priority: number; enabled: boolean;
  timeout_ms: number; min_confidence: number | null;
}
interface Snapshot { providers: AiProvider[]; models: AiModel[]; policies: Policy[]; policyModels: PolicyModel[] }
const field = 'min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950 dark:border-gray-700 dark:bg-gray-900 dark:text-white';
const button = 'min-h-11 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50';
const card = 'space-y-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const nullable = (form: FormData, key: string) => text(form, key) || null;
const number = (form: FormData, key: string) => text(form, key) ? Number(text(form, key)) : null;
function Field({ label, name, value, type = 'text', required = false }: {
  label: string; name: string; value?: string | number | null; type?: string; required?: boolean;
}) {
  return <label className="block space-y-1 text-sm"><span>{label}</span>
    <input className={field} name={name} defaultValue={value ?? ''} type={type} required={required}
      step={type === 'number' ? 'any' : undefined} /></label>;
}
function Enabled({ value = true }: { value?: boolean }) {
  return <label className="flex min-h-11 items-center gap-2 text-sm">
    <input type="checkbox" name="enabled" defaultChecked={value} />Activé</label>;
}
export default function AiRoutingClient() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/platform/ai-routing', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Chargement impossible.');
      setData(body);
    } catch (e) { setError(e instanceof Error ? e.message : 'Chargement impossible.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function save(payload: unknown) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/platform/ai-routing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Enregistrement impossible.');
      await load(); setNotice('Enregistré. Pris en compte sous 30 secondes.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement impossible.'); }
    finally { setBusy(false); }
  }
  function providerForm(provider?: AiProvider) {
    return <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      void save({ kind: 'provider', id: provider?.id, values: {
        key: text(f, 'key'), name: text(f, 'name'), provider_type: text(f, 'provider_type'),
        enabled: f.has('enabled'), credential_ref: nullable(f, 'credential_ref'), base_url: nullable(f, 'base_url'), config: {},
      } });
    }}>
      <Field label="Clé" name="key" value={provider?.key} required />
      <Field label="Nom" name="name" value={provider?.name} required />
      <label className="space-y-1 text-sm">Type<select name="provider_type" defaultValue={provider?.provider_type ?? 'openai_compatible'} className={field}>
        {['gemini', 'openai_compatible', 'openai', 'anthropic', 'lepefy'].map(v => <option key={v}>{v}</option>)}
      </select></label>
      <Field label="Référence credential (nom env uniquement)" name="credential_ref" value={provider?.credential_ref} />
      <Field label="URL de base HTTPS (inclure /v1 si nécessaire)" name="base_url" value={provider?.base_url} type="url" />
      <Enabled value={provider?.enabled ?? false} />
      <button disabled={busy} className={button}>Enregistrer le provider</button>
    </form>;
  }
  function modelForm(model?: AiModel) {
    return <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      const thinking = number(f, 'thinkingBudget');
      void save({ kind: 'model', id: model?.id, values: {
        key: text(f, 'key'), display_name: text(f, 'display_name'), provider_id: text(f, 'provider_id'),
        provider_model_id: text(f, 'provider_model_id'), enabled: f.has('enabled'),
        capabilities: { chat: f.has('chat'), structured_output: f.has('structured_output'),
          classification: f.has('classification'), reasoning: f.has('reasoning'), vision: f.has('vision') },
        context_window: number(f, 'context_window'), cost_class: nullable(f, 'cost_class'),
        input_cost_per_million: number(f, 'input_cost_per_million'), output_cost_per_million: number(f, 'output_cost_per_million'),
        config: thinking === null ? {} : { thinkingBudget: thinking },
      } });
    }}>
      <Field label="Clé" name="key" value={model?.key} required />
      <Field label="Nom affiché" name="display_name" value={model?.display_name} required />
      <label className="space-y-1 text-sm">Provider<select name="provider_id" defaultValue={model?.provider_id} className={field}>
        {data?.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <Field label="ID modèle chez le provider" name="provider_model_id" value={model?.provider_model_id} required />
      <Field label="Fenêtre de contexte (tokens)" name="context_window" value={model?.context_window} type="number" />
      <Field label="Classe de coût" name="cost_class" value={model?.cost_class} />
      <Field label="Coût entrée / million (metadata)" name="input_cost_per_million" value={model?.input_cost_per_million} type="number" />
      <Field label="Coût sortie / million (metadata)" name="output_cost_per_million" value={model?.output_cost_per_million} type="number" />
      <Field label="Thinking budget (Gemini, optionnel)" name="thinkingBudget" value={typeof model?.config.thinkingBudget === 'number' ? model.config.thinkingBudget : null} type="number" />
      <Enabled value={model?.enabled} />
      <fieldset className="flex flex-wrap gap-4 sm:col-span-2"><legend className="text-sm">Capacités</legend>
        {['chat', 'structured_output', 'classification', 'reasoning', 'vision'].map(cap => <label key={cap} className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name={cap} defaultChecked={model ? model.capabilities[cap] : ['chat', 'structured_output'].includes(cap)} />{cap}
        </label>)}
      </fieldset>
      <button disabled={busy} className={button}>Enregistrer le modèle</button>
    </form>;
  }
  return <div className="mx-auto max-w-6xl space-y-6 text-gray-900 dark:text-gray-100">
    <header><p className="text-xs font-semibold uppercase text-violet-600">Plateforme</p>
      <h1 className="text-2xl font-semibold">Routage IA</h1>
      <p className="mt-2 text-sm text-gray-500">Providers, modèles et ordre de fallback. Priorité la plus basse en premier.</p>
    </header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-800">{notice}</p>}
    {!data ? <button className={button} onClick={() => void load()}>Charger la configuration</button> : <>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Providers</h2>
        <p className="text-sm text-gray-500">Aucun secret n’est affiché ou enregistré ici. OpenAI, Anthropic et Lepefy restent désactivés en V1.</p>
        {data.providers.map(p => <details key={p.id} className={card}>
          <summary className="min-h-11 cursor-pointer font-medium">{p.name} · {p.provider_type} · {p.enabled ? 'actif' : 'désactivé'} · santé: {p.health_status}</summary>
          {providerForm(p)}</details>)}
        <details className={card}><summary className="min-h-11 cursor-pointer">Ajouter un provider</summary>{providerForm()}</details>
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Modèles</h2>
        {data.models.length === 0 && <p>Aucun modèle configuré.</p>}
        {data.models.map(m => <details key={m.id} className={card}><summary className="min-h-11 cursor-pointer font-medium">
          {m.display_name} · {data.providers.find(p => p.id === m.provider_id)?.name} · {m.enabled ? 'actif' : 'désactivé'}
        </summary>{modelForm(m)}</details>)}
        <details className={card}><summary className="min-h-11 cursor-pointer">Ajouter un modèle</summary>{modelForm()}</details>
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Policies</h2>
        <details className={card}>
          <summary className="min-h-11 cursor-pointer font-medium">Ajouter une policy</summary>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            void save({ kind: 'policy', values: {
              consumer: text(f, 'consumer'), capability: text(f, 'capability'),
              enabled: f.has('enabled'), config: {},
            } });
          }}>
            <Field label="Consumer" name="consumer" required />
            <Field label="Capability" name="capability" required />
            <Enabled />
            <button className={button} disabled={busy}>Créer la policy</button>
          </form>
        </details>
        {data.policies.map(p => <div key={p.id} className={card}>
          <h3 className="font-semibold">{p.consumer} · {p.capability}</h3>
          <button className={button} disabled={busy} onClick={() => void save({ kind: 'policy', id: p.id,
            values: { consumer: p.consumer, capability: p.capability, enabled: !p.enabled, config: {} } })}>
            {p.enabled ? 'Désactiver la policy' : 'Activer la policy'}</button>
          {data.policyModels.filter(pm => pm.policy_id === p.id).sort((a,b) => a.priority-b.priority || a.model_id.localeCompare(b.model_id)).map(pm =>
            <form key={pm.model_id} className="grid items-end gap-3 rounded-xl bg-gray-50 p-3 dark:bg-gray-800 sm:grid-cols-5" onSubmit={e => {
              e.preventDefault(); const f = new FormData(e.currentTarget);
              void save({ kind: 'policyModel', values: { policy_id: p.id, model_id: pm.model_id,
                priority: Number(f.get('priority')), timeout_ms: Number(f.get('timeout_ms')),
                min_confidence: number(f, 'min_confidence'), enabled: f.has('enabled'),
              } });
            }}>
              <p className="font-medium sm:col-span-5">{data.models.find(m => m.id === pm.model_id)?.display_name ?? pm.model_id}</p>
              <Field label="Priorité" name="priority" value={pm.priority} type="number" required />
              <Field label="Timeout (ms)" name="timeout_ms" value={pm.timeout_ms} type="number" required />
              <Field label="Confidence minimale" name="min_confidence" value={pm.min_confidence} type="number" />
              <Enabled value={pm.enabled} /><button className={button} disabled={busy}>Enregistrer</button>
            </form>)}
          <form className="flex flex-wrap gap-3" onSubmit={e => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            void save({ kind: 'policyModel', values: { policy_id: p.id, model_id: text(f, 'model_id'),
              enabled: true, priority: 1 + Math.max(0, ...data.policyModels.filter(pm => pm.policy_id === p.id).map(pm => pm.priority)),
              timeout_ms: 6000, min_confidence: null } });
          }}>
            <label className="grow text-sm">Ajouter à la chaîne<select className={field} name="model_id" required>
              {data.models.filter(m => !data.policyModels.some(pm => pm.policy_id === p.id && pm.model_id === m.id))
                .map(m => <option value={m.id} key={m.id}>{m.display_name}</option>)}
            </select></label><button className={button} disabled={busy}>Ajouter</button>
          </form>
        </div>)}
      </section>
    </>}
  </div>;
}
