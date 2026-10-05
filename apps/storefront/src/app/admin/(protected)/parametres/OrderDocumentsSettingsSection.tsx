'use client';

import { useMemo, useState } from 'react';
import { IconFileText, IconPackage } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import { ORDER_DOCUMENT_FORMAT_IDS, ORDER_DOCUMENT_FORMATS, orderDocumentFormatOptionLabel, type OrderDocumentFormat } from '@/lib/orders/documents/formats';
import type { OrderDocumentsConfig } from '@/lib/orders/documents/settings';
import { SettingsFeedback, SettingsIconTile, SETTINGS_HINT_CLS, SETTINGS_INPUT_CLS, SETTINGS_LABEL_CLS } from './_components/SettingsUi';
import { useSettingsFeedback } from './_components/useSettingsFeedback';

type Form = Omit<OrderDocumentsConfig, 'version'>;
type ContentKey = 'packing_slip_show_logo' | 'packing_slip_show_qr' | 'packing_slip_show_thank_you' | 'packing_slip_show_contact' | 'packing_slip_show_prices' | 'packing_slip_show_delivery_address';

const CONTENT: ReadonlyArray<{ key: ContentKey; label: string; hint?: string }> = [
  { key: 'packing_slip_show_logo', label: 'Logo' },
  { key: 'packing_slip_show_qr', label: 'QR code', hint: 'Suivi, aide et nouvelle commande, sans connexion.' },
  { key: 'packing_slip_show_thank_you', label: 'Message de remerciement' },
  { key: 'packing_slip_show_contact', label: 'Contact', hint: 'Site, WhatsApp et e-mail configurés pour la boutique.' },
  { key: 'packing_slip_show_prices', label: 'Prix', hint: 'Masqués par défaut : un colis peut être un cadeau.' },
  { key: 'packing_slip_show_delivery_address', label: 'Adresse de livraison' },
];

function toForm(config: OrderDocumentsConfig): Form {
  const { version: _version, ...form } = config;
  return form;
}

function FormatSelect({ id, value, onChange, disabled }: { id: string; value: OrderDocumentFormat; onChange: (v: OrderDocumentFormat) => void; disabled: boolean }) {
  return (
    <select id={id} className={`${SETTINGS_INPUT_CLS} max-w-xs`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as OrderDocumentFormat)}>
      {ORDER_DOCUMENT_FORMAT_IDS.map((format) => <option key={format} value={format}>{orderDocumentFormatOptionLabel(format)}</option>)}
    </select>
  );
}

/** Préférences tenant_feature_settings('order_documents') — migration 145. */
export function OrderDocumentsSettingsSection({ initial, available, invalid, canManage }: { initial: OrderDocumentsConfig; available: boolean; invalid: boolean; canManage: boolean }) {
  const [saved, setSaved] = useState<Form>(() => toForm(initial));
  const [form, setForm] = useState<Form>(() => toForm(initial));
  const [saving, setSaving] = useState(false);
  const { feedback, show } = useSettingsFeedback();
  const disabled = !available || !canManage || saving;
  const dirty = useMemo(() => (Object.keys(form) as Array<keyof Form>).some((key) => form[key] !== saved[key]), [form, saved]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/order-documents/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: form }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; config?: OrderDocumentsConfig };
      if (!response.ok || !body.config) throw new Error(body.error || 'Enregistrement impossible.');
      const next = toForm(body.config);
      setSaved(next);
      setForm(next);
      show('Préférences des documents enregistrées.', 'success');
    } catch (error) {
      show(error instanceof Error ? error.message : 'Enregistrement impossible.', 'error');
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {!available && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">La migration 145 doit être appliquée pour enregistrer ces préférences. Les valeurs par défaut ci-dessous s’appliquent en attendant.</p>}
      {available && invalid && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">Les préférences enregistrées sont invalides : les valeurs par défaut s’appliquent. Vérifiez puis enregistrez.</p>}
      {available && !canManage && <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">Lecture seule : la modification demande la gestion des paramètres.</p>}

      <article id="liste-preparation" aria-labelledby="liste-preparation-title" className="scroll-mt-24 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <header className="flex items-start gap-4 border-b border-gray-100 px-4 py-4 sm:px-6 dark:border-gray-800">
          <SettingsIconTile icon={IconFileText} accent="blue" />
          <div className="min-w-0">
            <h2 id="liste-preparation-title" className="text-base font-semibold text-gray-950 dark:text-gray-100">Liste de préparation</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Document interne : articles, emplacements, chaîne du froid et emballage suggéré.</p>
          </div>
        </header>
        <div className="px-4 py-5 sm:px-6">
          <label htmlFor="doc-picking-format" className={SETTINGS_LABEL_CLS}>Format par défaut</label>
          <FormatSelect id="doc-picking-format" value={form.picking_list_format} onChange={(v) => set('picking_list_format', v)} disabled={disabled} />
          <p className={SETTINGS_HINT_CLS}>{ORDER_DOCUMENT_FORMATS[form.picking_list_format].description} Modifiable à chaque impression.</p>
          <label className="mt-4 flex min-h-11 items-start gap-2.5 py-1 text-sm text-gray-800 dark:text-gray-200">
            <input type="checkbox" disabled={disabled} checked={form.picking_list_show_delivery_address} onChange={(e) => set('picking_list_show_delivery_address', e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--admin-primary)]" />
            <span>Adresse de livraison complète<span className="block text-xs text-gray-500 dark:text-gray-400">Par défaut, seuls le code postal et la ville sont imprimés. Livraisons uniquement.</span></span>
          </label>
        </div>
      </article>

      <article id="bon-de-colis" aria-labelledby="bon-de-colis-title" className="scroll-mt-24 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <header className="flex items-start gap-4 border-b border-gray-100 px-4 py-4 sm:px-6 dark:border-gray-800">
          <SettingsIconTile icon={IconPackage} accent="emerald" />
          <div className="min-w-0 flex-1">
            <h2 id="bon-de-colis-title" className="text-base font-semibold text-gray-950 dark:text-gray-100">Bon de colis</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Récapitulatif client à glisser dans le colis, sans aucune donnée interne.</p>
          </div>
        </header>
        <div className="space-y-5 px-4 py-5 sm:px-6">
          <label className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-800">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Inclure le bon dans le colis</span>
            <input type="checkbox" disabled={disabled} checked={form.packing_slip_enabled} onChange={(e) => set('packing_slip_enabled', e.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--admin-primary)]" />
          </label>
          <fieldset disabled={disabled || !form.packing_slip_enabled} className="space-y-5 disabled:opacity-60">
            <legend className="sr-only">Format et contenu du bon de colis</legend>
            <div>
              <label htmlFor="doc-packing-format" className={SETTINGS_LABEL_CLS}>Format</label>
              <FormatSelect id="doc-packing-format" value={form.packing_slip_format} onChange={(v) => set('packing_slip_format', v)} disabled={disabled || !form.packing_slip_enabled} />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Contenu</p>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                <li className="flex min-h-11 items-center gap-2.5 text-sm text-gray-500 dark:text-gray-400">
                  <input type="checkbox" checked readOnly disabled aria-label="Articles (toujours inclus)" className="h-5 w-5 shrink-0" /> <span>Articles (toujours inclus)</span>
                </li>
                {CONTENT.map(({ key, label, hint }) => (
                  <li key={key}>
                    <label className="flex min-h-11 items-start gap-2.5 py-1 text-sm text-gray-800 dark:text-gray-200">
                      <input type="checkbox" checked={form[key]} onChange={(e) => set(key, e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--admin-primary)]" />
                      <span>{label}{hint && <span className="block text-xs text-gray-500 dark:text-gray-400">{hint}</span>}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </fieldset>
        </div>
      </article>

      {canManage && available && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-gray-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
          {dirty && <span className="mr-auto text-sm font-medium text-amber-800 dark:text-amber-300">Modifications non enregistrées</span>}
          <SettingsFeedback feedback={feedback} />
          <Button type="button" variant="outline" onClick={() => setForm(saved)} disabled={!dirty || saving} className="min-h-11">Annuler</Button>
          <Button type="button" onClick={() => void save()} disabled={disabled || !dirty} loading={saving} className="min-h-11">Enregistrer</Button>
        </div>
      )}
    </div>
  );
}
