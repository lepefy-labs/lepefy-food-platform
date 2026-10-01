'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '../../../_components/ui/Button';
import { ErrorText, useGestionMutation } from '../_components/useGestionMutation';
import { HINT_CLS, INPUT_CLS, LABEL_CLS } from '../_components/ui';
import { PAYMENT_TERMS_PRESETS } from '@/lib/gestion/domain';

export interface SupplierFormValues {
  name: string;
  legal_name: string;
  contact_name: string;
  email: string;
  phone: string;
  whatsapp_phone: string;
  address: string;
  country: string;
  currency: string;
  notes: string;
  active: boolean;
  /** Jours (chaîne vide = non définies). */
  payment_terms: string;
}

const EMPTY: SupplierFormValues = {
  name: '', legal_name: '', contact_name: '', email: '', phone: '', whatsapp_phone: '',
  address: '', country: '', currency: 'EUR', notes: '', active: true, payment_terms: '',
};

/** Création (POST) ou modification (PATCH) d'un fournisseur. */
export function SupplierForm({ supplierId, initial, defaultCurrency, onDone }: {
  supplierId?: string; initial?: Partial<SupplierFormValues>; defaultCurrency: string; onDone?: () => void;
}) {
  const router = useRouter();
  const { run, pending, error, setError } = useGestionMutation();
  const [values, setValues] = useState<SupplierFormValues>({ ...EMPTY, currency: defaultCurrency, ...initial });
  const set = <K extends keyof SupplierFormValues>(key: K, value: SupplierFormValues[K]) => setValues((prev) => ({ ...prev, [key]: value }));
  const editing = Boolean(supplierId);
  const isPreset = values.payment_terms === '' || PAYMENT_TERMS_PRESETS.some((preset) => String(preset.value) === values.payment_terms);
  const [customTerms, setCustomTerms] = useState(!isPreset);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const { payment_terms, ...rest } = values;
    const days = payment_terms.trim() === '' ? null : Number(payment_terms);
    if (days !== null && (!Number.isInteger(days) || days < 0 || days > 3650)) {
      setError('Conditions de paiement : un nombre de jours entre 0 et 3650.');
      return;
    }
    const payload = { ...rest, default_payment_terms_days: days, country: rest.country.trim().toUpperCase(), currency: rest.currency.trim().toUpperCase() };
    if (editing) {
      const result = await run(`/api/admin/gestion/suppliers/${supplierId}`, { method: 'PATCH', body: payload });
      if (result) onDone?.();
      return;
    }
    const result = await run<{ id: string }>('/api/admin/gestion/suppliers', { body: payload, withKey: true, refresh: false });
    if (result) router.push(`/admin/gestion/fournisseurs/${result.id}`);
  }

  const text = (key: keyof SupplierFormValues, label: string, options: { type?: string; max?: number; hint?: string; required?: boolean; autoComplete?: string } = {}) => (
    <label className="block">
      <span className={LABEL_CLS}>{label}{options.required ? ' *' : ''}</span>
      <input
        className={INPUT_CLS} type={options.type ?? 'text'} value={String(values[key])} maxLength={options.max ?? 200}
        required={options.required} autoComplete={options.autoComplete ?? 'off'}
        onChange={(event) => set(key, event.target.value as never)}
      />
      {options.hint && <span className={HINT_CLS}>{options.hint}</span>}
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {text('name', 'Nom', { required: true, hint: 'Nom utilisé au quotidien, par exemple sur WhatsApp.' })}
        {text('legal_name', 'Raison sociale')}
        {text('contact_name', 'Contact')}
        {text('email', 'Email', { type: 'email', max: 254 })}
        {text('phone', 'Téléphone', { type: 'tel', max: 40 })}
        {text('whatsapp_phone', 'WhatsApp', { type: 'tel', max: 40 })}
        {text('country', 'Pays (code à 2 lettres)', { max: 2, hint: 'Par exemple IT, FR, SN.' })}
        {text('currency', 'Devise', { max: 3, hint: 'Devise des achats et paiements, par exemple EUR.' })}
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL_CLS}>Conditions de paiement</span>
          <select className={INPUT_CLS} value={customTerms ? 'custom' : values.payment_terms}
            onChange={(event) => {
              if (event.target.value === 'custom') { setCustomTerms(true); return; }
              setCustomTerms(false);
              set('payment_terms', event.target.value);
            }}>
            <option value="">Non définies</option>
            {PAYMENT_TERMS_PRESETS.map((preset) => <option key={preset.value} value={String(preset.value)}>{preset.label}</option>)}
            <option value="custom">Personnalisé</option>
          </select>
          <span className={HINT_CLS}>Échéance proposée pour les nouveaux achats : date de commande + délai. Les achats existants ne changent pas.</span>
        </label>
        {customTerms && (
          <label className="block">
            <span className={LABEL_CLS}>Délai en jours</span>
            <input inputMode="numeric" className={INPUT_CLS} value={values.payment_terms} onChange={(event) => set('payment_terms', event.target.value)} placeholder="45" />
          </label>
        )}
      </fieldset>
      <label className="block">
        <span className={LABEL_CLS}>Adresse</span>
        <textarea className={`${INPUT_CLS} min-h-20`} value={values.address} maxLength={500} onChange={(event) => set('address', event.target.value)} />
      </label>
      <label className="block">
        <span className={LABEL_CLS}>Notes internes</span>
        <textarea className={`${INPUT_CLS} min-h-24`} value={values.notes} maxLength={4000} onChange={(event) => set('notes', event.target.value)} />
      </label>
      {editing && (
        <label className="flex min-h-11 items-center gap-3 text-sm text-gray-800 dark:text-gray-200">
          <input type="checkbox" className="h-5 w-5 rounded border-gray-300" checked={values.active} onChange={(event) => set('active', event.target.checked)} />
          Fournisseur actif (un fournisseur inactif ne peut plus recevoir de nouvel achat)
        </label>
      )}
      <ErrorText message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending} className="min-h-11">{editing ? 'Enregistrer les modifications' : 'Créer le fournisseur'}</Button>
        {onDone && <button type="button" onClick={onDone} className="min-h-11 px-3 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300">Annuler</button>}
      </div>
    </form>
  );
}

export function SupplierEditToggle(props: { supplierId: string; initial: Partial<SupplierFormValues>; defaultCurrency: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100">
        Modifier le fournisseur
      </button>
    );
  }
  return <div className="w-full"><SupplierForm {...props} onDone={() => setOpen(false)} /></div>;
}
