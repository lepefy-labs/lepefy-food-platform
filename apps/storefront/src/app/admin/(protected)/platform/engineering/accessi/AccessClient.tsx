'use client';

import { useCallback, useEffect, useState } from 'react';
import Button from '../../../../_components/ui/Button';
import Badge from '../../../../_components/ui/Badge';
import { useConfirm } from '../../../../_components/ui/ConfirmDialog';
import { controlClasses } from '../../../../_components/ui/Form';

interface Settings { aiEnabled: boolean; dailyBudgetUsd: number; perMinuteLimit: number; maxToolCalls: number }
interface Client { id: string; name: string; token_prefix: string; scopes: string[]; expires_at: string; revoked_at: string | null; last_used_at: string | null; created_at: string }
const SCOPES = [['search', 'Ricerca'], ['read', 'Lettura file'], ['ask', 'Domande AI']] as const;
const input = controlClasses;
const fmt = (value: string | null) => (value ? new Date(value).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function AccessClient() {
  const [ask, confirmDialog] = useConfirm();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [policyEnabled, setPolicyEnabled] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState('');
  const [secret, setSecret] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        fetch('/api/admin/platform/engineering/settings', { cache: 'no-store' }),
        fetch('/api/admin/platform/engineering/clients', { cache: 'no-store' }),
      ]);
      const sBody = await s.json();
      const cBody = await c.json();
      if (!s.ok || !c.ok) throw new Error(sBody.error ?? cBody.error ?? 'Caricamento non riuscito.');
      setSettings(sBody.settings);
      setPolicyEnabled(sBody.routingPolicyEnabled === true);
      setClients(cBody.clients);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Caricamento non riuscito.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    const response = await fetch('/api/admin/platform/engineering/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiEnabled: form.get('aiEnabled') === 'on', dailyBudgetUsd: Number(form.get('dailyBudgetUsd')),
        perMinuteLimit: Number(form.get('perMinuteLimit')), maxToolCalls: Number(form.get('maxToolCalls')),
      }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) setError(body.error ?? 'Salvataggio non riuscito.'); else { setSettings(body.settings); }
  }

  async function createClient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scopes = SCOPES.map(([key]) => key).filter((key) => form.get(`scope_${key}`) === 'on');
    setBusy(true); setError('');
    const response = await fetch('/api/admin/platform/engineering/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: String(form.get('name') ?? ''), scopes, days: Number(form.get('days')) }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) { setError(body.error ?? 'Creazione non riuscita.'); return; }
    setSecret({ name: body.client.name, token: body.token });
    (event.target as HTMLFormElement).reset();
    void load();
  }

  async function revoke(id: string) {
    if (!(await ask({ title: 'Revocare questa credenziale?', description: 'L’operazione è immediata e non si può annullare.', confirmLabel: 'Revoca', destructive: true }))) return;
    const response = await fetch(`/api/admin/platform/engineering/clients/${id}`, { method: 'DELETE' });
    if (!response.ok) setError('Revoca non riuscita.');
    void load();
  }

  return (
    <div className="space-y-6">
      {confirmDialog}
      {error && <p role="alert" className="text-sm text-tone-danger-fg">{error}</p>}

      {settings && (
        <section aria-labelledby="acc-ai" className="space-y-3 rounded-[10px] border border-a-border bg-a-surface p-4">
          <h2 id="acc-ai" className="text-base font-semibold text-a-text">Assistente AI</h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-a-text-2">
            Impostazione: <Badge tone={settings.aiEnabled ? 'success' : 'neutral'} dot>{settings.aiEnabled ? 'Attiva' : 'Spenta'}</Badge>
            Policy di routing «engineering»: <Badge tone={policyEnabled ? 'success' : 'neutral'} dot>{policyEnabled ? 'Abilitata' : 'Disabilitata'}</Badge>
          </p>
          <p className="text-xs text-a-text-3">Per rispondere servono entrambe. La policy si abilita in Piattaforma › Intelligenza artificiale › Routage: da qui non si può attivare la spesa con un solo clic.</p>
          <form onSubmit={saveSettings} className="grid gap-3 sm:grid-cols-4">
            <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" name="aiEnabled" defaultChecked={settings.aiEnabled} />Assistente attivo</label>
            <label className="space-y-1 text-sm">Budget giornaliero (USD)<input className={input} name="dailyBudgetUsd" type="number" min={0} max={1000} step="0.5" defaultValue={settings.dailyBudgetUsd} /></label>
            <label className="space-y-1 text-sm">Domande al minuto<input className={input} name="perMinuteLimit" type="number" min={1} max={600} defaultValue={settings.perMinuteLimit} /></label>
            <label className="space-y-1 text-sm">Strumenti per domanda<input className={input} name="maxToolCalls" type="number" min={1} max={12} defaultValue={settings.maxToolCalls} /></label>
            <div className="flex items-end"><Button type="submit" variant="primary" disabled={busy}>Salva</Button></div>
          </form>
        </section>
      )}

      <section aria-labelledby="acc-clients" className="space-y-3 rounded-[10px] border border-a-border bg-a-surface p-4">
        <h2 id="acc-clients" className="text-base font-semibold text-a-text">Credenziali macchina</h2>
        <p className="text-xs text-a-text-3">Per CI e strumenti interni: <code>Authorization: Bearer lpe_eng_…</code> su <code>/api/engineering/v1/{'{search,files,ask}'}</code>. Il token si vede una sola volta; sul server resta solo il suo hash.</p>

        {secret && (
          <div role="status" className="space-y-1 rounded-[10px] border border-tone-warning-border bg-tone-warning-bg p-3 text-sm text-tone-warning-fg">
            <p className="font-semibold">Credenziale «{secret.name}» creata. Copia il token ora: non sarà più visibile.</p>
            <code className="block break-all rounded bg-a-surface p-2 font-mono text-xs text-a-text">{secret.token}</code>
            <Button type="button" variant="secondary" size="sm" onClick={() => setSecret(null)}>Fatto, l’ho copiato</Button>
          </div>
        )}

        <form onSubmit={createClient} className="grid gap-3 sm:grid-cols-4">
          <label className="space-y-1 text-sm sm:col-span-2">Nome<input className={input} name="name" required minLength={2} maxLength={80} placeholder="es. GitHub Actions" /></label>
          <label className="space-y-1 text-sm">Durata (giorni)<input className={input} name="days" type="number" min={1} max={365} defaultValue={30} /></label>
          <fieldset className="text-sm sm:col-span-4"><legend className="mb-1">Permessi</legend>
            <div className="flex flex-wrap gap-4">{SCOPES.map(([key, label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" name={`scope_${key}`} defaultChecked={key === 'search'} />{label}</label>)}</div>
          </fieldset>
          <div><Button type="submit" variant="primary" disabled={busy}>Crea credenziale</Button></div>
        </form>

        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm text-a-text">
            <caption className="sr-only">Credenziali macchina</caption>
            <thead><tr>{['Nome', 'Prefisso', 'Permessi', 'Scade', 'Ultimo uso', 'Stato', ''].map((header) => <th key={header} scope="col" className="border-b border-a-border bg-a-surface-2 px-3 py-2 text-left text-xs font-semibold text-a-text-2">{header}</th>)}</tr></thead>
            <tbody>
              {clients.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-a-text-3">Nessuna credenziale.</td></tr>}
              {clients.map((client) => {
                const expired = new Date(client.expires_at).getTime() <= Date.now();
                const state = client.revoked_at ? 'Revocata' : expired ? 'Scaduta' : 'Attiva';
                return (
                  <tr key={client.id}>
                    <td className="border-b border-a-border px-3 py-2 font-semibold">{client.name}</td>
                    <td className="border-b border-a-border px-3 py-2 font-mono text-xs">{client.token_prefix}…</td>
                    <td className="border-b border-a-border px-3 py-2 text-a-text-2">{client.scopes.join(', ')}</td>
                    <td className="border-b border-a-border px-3 py-2 text-a-text-2">{fmt(client.expires_at)}</td>
                    <td className="border-b border-a-border px-3 py-2 text-a-text-2">{fmt(client.last_used_at)}</td>
                    <td className="border-b border-a-border px-3 py-2"><Badge tone={state === 'Attiva' ? 'success' : 'neutral'} dot>{state}</Badge></td>
                    <td className="border-b border-a-border px-3 py-2 text-right">{state === 'Attiva' && <Button type="button" variant="ghost" size="sm" onClick={() => revoke(client.id)}>Revoca</Button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
