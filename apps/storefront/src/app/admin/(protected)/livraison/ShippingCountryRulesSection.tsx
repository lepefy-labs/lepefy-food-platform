'use client';

import { useState, Fragment } from 'react';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import type { ShippingCountryRuleRow, ShippingDiscountType } from '@lepefy/types';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

// Mêmes pays que le sélecteur d'adresse du panier (CartClient.tsx) — seuls
// pays pour lesquels un devis de livraison a un sens sur cette plateforme.
const COUNTRIES = [
  { value: 'IT', label: 'Italie' },
  { value: 'FR', label: 'France' },
  { value: 'BE', label: 'Belgique' },
  { value: 'DE', label: 'Allemagne' },
  { value: 'CH', label: 'Suisse' },
];

const ALL_COUNTRIES = '*';

interface FormState {
  allCountries: boolean;
  countries: string[];
  free_shipping_above: string;
  flat_rate_override: string;
  discount_type: '' | ShippingDiscountType;
  discount_value: string;
  active: boolean;
  note: string;
}

function toFormState(rule?: ShippingCountryRuleRow): FormState {
  const allCountries = rule?.countries.includes(ALL_COUNTRIES) ?? false;
  return {
    allCountries,
    countries:            allCountries ? [] : (rule?.countries ?? []),
    free_shipping_above:  rule?.free_shipping_above  != null ? String(rule.free_shipping_above)  : '',
    flat_rate_override:   rule?.flat_rate_override   != null ? String(rule.flat_rate_override)   : '',
    discount_type:        rule?.discount_type ?? '',
    discount_value:       rule?.discount_value != null ? String(rule.discount_value) : '',
    active:                rule?.active ?? true,
    note:                  rule?.note ?? '',
  };
}

function formToBody(form: FormState) {
  return {
    countries:            form.allCountries ? [ALL_COUNTRIES] : form.countries,
    free_shipping_above:  form.free_shipping_above.trim() === '' ? null : Number(form.free_shipping_above),
    flat_rate_override:   form.flat_rate_override.trim()  === '' ? null : Number(form.flat_rate_override),
    discount_type:        form.discount_type || null,
    discount_value:       form.discount_type ? Number(form.discount_value) : null,
    active:               form.active,
    note:                  form.note.trim() || null,
  };
}

function validate(form: FormState): string | null {
  if (!form.allCountries && form.countries.length === 0) {
    return 'Sélectionnez au moins un pays, ou « Tous les pays ».';
  }
  if (form.discount_type && (!form.discount_value || Number(form.discount_value) <= 0)) {
    return 'Indiquez une valeur de remise supérieure à 0.';
  }
  if (form.discount_type === 'percentage' && Number(form.discount_value) > 100) {
    return 'Une remise en pourcentage ne peut pas dépasser 100%.';
  }
  return null;
}

function countryLabel(code: string): string {
  return COUNTRIES.find((c) => c.value === code)?.label ?? code;
}

// ─── Form ─────────────────────────────────────────────────────────────────────

interface RuleFormProps {
  initial?: ShippingCountryRuleRow;
  currency: string;
  submitLabel: string;
  isSaving: boolean;
  onSubmit: (form: FormState) => void;
  onCancel?: () => void;
}

function RuleForm({ initial, currency, submitLabel, isSaving, onSubmit, onCancel }: RuleFormProps) {
  const [form, setForm] = useState<FormState>(toFormState(initial));
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleCountry(code: string) {
    setForm((prev) => ({
      ...prev,
      countries: prev.countries.includes(code)
        ? prev.countries.filter((c) => c !== code)
        : [...prev.countries, code],
    }));
  }

  function handleSubmit() {
    const validationError = validate(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    onSubmit(form);
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="px-3 py-2 rounded-lg text-xs bg-red-50 text-red-700">{error}</div>
      )}

      <div>
        <label className={LABEL_CLS}>Pays</label>
        <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
          <input
            type="checkbox"
            checked={form.allCountries}
            onChange={(e) => set('allCountries', e.target.checked)}
          />
          Tous les pays
        </label>
        {!form.allCountries && (
          <div className="flex flex-wrap gap-3">
            {COUNTRIES.map((c) => (
              <label key={c.value} className="flex items-center gap-1.5 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={form.countries.includes(c.value)}
                  onChange={() => toggleCountry(c.value)}
                />
                {c.label}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLS}>Gratuité dès ({currency}, optionnel)</label>
          <input
            type="number" step="0.01" min={0}
            value={form.free_shipping_above}
            onChange={(e) => set('free_shipping_above', e.target.value)}
            placeholder="Ex. 60"
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Forfait fixe ({currency}, optionnel)</label>
          <input
            type="number" step="0.01" min={0}
            value={form.flat_rate_override}
            onChange={(e) => set('flat_rate_override', e.target.value)}
            placeholder="Bypass Packlink"
            className={INPUT_CLS}
          />
        </div>
      </div>
      <p className="text-xs text-gray-400 -mt-1">
        Un forfait fixe remplace entièrement le calcul Packlink pour ce(s) pays — aucun appel API n&apos;est effectué.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLS}>Remise</label>
          <select
            value={form.discount_type}
            onChange={(e) => set('discount_type', e.target.value as FormState['discount_type'])}
            className={INPUT_CLS}
          >
            <option value="">Aucune</option>
            <option value="percentage">Pourcentage</option>
            <option value="fixed">Montant fixe</option>
          </select>
        </div>
        {form.discount_type && (
          <div>
            <label className={LABEL_CLS}>
              Valeur ({form.discount_type === 'percentage' ? '%' : currency})
            </label>
            <input
              type="number" step="0.01" min={0} max={form.discount_type === 'percentage' ? 100 : undefined}
              value={form.discount_value}
              onChange={(e) => set('discount_value', e.target.value)}
              className={INPUT_CLS}
            />
          </div>
        )}
      </div>

      <div>
        <label className={LABEL_CLS}>Note interne (optionnel)</label>
        <input
          type="text"
          value={form.note}
          onChange={(e) => set('note', e.target.value)}
          className={INPUT_CLS}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`active-${initial?.id ?? 'new'}`}
          checked={form.active}
          onChange={(e) => set('active', e.target.checked)}
          className="w-5 h-5"
        />
        <label htmlFor={`active-${initial?.id ?? 'new'}`} className="text-sm text-gray-600">Actif</label>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={isSaving}
          className="min-h-11 px-4 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50"
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="min-h-11 px-4 py-2 text-xs rounded-lg border border-gray-200 text-gray-500 disabled:opacity-50"
          >
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

interface ShippingCountryRulesSectionProps {
  initialRules: ShippingCountryRuleRow[];
  currency: string;
}

export function ShippingCountryRulesSection({ initialRules, currency }: ShippingCountryRulesSectionProps) {
  const [rules, setRules] = useState<ShippingCountryRuleRow[]>(
    [...initialRules].sort((a, b) => a.position - b.position),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleCreate(form: FormState) {
    setSavingId('new');
    try {
      const res = await fetch('/api/admin/shipping-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToBody(form)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erreur');
      setRules((prev) => [...prev, data as ShippingCountryRuleRow].sort((a, b) => a.position - b.position));
      setCreating(false);
      showToast('Règle ajoutée', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors de la création', 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function patchRule(id: string, payload: object): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/shipping-rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Erreur');
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Erreur lors de l'enregistrement", 'error');
      return false;
    }
  }

  async function handleUpdate(id: string, form: FormState) {
    setSavingId(id);
    const body = formToBody(form);
    const ok = await patchRule(id, body);
    if (ok) {
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...body } : r)));
      setEditingId(null);
      showToast('Enregistré', 'success');
    }
    setSavingId(null);
  }

  async function handleToggleActive(rule: ShippingCountryRuleRow) {
    setSavingId(rule.id);
    const ok = await patchRule(rule.id, { active: !rule.active });
    if (ok) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r)));
    }
    setSavingId(null);
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Supprimer définitivement cette règle ?')) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/shipping-rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setRules((prev) => prev.filter((r) => r.id !== id));
      showToast('Règle supprimée', 'success');
    } catch {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      {toast && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.msg}
        </div>
      )}

      {rules.length === 0 && !creating && (
        <p className="text-sm text-gray-400 mb-4">
          Aucune règle configurée — le calcul de livraison standard s&apos;applique sans modification.
        </p>
      )}

      {rules.length > 0 && (
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-2xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                <th className="py-2 pr-3">Pays</th>
                <th className="py-2 pr-3">Gratuité dès</th>
                <th className="py-2 pr-3">Forfait</th>
                <th className="py-2 pr-3">Remise</th>
                <th className="py-2 pr-3">Actif</th>
                <th className="py-2 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <Fragment key={rule.id}>
                  <tr className="border-b border-gray-50 dark:border-gray-800/60">
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {rule.countries.includes(ALL_COUNTRIES) ? (
                          <span className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                            Tous les pays
                          </span>
                        ) : (
                          rule.countries.map((c) => (
                            <span key={c} className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]">
                              {countryLabel(c)}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-300">
                      {rule.free_shipping_above != null ? formatPrice(rule.free_shipping_above, currency) : '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-300">
                      {rule.flat_rate_override != null ? formatPrice(rule.flat_rate_override, currency) : '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-gray-700 dark:text-gray-300">
                      {rule.discount_type
                        ? rule.discount_type === 'percentage'
                          ? `-${rule.discount_value}%`
                          : `-${formatPrice(rule.discount_value ?? 0, currency)}`
                        : '—'}
                    </td>
                    <td className="py-2.5 pr-3">
                      <input
                        type="checkbox"
                        checked={rule.active}
                        onChange={() => handleToggleActive(rule)}
                        disabled={savingId === rule.id}
                        className="w-5 h-5"
                      />
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => setEditingId(editingId === rule.id ? null : rule.id)}
                          className="min-h-8 px-3 py-1.5 text-xs rounded-lg border border-gray-200"
                        >
                          {editingId === rule.id ? 'Fermer' : 'Modifier'}
                        </button>
                        <button
                          onClick={() => handleDelete(rule.id)}
                          disabled={savingId === rule.id}
                          className="min-h-8 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-red-600 flex items-center gap-1 disabled:opacity-50"
                        >
                          <IconTrash size={14} stroke={1.5} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingId === rule.id && (
                    <tr>
                      <td colSpan={6} className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-4">
                        <RuleForm
                          initial={rule}
                          currency={currency}
                          submitLabel="Enregistrer"
                          isSaving={savingId === rule.id}
                          onSubmit={(form) => handleUpdate(rule.id, form)}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating ? (
        <div className="border border-dashed border-gray-200 rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 mb-3">Nouvelle règle</p>
          <RuleForm
            currency={currency}
            submitLabel="Ajouter"
            isSaving={savingId === 'new'}
            onSubmit={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="min-h-11 flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg text-white bg-[var(--color-primary)]"
        >
          <IconPlus size={14} stroke={1.5} />
          Ajouter une règle
        </button>
      )}
    </section>
  );
}
