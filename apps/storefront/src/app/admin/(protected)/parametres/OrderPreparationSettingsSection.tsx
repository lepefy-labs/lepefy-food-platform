'use client';

import { useMemo, useState } from 'react';
import HelpHint from '../../_components/help/HelpHint';
import { IconClipboardCheck, IconSnowflake } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import InlineAlert from '../../_components/ui/InlineAlert';
import { cn } from '@/lib/utils/cn';
import type { OrderPreparationConfig } from '@/lib/orders/preparation/settings';
import type { PreparationModeValue } from '@/lib/orders/preparation/preparationPolicy';
import { SettingsFeedback, SettingsIconTile } from './_components/SettingsUi';
import { useSettingsFeedback } from './_components/useSettingsFeedback';

type Form = Pick<OrderPreparationConfig, 'picking_mode' | 'cold_chain_packing_mode'>;

interface Option { value: PreparationModeValue; title: string; description: string }

const PICKING_OPTIONS: Option[] = [
  { value: 'digital', title: 'Validation article par article', description: 'Chaque produit est coché dans Lepefy. Recommandé si vous préparez avec une tablette ou un téléphone.' },
  { value: 'paper', title: 'Préparation sur papier', description: 'Vous imprimez la liste et cochez sur la feuille. À la fin, vous confirmez seulement « Préparation terminée » dans Lepefy.' },
  { value: 'none', title: 'Sans confirmation', description: 'La commande avance quand vous l’expédiez ou la marquez prête au retrait. Lepefy n’enregistre aucun contrôle de préparation.' },
];

const COLD_OPTIONS: Option[] = [
  { value: 'digital', title: 'Contrôle dans Lepefy', description: 'Le contrôle de l’emballage froid est coché dans Lepefy pour chaque commande livrée.' },
  { value: 'paper', title: 'Contrôle sur papier', description: 'La consigne est imprimée sur la liste. À la fin, vous confirmez que l’emballage froid a été fait selon la liste.' },
  { value: 'none', title: 'Sans confirmation', description: 'Aucun contrôle n’est enregistré. Le rappel « frais et surgelés en dernier » reste imprimé sur la liste.' },
];

function ModeGroup({ id, legend, hint, options, value, onChange, disabled }: {
  id: string; legend: string; hint: string; options: Option[]; value: PreparationModeValue; onChange: (value: PreparationModeValue) => void; disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="text-sm font-semibold text-a-text">{legend}</legend>
      <p className="text-xs text-a-text-3">{hint}</p>
      {options.map((option) => (
        <label key={option.value} className={cn('flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3', value === option.value ? 'border-a-brand bg-a-brand-soft' : 'border-a-border bg-a-surface hover:bg-a-hover')}>
          <input type="radio" name={id} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--admin-primary)]" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-a-text">{option.title}{option.value === 'digital' && <span className="font-normal text-a-text-3"> · par défaut</span>}</span>
            <span className="mt-0.5 block text-xs leading-5 text-a-text-2">{option.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Préférences tenant_feature_settings('order_preparation') — migration 160. */
export function OrderPreparationSettingsSection({ initial, available, invalid, canManage }: { initial: OrderPreparationConfig; available: boolean; invalid: boolean; canManage: boolean }) {
  const toForm = (config: OrderPreparationConfig): Form => ({ picking_mode: config.picking_mode, cold_chain_packing_mode: config.cold_chain_packing_mode });
  const [saved, setSaved] = useState<Form>(() => toForm(initial));
  const [form, setForm] = useState<Form>(() => toForm(initial));
  const [saving, setSaving] = useState(false);
  const { feedback, show } = useSettingsFeedback();
  const disabled = !available || !canManage || saving;
  const dirty = useMemo(() => form.picking_mode !== saved.picking_mode || form.cold_chain_packing_mode !== saved.cold_chain_packing_mode, [form, saved]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/order-preparation/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: form }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; config?: OrderPreparationConfig };
      if (!response.ok || !body.config) throw new Error(body.error || 'Enregistrement impossible.');
      const next = toForm(body.config);
      setSaved(next);
      setForm(next);
      show('Mode de préparation enregistré. Il s’applique aux commandes dont la préparation n’a pas commencé.', 'success');
    } catch (error) {
      show(error instanceof Error ? error.message : 'Enregistrement impossible.', 'error');
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {!available && <InlineAlert tone="warning">La migration 160 doit être appliquée pour choisir un autre mode. En attendant, la préparation se valide dans Lepefy.</InlineAlert>}
      {available && invalid && <InlineAlert tone="danger">Les préférences enregistrées sont invalides : la validation dans Lepefy s’applique. Vérifiez puis enregistrez.</InlineAlert>}
      {available && !canManage && <p className="rounded-xl bg-a-surface-2 p-3 text-sm text-a-text-2">Lecture seule : la modification demande la gestion des paramètres.</p>}

      <article id="checklist" aria-labelledby="checklist-title" className="scroll-mt-24 rounded-2xl border border-a-border bg-a-surface">
        <header className="flex items-start gap-4 border-b border-a-border px-4 py-4 sm:px-6">
          <SettingsIconTile icon={IconClipboardCheck} accent="teal" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5"><h2 id="checklist-title" className="text-base font-semibold text-a-text">Checklist de préparation</h2><HelpHint slug="mode-de-preparation-papier" label="Mode de préparation" /></div>
            <p className="mt-1 text-sm text-a-text-3">Comment votre équipe confirme que les articles ont été préparés.</p>
          </div>
        </header>
        <div className="px-4 py-5 sm:px-6">
          <ModeGroup id="picking-mode" legend="Confirmation de la préparation" hint="Le paiement, le stock, le nombre de colis et le suivi restent toujours vérifiés." options={PICKING_OPTIONS}
            value={form.picking_mode} onChange={(value) => setForm((prev) => ({ ...prev, picking_mode: value }))} disabled={disabled} />
        </div>
      </article>

      <article id="emballage-froid" aria-labelledby="emballage-froid-title" className="scroll-mt-24 rounded-2xl border border-a-border bg-a-surface">
        <header className="flex items-start gap-4 border-b border-a-border px-4 py-4 sm:px-6">
          <SettingsIconTile icon={IconSnowflake} accent="sky" />
          <div className="min-w-0">
            <h2 id="emballage-froid-title" className="text-base font-semibold text-a-text">Emballage des produits frais et surgelés</h2>
            <p className="mt-1 text-sm text-a-text-3">Indépendant de la checklist. Concerne les livraisons contenant du frais ou du surgelé.</p>
          </div>
        </header>
        <div className="space-y-3 px-4 py-5 sm:px-6">
          <ModeGroup id="cold-mode" legend="Confirmation de l’emballage froid" hint="Les produits frais et surgelés restent toujours en fin de liste, avec la consigne imprimée." options={COLD_OPTIONS}
            value={form.cold_chain_packing_mode} onChange={(value) => setForm((prev) => ({ ...prev, cold_chain_packing_mode: value }))} disabled={disabled} />
          {form.cold_chain_packing_mode === 'none' && <InlineAlert tone="warning">Sans confirmation, Lepefy ne garde aucune trace du contrôle de la chaîne du froid. Préférez « Contrôle sur papier » si vous expédiez du surgelé.</InlineAlert>}
        </div>
      </article>

      <p className="px-1 text-xs text-a-text-3">Un changement s’applique aux commandes dont la préparation n’a pas encore commencé. Les commandes déjà en préparation gardent leur mode jusqu’au bout. Chaque modification est enregistrée dans le journal d’activité.</p>

      {canManage && available && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-a-border bg-a-surface px-4 py-3 shadow-sm backdrop-blur">
          {dirty && <span className="mr-auto text-sm font-medium text-tone-warning-fg">Modifications non enregistrées</span>}
          <SettingsFeedback feedback={feedback} />
          <Button type="button" variant="outline" onClick={() => setForm(saved)} disabled={!dirty || saving} className="min-h-11">Annuler</Button>
          <Button type="button" onClick={() => void save()} disabled={disabled || !dirty} loading={saving} className="min-h-11">Enregistrer</Button>
        </div>
      )}
    </div>
  );
}
