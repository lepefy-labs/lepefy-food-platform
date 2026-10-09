'use client';

import { useState } from 'react';
import { IconInfoCircle, IconTruckDelivery } from '@tabler/icons-react';
import Button from '../../../_components/ui/Button';
import type { ShipmentCreationTrigger, ShippingAutomationSettings } from '@/lib/shipping/shipmentDraft/settings';
import { SHIPMENT_TRIGGER_LABELS } from '@/lib/shipping/shipmentDraft/shipmentDraftPresentation';
import { SettingsFeedback, SettingsIconTile } from '../../parametres/_components/SettingsUi';
import { useSettingsFeedback } from '../../parametres/_components/useSettingsFeedback';

const TRIGGERS: ReadonlyArray<{ key: ShipmentCreationTrigger; hint: string; recommended?: boolean }> = [
  { key: 'order_created', hint: 'Le brouillon est créé dès qu’une commande de livraison valide est enregistrée dans Lepefy.' },
  { key: 'preparing', recommended: true, hint: 'Le brouillon est créé lorsque l’équipe commence à préparer la commande. Recommandé si le poids ou le colis peuvent encore changer.' },
  { key: 'manual', hint: 'Aucune création automatique. L’équipe crée le brouillon depuis la fiche commande.' },
];

/** tenant_feature_settings('shipping_automation') — migration 151. */
export function ShipmentCreationSection({ initial, provider, canManage }: {
  initial: ShippingAutomationSettings;
  provider: { key: string; displayName: string } | null;
  canManage: boolean;
}) {
  const [saved, setSaved] = useState({ enabled: initial.enabled, trigger: initial.trigger });
  // Activating for the first time preselects the recommended moment.
  const [form, setForm] = useState({ enabled: initial.enabled, trigger: initial.status === 'missing' ? 'preparing' as const : initial.trigger });
  const [saving, setSaving] = useState(false);
  const { feedback, show } = useSettingsFeedback();
  const available = initial.available;
  const disabled = !available || !canManage || saving || !provider;
  const dirty = form.enabled !== saved.enabled || (form.enabled && form.trigger !== saved.trigger);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/shipping-automation', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: form.enabled, config: { create_shipment_trigger: form.trigger } }),
      });
      const body = await response.json().catch(() => ({})) as Partial<ShippingAutomationSettings> & { error?: string };
      if (!response.ok || body.enabled === undefined || !body.trigger) throw new Error(body.error || 'Enregistrement impossible.');
      setSaved({ enabled: body.enabled, trigger: body.trigger });
      setForm({ enabled: body.enabled, trigger: body.trigger });
      show(body.enabled ? 'Création des brouillons activée.' : 'Création des brouillons désactivée.', 'success');
    } catch (error) {
      show(error instanceof Error ? error.message : 'Enregistrement impossible.', 'error');
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {!available && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">La migration 151 doit être appliquée pour activer ce réglage. La création reste manuelle dans le back-office du transporteur.</p>}
      {available && initial.status === 'invalid' && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">Le réglage enregistré est invalide : la création est désactivée. Vérifiez puis enregistrez.</p>}
      {available && !canManage && <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">Lecture seule : la modification demande la gestion de la livraison.</p>}

      <article aria-labelledby="shipment-creation-title" className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <header className="flex items-start gap-4 border-b border-gray-100 px-4 py-4 sm:px-6 dark:border-gray-800">
          <SettingsIconTile icon={IconTruckDelivery} accent="blue" />
          <div className="min-w-0">
            <h2 id="shipment-creation-title" className="text-base font-semibold text-gray-950 dark:text-gray-100">Création des expéditions</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {provider ? `Transporteur : ${provider.displayName}` : 'Votre transporteur ne permet pas la création automatique des brouillons.'}
            </p>
          </div>
        </header>

        {provider && (
          <div className="space-y-5 px-4 py-5 sm:px-6">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-gray-900 dark:text-gray-100">
              <input type="checkbox" className="h-5 w-5 rounded accent-[var(--admin-primary)]" checked={form.enabled} disabled={disabled}
                onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))} />
              Créer les brouillons d’expédition depuis Lepefy
            </label>

            <fieldset disabled={disabled || !form.enabled} className="space-y-2 disabled:opacity-60">
              <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">Moment de création</legend>
              {TRIGGERS.map((option) => (
                <label key={option.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${form.trigger === option.key ? 'border-[var(--admin-primary)] bg-[var(--admin-primary-soft)]' : 'border-[var(--admin-border)]'}`}>
                  <input type="radio" name="shipment-trigger" className="mt-0.5 h-4 w-4 accent-[var(--admin-primary)]" value={option.key}
                    checked={form.trigger === option.key} onChange={() => setForm((prev) => ({ ...prev, trigger: option.key }))} />
                  <span className="min-w-0">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{SHIPMENT_TRIGGER_LABELS[option.key]}</span>
                    {option.recommended && <span className="ml-2 rounded-full bg-[var(--admin-primary-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--admin-primary-fg)]">Recommandé</span>}
                    <span className="mt-0.5 block text-xs leading-5 text-gray-500 dark:text-gray-400">{option.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <IconInfoCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              Lepefy crée uniquement un brouillon. L’achat et la validation finale restent effectués dans {provider.displayName} PRO.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-gray-500 dark:text-gray-400">
              <li>Expéditeur : l’entrepôt par défaut de votre compte {provider.displayName} PRO.</li>
              <li>Colis : poids de la commande et carton des règles d’emballage du checkout (Emballages).</li>
              <li>Aucun e-mail client et aucun changement de prix : la commande passe « expédiée » seulement quand le transporteur la prend en charge.</li>
              <li>Le réglage s’applique aux commandes suivantes ; les autres se créent depuis la fiche commande.</li>
            </ul>
          </div>
        )}

        {provider && (
          <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 px-4 py-3 sm:px-6 dark:border-gray-800">
            <SettingsFeedback feedback={feedback} />
            <Button type="button" variant="outline" onClick={() => setForm(saved)} disabled={!dirty || saving} className="min-h-11">Annuler</Button>
            <Button type="button" onClick={() => void save()} disabled={disabled || !dirty} loading={saving} className="min-h-11">Enregistrer</Button>
          </footer>
        )}
      </article>
    </div>
  );
}
