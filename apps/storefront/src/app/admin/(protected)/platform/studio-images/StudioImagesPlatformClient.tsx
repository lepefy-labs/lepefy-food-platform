'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '../../../_components/ui/Button';
import Badge from '../../../_components/ui/Badge';
import Dialog from '../../../_components/ui/Dialog';
import ConfirmDialog from '../../../_components/ui/ConfirmDialog';
import InlineAlert from '../../../_components/ui/InlineAlert';
import { FormField, Input } from '../../../_components/ui/Form';
import { useAdminToast } from '../../../_components/ui/Toaster';
import { formatMoney } from '@/lib/admin/format';
import type { PlatformStudioTenant } from '@/lib/studio/server/platform';

async function patch(body: Record<string, unknown>): Promise<{ tenant?: PlatformStudioTenant; error?: string }> {
  try {
    const response = await fetch('/api/admin/platform/studio-images', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await response.json().catch(() => ({})) as { tenant?: PlatformStudioTenant; error?: string };
    return response.ok ? json : { error: json.error ?? 'Enregistrement impossible.' };
  } catch {
    return { error: 'Connexion impossible. Réessayez.' };
  }
}

/** One row per shop: flag switch (with confirmation), quotas dialog, month usage. */
export default function StudioImagesPlatformClient({ initialTenants }: { initialTenants: PlatformStudioTenant[] }) {
  const toast = useAdminToast();
  const router = useRouter();
  const [tenants, setTenants] = useState(initialTenants);
  const [toggle, setToggle] = useState<PlatformStudioTenant | null>(null);
  const [editing, setEditing] = useState<PlatformStudioTenant | null>(null);
  const [form, setForm] = useState({ revisions: '', budget: '', retention: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const replace = (next?: PlatformStudioTenant) => { if (next) setTenants((rows) => rows.map((row) => (row.id === next.id ? next : row))); };

  async function confirmToggle() {
    if (!toggle) return;
    setPending(true); setError(null);
    const result = await patch({ tenantId: toggle.id, enabled: !toggle.enabled });
    setPending(false);
    if (result.error) { setError(result.error); return; }
    replace(result.tenant);
    router.refresh();
    toast.success(`${toggle.name} : Studio images ${toggle.enabled ? 'désactivé' : 'activé'}`, { description: 'Visible sur sa boutique d’ici 30 secondes.' });
    setToggle(null);
  }

  function openEdit(tenant: PlatformStudioTenant) {
    setEditing(tenant);
    setError(null);
    setForm({ revisions: String(tenant.quota.limit), budget: String(tenant.quota.budgetUsd), retention: String(tenant.retentionDays) });
  }

  async function saveQuotas() {
    if (!editing) return;
    setPending(true); setError(null);
    const result = await patch({
      tenantId: editing.id, monthlyRevisions: Number(form.revisions), monthlyBudgetUsd: Number(form.budget.replace(',', '.')), retentionDays: Number(form.retention),
    });
    setPending(false);
    if (result.error) { setError(result.error); return; }
    replace(result.tenant);
    toast.success(`Quotas de ${editing.name} enregistrés`);
    setEditing(null);
  }

  return (
    <>
      <InlineAlert tone="info" title="Génération payante">
        Chaque création ou correction appelle le service d’images. Le quota et le budget mensuels bloquent les nouvelles créations une fois atteints (mois civil, heure de Paris). Le modèle utilisé se règle dans <Link className="font-semibold underline" href="/admin/platform/ai-routing">Routage</Link> (politiques studio).
      </InlineAlert>
      <ul className="divide-y divide-a-border rounded-[10px] border border-a-border bg-a-surface">
        {tenants.map((tenant) => (
          <li key={tenant.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-a-text">
                {tenant.name}
                {tenant.isTest && <Badge tone="neutral">Test</Badge>}
                <Badge tone={tenant.enabled ? 'success' : 'neutral'} dot>{tenant.enabled ? 'Activé' : 'Désactivé'}</Badge>
              </p>
              <p className="mt-1 text-xs text-a-text-3">
                {tenant.slug} · ce mois-ci : {tenant.quota.used}/{tenant.quota.limit} créations · {formatMoney(tenant.quota.costUsd, 'USD')} sur {formatMoney(tenant.quota.budgetUsd, 'USD')} · {tenant.assets} image(s) en bibliothèque · brouillons gardés {tenant.retentionDays} j{tenant.customized ? '' : ' (défaut)'}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" size="sm" onClick={() => openEdit(tenant)}>Quotas</Button>
              <Button variant={tenant.enabled ? 'secondary' : 'primary'} size="sm" onClick={() => { setError(null); setToggle(tenant); }}>
                {tenant.enabled ? 'Désactiver' : 'Activer'}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(toggle)}
        title={toggle?.enabled ? `Désactiver le Studio images pour ${toggle?.name} ?` : `Activer le Studio images pour ${toggle?.name} ?`}
        description={toggle?.enabled
          ? 'Le menu et les pages du Studio disparaissent pour cette boutique. Les images déjà publiées restent sur la boutique ; la bibliothèque est conservée.'
          : `L’équipe de la boutique pourra créer des images (payantes) : ${toggle?.quota.limit} créations et ${formatMoney(toggle?.quota.budgetUsd ?? 0, 'USD')} au maximum par mois.`}
        confirmLabel={toggle?.enabled ? 'Désactiver' : 'Activer'}
        destructive={Boolean(toggle?.enabled)}
        loading={pending}
        error={error}
        onCancel={() => setToggle(null)}
        onConfirm={() => void confirmToggle()}
      />

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        dismissible={!pending}
        title={`Quotas · ${editing?.name ?? ''}`}
        description="Appliqués dès la prochaine création. Les créations en échec ne sont pas comptées ; le coût l’est toujours."
        footer={<><Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>Annuler</Button><Button type="submit" form="studio-quotas-form" loading={pending}>Enregistrer</Button></>}
      >
        <form id="studio-quotas-form" className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveQuotas(); }}>
          <FormField label="Créations par mois" hint="0 à 5 000. Une correction compte comme une création.">
            <Input inputMode="numeric" value={form.revisions} onChange={(event) => setForm({ ...form, revisions: event.target.value })} />
          </FormField>
          <FormField label="Budget mensuel (USD)" hint="0 à 10 000. Coût réel des appels au service d’images.">
            <Input inputMode="decimal" value={form.budget} onChange={(event) => setForm({ ...form, budget: event.target.value })} />
          </FormField>
          <FormField label="Conservation des brouillons (jours)" hint="7 à 365. Les images jamais utilisées sont ensuite supprimées.">
            <Input inputMode="numeric" value={form.retention} onChange={(event) => setForm({ ...form, retention: event.target.value })} />
          </FormField>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </form>
      </Dialog>
    </>
  );
}
