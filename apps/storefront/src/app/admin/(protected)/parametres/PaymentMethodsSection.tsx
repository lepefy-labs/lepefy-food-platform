'use client';

import { useState } from 'react';
import { IconTrash, IconPlus } from '@tabler/icons-react';
import { PAYMENT_METHOD_REGISTRY, type TenantPaymentMethod, type PaymentMethodType } from '@lepefy/types';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

const METHOD_OPTIONS: PaymentMethodType[] = ['satispay', 'bank_transfer', 'cash', 'paypal', 'other'];

interface FormState {
  method: PaymentMethodType;
  label: string;
  value: string;
  beneficiary: string;
  bic: string;
  sort_order: string;
  active: boolean;
}

function emptyForm(sortOrder: number): FormState {
  return { method: 'bank_transfer', label: '', value: '', beneficiary: '', bic: '', sort_order: String(sortOrder), active: true };
}

function toForm(pm: TenantPaymentMethod): FormState {
  return {
    method: pm.method,
    label: pm.label ?? '',
    value: pm.value ?? '',
    beneficiary: pm.extra?.beneficiary ?? '',
    bic: pm.extra?.bic ?? '',
    sort_order: String(pm.sort_order),
    active: pm.active,
  };
}

function formToBody(form: FormState) {
  return {
    method: form.method,
    label: form.label || null,
    value: form.value || null,
    extra: form.method === 'bank_transfer' ? { beneficiary: form.beneficiary, bic: form.bic } : null,
    sort_order: form.sort_order,
    active: form.active,
  };
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

  function updateMethodField(id: string, field: keyof FormState, value: string | boolean) {
    setMethods((prev) => prev.map((m) => {
      if (m.id !== id) return m;
      const form = { ...toForm(m), [field]: value };
      return {
        ...m,
        method: form.method,
        label: form.label || null,
        value: form.value || null,
        extra: form.method === 'bank_transfer' ? { beneficiary: form.beneficiary, bic: form.bic } : null,
        sort_order: parseInt(form.sort_order, 10) || 0,
        active: form.active,
      };
    }));
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">Moyens de paiement</h2>
      <p className="text-xs text-gray-400 mb-4">
        Affichés dans la section « Comment payer » de la carte digitale.
      </p>

      {toast && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.msg}
        </div>
      )}

      <div className="space-y-4 mb-6">
        {methods.map((pm) => {
          const form = toForm(pm);
          return (
            <div key={pm.id} className="border border-gray-100 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={LABEL_CLS}>Méthode</label>
                  <select
                    value={form.method}
                    onChange={(e) => updateMethodField(pm.id, 'method', e.target.value)}
                    className={INPUT_CLS}
                  >
                    {METHOD_OPTIONS.map((m) => (
                      <option key={m} value={m}>{PAYMENT_METHOD_REGISTRY[m].label}</option>
                    ))}
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

              {form.method !== 'cash' && (
                <div className="mb-3">
                  <label className={LABEL_CLS}>Valeur (IBAN / lien)</label>
                  <input
                    type="text"
                    value={form.value}
                    onChange={(e) => updateMethodField(pm.id, 'value', e.target.value)}
                    className={INPUT_CLS}
                  />
                </div>
              )}

              {form.method === 'bank_transfer' && (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className={LABEL_CLS}>Bénéficiaire</label>
                    <input
                      type="text"
                      value={form.beneficiary}
                      onChange={(e) => updateMethodField(pm.id, 'beneficiary', e.target.value)}
                      className={INPUT_CLS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>BIC</label>
                    <input
                      type="text"
                      value={form.bic}
                      onChange={(e) => updateMethodField(pm.id, 'bic', e.target.value)}
                      className={INPUT_CLS}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={LABEL_CLS}>Ordre</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) => updateMethodField(pm.id, 'sort_order', e.target.value)}
                    className={INPUT_CLS}
                  />
                </div>
                <div className="flex items-end gap-2 pb-2">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => updateMethodField(pm.id, 'active', e.target.checked)}
                    id={`active-${pm.id}`}
                  />
                  <label htmlFor={`active-${pm.id}`} className="text-sm text-gray-600">Actif</label>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleUpdate(pm.id, toForm(pm))}
                  disabled={isSaving === pm.id}
                  className="px-3 py-1.5 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50"
                >
                  Enregistrer
                </button>
                <button
                  onClick={() => handleDelete(pm.id)}
                  disabled={isSaving === pm.id}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 flex items-center gap-1 disabled:opacity-50"
                >
                  <IconTrash size={14} stroke={1.5} />
                  Supprimer
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border border-dashed border-gray-200 rounded-lg p-4">
        <p className="text-xs font-medium text-gray-500 mb-3">Ajouter un moyen de paiement</p>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className={LABEL_CLS}>Méthode</label>
            <select
              value={newForm.method}
              onChange={(e) => setNewForm({ ...newForm, method: e.target.value as PaymentMethodType })}
              className={INPUT_CLS}
            >
              {METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>{PAYMENT_METHOD_REGISTRY[m].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Étiquette (optionnel)</label>
            <input
              type="text"
              value={newForm.label}
              onChange={(e) => setNewForm({ ...newForm, label: e.target.value })}
              placeholder={PAYMENT_METHOD_REGISTRY[newForm.method].label}
              className={INPUT_CLS}
            />
          </div>
        </div>

        {newForm.method !== 'cash' && (
          <div className="mb-3">
            <label className={LABEL_CLS}>Valeur (IBAN / lien)</label>
            <input
              type="text"
              value={newForm.value}
              onChange={(e) => setNewForm({ ...newForm, value: e.target.value })}
              className={INPUT_CLS}
            />
          </div>
        )}

        {newForm.method === 'bank_transfer' && (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={LABEL_CLS}>Bénéficiaire</label>
              <input
                type="text"
                value={newForm.beneficiary}
                onChange={(e) => setNewForm({ ...newForm, beneficiary: e.target.value })}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>BIC</label>
              <input
                type="text"
                value={newForm.bic}
                onChange={(e) => setNewForm({ ...newForm, bic: e.target.value })}
                className={INPUT_CLS}
              />
            </div>
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={isSaving === 'new'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50"
        >
          <IconPlus size={14} stroke={1.5} />
          Ajouter
        </button>
      </div>
    </section>
  );
}
