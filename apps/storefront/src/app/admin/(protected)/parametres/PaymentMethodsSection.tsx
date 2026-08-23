'use client';

import { useState } from 'react';
import { IconCreditCard, IconPlus, IconTrash } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import { PAYMENT_METHOD_REGISTRY, type TenantPaymentMethod, type PaymentMethodType, type PaymentModule } from '@lepefy/types';

const INPUT_CLS =
  'w-full min-h-10 rounded-xl border border-[var(--admin-border)] bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LABEL_CLS = 'mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400';

const METHOD_OPTIONS: PaymentMethodType[] = ['satispay', 'bank_transfer', 'cash', 'paypal', 'other', 'card'];

const MODULE_OPTIONS: { value: PaymentModule; label: string }[] = [
  { value: 'shop', label: 'Boutique' },
  { value: 'card', label: 'Carte /card' },
  { value: 'event', label: 'Événements' },
  { value: 'rental', label: 'Location' },
];

function hasNoValueFields(method: PaymentMethodType): boolean {
  return method === 'cash' || method === 'card';
}

interface FormState {
  method: PaymentMethodType;
  label: string;
  value: string;
  beneficiary: string;
  bic: string;
  link: string;
  sort_order: string;
  active: boolean;
  enabled_modules: PaymentModule[];
}

function emptyForm(sortOrder: number): FormState {
  return {
    method: 'bank_transfer',
    label: '',
    value: '',
    beneficiary: '',
    bic: '',
    link: '',
    sort_order: String(sortOrder),
    active: true,
    enabled_modules: ['shop', 'card', 'event', 'rental'],
  };
}

function toForm(pm: TenantPaymentMethod): FormState {
  return {
    method: pm.method,
    label: pm.label ?? '',
    value: pm.value ?? '',
    beneficiary: pm.extra?.beneficiary ?? '',
    bic: pm.extra?.bic ?? '',
    link: pm.extra?.link ?? '',
    sort_order: String(pm.sort_order),
    active: pm.active,
    enabled_modules: pm.enabled_modules,
  };
}

function formToBody(form: FormState) {
  return {
    method: form.method,
    label: form.label || null,
    value: form.value || null,
    extra: hasNoValueFields(form.method)
      ? null
      : {
          ...(form.method === 'bank_transfer' ? { beneficiary: form.beneficiary, bic: form.bic } : {}),
          link: form.link,
        },
    sort_order: form.sort_order,
    active: form.active,
    enabled_modules: form.enabled_modules,
  };
}

function toggleModule(current: PaymentModule[], module: PaymentModule): PaymentModule[] {
  return current.includes(module)
    ? current.filter((m) => m !== module)
    : [...current, module];
}

function ModulesCheckboxGroup({
  idPrefix,
  selected,
  onChange,
}: {
  idPrefix: string;
  selected: PaymentModule[];
  onChange: (next: PaymentModule[]) => void;
}) {
  return (
    <div>
      <label className={LABEL_CLS}>Modules où ce moyen est proposé</label>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {MODULE_OPTIONS.map((opt) => {
          const checkboxId = `${idPrefix}-module-${opt.value}`;
          const isSelected = selected.includes(opt.value);
          return (
            <label
              key={opt.value}
              htmlFor={checkboxId}
              className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border px-3 text-sm transition ${
                isSelected
                  ? 'border-[#D9D3FF] bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]'
                  : 'border-[var(--admin-border)] bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900'
              }`}
            >
              <input
                type="checkbox"
                id={checkboxId}
                checked={isSelected}
                onChange={() => onChange(toggleModule(selected, opt.value))}
                className="h-4 w-4 accent-[var(--admin-primary)]"
              />
              <span className="font-medium">{opt.label}</span>
            </label>
          );
        })}
      </div>
      {selected.length === 0 && (
        <p className="mt-2 text-xs font-medium text-red-600">Sélectionnez au moins un module.</p>
      )}
    </div>
  );
}

interface PaymentMethodsSectionProps {
  initialMethods: TenantPaymentMethod[];
}

export function PaymentMethodsSection({ initialMethods }: PaymentMethodsSectionProps) {
  const [methods, setMethods] = useState<TenantPaymentMethod[]>(initialMethods);
  const [newForm, setNewForm] = useState<FormState>(emptyForm(initialMethods.length));
  const [isSaving, setIsSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleCreate() {
    setIsSaving('new');
    try {
      const res = await fetch('/api/admin/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToBody(newForm)),
      });
      if (!res.ok) throw new Error();
      const created = await res.json() as TenantPaymentMethod;
      setMethods((prev) => [...prev, created]);
      setNewForm(emptyForm(methods.length + 1));
      showToast('Moyen de paiement ajouté', 'success');
    } catch {
      showToast('Erreur lors de l\'ajout', 'error');
    } finally {
      setIsSaving(null);
    }
  }

  async function handleUpdate(id: string, form: FormState) {
    setIsSaving(id);
    try {
      const res = await fetch(`/api/admin/payment-methods/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToBody(form)),
      });
      if (!res.ok) throw new Error();
      showToast('Enregistré', 'success');
    } catch {
      showToast('Erreur lors de l\'enregistrement', 'error');
    } finally {
      setIsSaving(null);
    }
  }

  async function handleDelete(id: string) {
    setIsSaving(id);
    try {
      const res = await fetch(`/api/admin/payment-methods/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setMethods((prev) => prev.filter((m) => m.id !== id));
      showToast('Moyen de paiement supprimé', 'success');
    } catch {
      showToast('Erreur lors de la suppression', 'error');
    } finally {
      setIsSaving(null);
    }
  }

  function updateMethodField(id: string, field: keyof FormState, value: string | boolean | PaymentModule[]) {
    setMethods((prev) => prev.map((m) => {
      if (m.id !== id) return m;
      const form = { ...toForm(m), [field]: value };
      return {
        ...m,
        method: form.method,
        label: form.label || null,
        value: form.value || null,
        extra: hasNoValueFields(form.method)
          ? null
          : {
              ...(form.method === 'bank_transfer' ? { beneficiary: form.beneficiary, bic: form.bic } : {}),
              link: form.link,
            },
        sort_order: parseInt(form.sort_order, 10) || 0,
        active: form.active,
        enabled_modules: form.enabled_modules,
      };
    }));
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#E8E4FF] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="flex items-start gap-3 border-b border-[#E8E4FF] bg-[var(--admin-primary-soft)] px-4 py-4 dark:border-gray-800 dark:bg-gray-900 sm:px-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/90 text-[var(--admin-primary-fg)] shadow-sm dark:bg-gray-800">
          <IconCreditCard size={20} stroke={1.7} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[var(--admin-primary-fg)] dark:text-violet-200">Moyens de paiement</h2>
          <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">
            Configurez les moyens visibles par vos clients et les services où ils sont disponibles.
          </p>
        </div>
      </header>

      <div className="p-4 sm:p-5">
        {toast && (
          <div className={`mb-4 rounded-xl border px-3 py-2.5 text-xs font-medium ${toast.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {toast.msg}
          </div>
        )}

        <div className="space-y-4">
          {methods.map((pm, index) => {
            const form = toForm(pm);
            return (
              <article key={pm.id} className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white dark:border-gray-800 dark:bg-gray-950/30">
                <div className="flex flex-col gap-3 border-b border-[var(--admin-border)] bg-[var(--admin-surface-subtle)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800 dark:bg-gray-900/70">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[var(--admin-primary-fg)] shadow-sm dark:bg-gray-800">
                      <span className="text-xs font-bold">{index + 1}</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {form.label || PAYMENT_METHOD_REGISTRY[form.method].label}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {PAYMENT_METHOD_REGISTRY[form.method].label}
                      </p>
                    </div>
                  </div>
                  <label className="inline-flex min-h-9 items-center gap-2 self-start rounded-full border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300 sm:self-auto">
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => updateMethodField(pm.id, 'active', e.target.checked)}
                      id={`active-${pm.id}`}
                      className="h-4 w-4 accent-[var(--admin-primary)]"
                    />
                    {form.active ? 'Actif' : 'Inactif'}
                  </label>
                </div>

                <div className="space-y-4 p-4 sm:p-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS}>Méthode</label>
                      <select
                        value={form.method}
                        onChange={(e) => updateMethodField(pm.id, 'method', e.target.value)}
                        className={INPUT_CLS}
                      >
                        {METHOD_OPTIONS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_REGISTRY[m].label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Étiquette (optionnel)</label>
                      <input
                        type="text"
                        value={form.label}
                        onChange={(e) => updateMethodField(pm.id, 'label', e.target.value)}
                        placeholder={PAYMENT_METHOD_REGISTRY[form.method].label}
                        className={INPUT_CLS}
                      />
                    </div>
                  </div>

                  {!hasNoValueFields(form.method) && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Lien de paiement direct (optionnel)</label>
                        <input
                          type="text"
                          value={form.link}
                          onChange={(e) => updateMethodField(pm.id, 'link', e.target.value)}
                          placeholder="https://paypal.me/... ou lien de paiement"
                          className={INPUT_CLS}
                        />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Valeur (IBAN / lien)</label>
                        <input
                          type="text"
                          value={form.value}
                          onChange={(e) => updateMethodField(pm.id, 'value', e.target.value)}
                          className={INPUT_CLS}
                        />
                      </div>
                    </div>
                  )}

                  {form.method === 'bank_transfer' && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className={LABEL_CLS}>Bénéficiaire</label>
                        <input type="text" value={form.beneficiary} onChange={(e) => updateMethodField(pm.id, 'beneficiary', e.target.value)} className={INPUT_CLS} />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>BIC</label>
                        <input type="text" value={form.bic} onChange={(e) => updateMethodField(pm.id, 'bic', e.target.value)} className={INPUT_CLS} />
                      </div>
                    </div>
                  )}

                  <ModulesCheckboxGroup
                    idPrefix={pm.id}
                    selected={form.enabled_modules}
                    onChange={(next) => updateMethodField(pm.id, 'enabled_modules', next)}
                  />

                  <div className="max-w-[180px]">
                    <label className={LABEL_CLS}>Ordre d’affichage</label>
                    <input type="number" value={form.sort_order} onChange={(e) => updateMethodField(pm.id, 'sort_order', e.target.value)} className={INPUT_CLS} />
                  </div>
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--admin-border)] bg-[#FCFBFF] px-4 py-3 dark:border-gray-800 dark:bg-gray-900/70 sm:px-5">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Les modifications s’appliquent aux services sélectionnés après enregistrement.</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDelete(pm.id)}
                      disabled={isSaving === pm.id}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950"
                    >
                      <IconTrash size={14} stroke={1.5} />
                      Supprimer
                    </button>
                    <Button size="sm" onClick={() => handleUpdate(pm.id, toForm(pm))} loading={isSaving === pm.id} disabled={form.enabled_modules.length === 0}>
                      Enregistrer
                    </Button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-dashed border-[#CFC7FF] bg-[var(--admin-primary-soft)]/40 dark:border-gray-700 dark:bg-gray-950/20">
          <div className="flex items-start gap-3 border-b border-[#E8E4FF] px-4 py-3.5 dark:border-gray-800 sm:px-5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[var(--admin-primary-fg)] shadow-sm dark:bg-gray-800">
              <IconPlus size={18} stroke={1.7} />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Ajouter un moyen de paiement</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Ajoutez une nouvelle méthode et choisissez immédiatement sa portée.</p>
            </div>
          </div>

          <div className="space-y-4 bg-white/70 p-4 dark:bg-gray-900/60 sm:p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>Méthode</label>
                <select value={newForm.method} onChange={(e) => setNewForm({ ...newForm, method: e.target.value as PaymentMethodType })} className={INPUT_CLS}>
                  {METHOD_OPTIONS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_REGISTRY[m].label}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Étiquette (optionnel)</label>
                <input type="text" value={newForm.label} onChange={(e) => setNewForm({ ...newForm, label: e.target.value })} placeholder={PAYMENT_METHOD_REGISTRY[newForm.method].label} className={INPUT_CLS} />
              </div>
            </div>

            {!hasNoValueFields(newForm.method) && (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Lien de paiement direct (optionnel)</label>
                  <input type="text" value={newForm.link} onChange={(e) => setNewForm({ ...newForm, link: e.target.value })} placeholder="https://paypal.me/... ou lien de paiement" className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Valeur (IBAN / lien)</label>
                  <input type="text" value={newForm.value} onChange={(e) => setNewForm({ ...newForm, value: e.target.value })} className={INPUT_CLS} />
                </div>
              </div>
            )}

            {newForm.method === 'bank_transfer' && (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Bénéficiaire</label>
                  <input type="text" value={newForm.beneficiary} onChange={(e) => setNewForm({ ...newForm, beneficiary: e.target.value })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>BIC</label>
                  <input type="text" value={newForm.bic} onChange={(e) => setNewForm({ ...newForm, bic: e.target.value })} className={INPUT_CLS} />
                </div>
              </div>
            )}

            <ModulesCheckboxGroup idPrefix="new" selected={newForm.enabled_modules} onChange={(next) => setNewForm({ ...newForm, enabled_modules: next })} />

            <div className="flex justify-end border-t border-[#E8E4FF] pt-4 dark:border-gray-800">
              <Button onClick={handleCreate} loading={isSaving === 'new'} disabled={newForm.enabled_modules.length === 0}>
                {isSaving !== 'new' && <IconPlus size={14} stroke={1.5} />}
                Ajouter
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
