'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import type { PaymentMethodType, TenantPaymentMethod } from '@lepefy/types';
import Button from '../../_components/ui/Button';
import { Drawer } from '../../_components/ui/Dialog';
import { useConfirm, useUnsavedChangesGuard } from '../../_components/ui/ConfirmDialog';
import { FormField, Input } from '../../_components/ui/Form';
import InlineAlert, { ErrorText } from '../../_components/ui/InlineAlert';
import { paymentMethodAvailability } from '@/lib/payments/paymentMethodAvailability';
import { cn } from '@/lib/utils/cn';
import {
  PAYMENT_METHOD_TYPES,
  PAYMENT_MODULES,
  PAYMENT_TYPE_DESCRIPTIONS,
  PAYMENT_TYPE_FIELDS,
  SINGLE_INSTANCE_TYPES,
  draftFromMethod,
  draftToBody,
  draftsEqual,
  emptyDraft,
  paymentMethodName,
  paymentTypeLabel,
  validateDraft,
  type PaymentMethodDraft,
  type PaymentMethodErrors,
  type PaymentMethodField,
} from '@/lib/payments/paymentMethodForm';
import { PaymentMethodIcon } from './PaymentMethodIcon';

export type PaymentMethodEditorTarget = { mode: 'create' } | { mode: 'edit'; method: TenantPaymentMethod };

interface PaymentMethodEditorProps {
  target: PaymentMethodEditorTarget | null;
  /** Types already configured, to disable the single-instance ones in the picker. */
  existingTypes: PaymentMethodType[];
  onClose: () => void;
  /** Persists the draft; resolves to an error message, or null on success. */
  onSave: (draft: PaymentMethodDraft) => Promise<string | null>;
}

const FIELD_ORDER: PaymentMethodField[] = ['link', 'value', 'beneficiary', 'bic'];

export function PaymentMethodEditor({ target, existingTypes, onClose, onSave }: PaymentMethodEditorProps) {
  const [draft, setDraft] = useState<PaymentMethodDraft | null>(null);
  const [initial, setInitial] = useState<PaymentMethodDraft | null>(null);
  const [touched, setTouched] = useState<Partial<Record<keyof PaymentMethodErrors, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm();

  useEffect(() => {
    setTouched({});
    setSaveError(null);
    if (target?.mode === 'edit') {
      const d = draftFromMethod(target.method);
      setDraft(d);
      setInitial(d);
    } else {
      setDraft(null);
      setInitial(null);
    }
  }, [target]);

  const dirty = Boolean(draft && initial && !draftsEqual(draft, initial));
  const guardDialog = useUnsavedChangesGuard(dirty, 'Les modifications de ce moyen de paiement seront perdues.');
  const errors = useMemo(() => (draft ? validateDraft(draft) : {}), [draft]);
  const isEdit = target?.mode === 'edit';
  // The draft as the customer paths would read it once saved.
  const draftAsMethod = useMemo(() => {
    if (!draft) return null;
    const body = draftToBody(draft);
    return { method: body.method, value: body.value, extra: body.extra };
  }, [draft]);
  const effectiveCount = draft && draftAsMethod
    ? draft.enabled_modules.filter((m) => paymentMethodAvailability(draftAsMethod, m).ok).length
    : 0;

  async function requestClose() {
    if (saving) return;
    if (dirty && !(await ask({ title: 'Quitter sans enregistrer ?', description: 'Les modifications de ce moyen de paiement seront perdues.', confirmLabel: 'Quitter sans enregistrer', cancelLabel: 'Continuer', destructive: true }))) return;
    onClose();
  }

  function pickType(method: PaymentMethodType) {
    const d = emptyDraft(method);
    setDraft(d);
    setInitial(d);
    setTouched({});
  }

  function update(patch: Partial<PaymentMethodDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function submit() {
    if (!draft) return;
    if (Object.keys(errors).length > 0) {
      setTouched({ label: true, link: true, value: true, beneficiary: true, bic: true, enabled_modules: true });
      return;
    }
    setSaving(true);
    setSaveError(null);
    const error = await onSave(draft);
    setSaving(false);
    if (error) setSaveError(error);
  }

  const fieldError = (key: keyof PaymentMethodErrors) => (touched[key] ? errors[key] ?? null : null);

  const title = isEdit && target.mode === 'edit'
    ? `Modifier « ${paymentMethodName(target.method)} »`
    : 'Ajouter un moyen de paiement';
  const description = isEdit
    ? 'Les changements s’appliquent dès l’enregistrement.'
    : draft ? 'Étape 2 sur 2 · Informations' : 'Étape 1 sur 2 · Choisissez le type';

  return (
    <>
      <Drawer
        open={target !== null}
        onClose={() => { void requestClose(); }}
        dismissible={!saving}
        title={title}
        description={description}
        footer={draft ? (
          <>
            {dirty && <span className="self-center text-xs font-medium text-tone-warning-fg sm:mr-auto">Modifications non enregistrées</span>}
            <Button variant="secondary" onClick={() => { void requestClose(); }} disabled={saving}>Annuler</Button>
            <Button onClick={() => { void submit(); }} loading={saving} disabled={isEdit && !dirty}>
              {isEdit ? 'Enregistrer' : 'Ajouter'}
            </Button>
          </>
        ) : undefined}
      >
        {!draft && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {PAYMENT_METHOD_TYPES.map((type) => {
              const taken = SINGLE_INSTANCE_TYPES.has(type) && existingTypes.includes(type);
              return (
                <li key={type}>
                  <button
                    type="button"
                    disabled={taken}
                    onClick={() => pickType(type)}
                    className="grid h-full w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 rounded-xl border border-a-border bg-a-surface p-3 text-left transition hover:border-a-brand hover:bg-a-brand-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-a-border disabled:hover:bg-a-surface"
                  >
                    <PaymentMethodIcon method={type} className="row-span-2" />
                    <span className="text-sm font-semibold text-a-text">{paymentTypeLabel(type)}</span>
                    <span className="text-xs leading-4 text-a-text-3">{taken ? 'Déjà ajouté' : PAYMENT_TYPE_DESCRIPTIONS[type]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {draft && (
          <form
            className="space-y-6"
            noValidate
            onSubmit={(event) => { event.preventDefault(); void submit(); }}
          >
            <div className="flex items-center gap-3 rounded-xl border border-a-border bg-a-surface-2 p-3">
              <PaymentMethodIcon method={draft.method} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-a-text">{paymentTypeLabel(draft.method)}</p>
                <p className="text-xs leading-4 text-a-text-3">
                  {isEdit ? 'Le type ne change pas après création : pour un autre type, ajoutez un nouveau moyen.' : PAYMENT_TYPE_DESCRIPTIONS[draft.method]}
                </p>
              </div>
              {!isEdit && (
                <Button variant="ghost" size="sm" onClick={() => { setDraft(null); setInitial(null); }}>
                  <IconArrowLeft size={14} aria-hidden="true" /> Changer
                </Button>
              )}
            </div>

            <fieldset className="space-y-4">
              <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-a-text-3">Informations</legend>
              <FormField
                label="Nom affiché au client"
                optional={draft.method !== 'other'}
                required={draft.method === 'other'}
                hint={draft.method === 'other' ? undefined : `Vide : « ${paymentTypeLabel(draft.method)} ».`}
                error={fieldError('label')}
              >
                <Input
                  value={draft.label}
                  placeholder={draft.method === 'other' ? 'Revolut' : paymentTypeLabel(draft.method)}
                  maxLength={60}
                  onChange={(e) => update({ label: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, label: true }))}
                />
              </FormField>

              {FIELD_ORDER.map((field) => {
                const spec = PAYMENT_TYPE_FIELDS[draft.method][field];
                if (!spec) return null;
                return (
                  <FormField key={field} label={spec.label} optional={spec.optional} required={!spec.optional} hint={spec.hint} error={fieldError(field)}>
                    <Input
                      value={draft[field]}
                      placeholder={spec.placeholder}
                      inputMode={spec.inputMode}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => update({ [field]: e.target.value })}
                      onBlur={() => setTouched((t) => ({ ...t, [field]: true }))}
                    />
                  </FormField>
                );
              })}

              {Object.keys(PAYMENT_TYPE_FIELDS[draft.method]).length === 0 && (
                <p className="rounded-lg bg-a-surface-2 px-3 py-2 text-xs leading-5 text-a-text-2">
                  {PAYMENT_TYPE_DESCRIPTIONS[draft.method]} Rien d’autre à renseigner.
                </p>
              )}
            </fieldset>

            <fieldset>
              <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-a-text-3">Où le proposer</legend>
              <div className="grid gap-2">
                {PAYMENT_MODULES.map((module) => {
                  const availability = paymentMethodAvailability(draftAsMethod ?? { method: draft.method, value: null, extra: null }, module.value);
                  const checked = availability.ok && draft.enabled_modules.includes(module.value);
                  const id = `pm-module-${module.value}`;
                  return (
                    <label
                      key={module.value}
                      htmlFor={id}
                      className={cn(
                        'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 rounded-xl border px-3 py-2.5 transition',
                        !availability.ok && 'cursor-not-allowed border-dashed border-a-border-strong bg-a-surface-2',
                        availability.ok && (checked ? 'cursor-pointer border-transparent bg-a-brand-soft' : 'cursor-pointer border-a-border bg-a-surface hover:bg-a-surface-2'),
                      )}
                    >
                      <input
                        id={id}
                        type="checkbox"
                        checked={checked}
                        disabled={!availability.ok}
                        aria-describedby={`${id}-detail`}
                        onChange={() => {
                          update({
                            enabled_modules: checked
                              ? draft.enabled_modules.filter((m) => m !== module.value)
                              : [...draft.enabled_modules, module.value],
                          });
                          setTouched((t) => ({ ...t, enabled_modules: true }));
                        }}
                        className="mt-0.5 h-4 w-4 accent-[var(--admin-primary)]"
                      />
                      <span className={cn('text-sm font-semibold', checked ? 'text-a-brand-fg' : availability.ok ? 'text-a-text' : 'text-a-text-3')}>
                        {module.label}{!availability.ok && <span className="font-normal"> · sans effet</span>}
                      </span>
                      <span id={`${id}-detail`} className="col-start-2 text-xs leading-4 text-a-text-3">{availability.detail}</span>
                    </label>
                  );
                })}
              </div>
              {draft.active && effectiveCount === 0 && (
                <InlineAlert tone="warning" className="mt-3">
                  Avec ces réglages, ce moyen ne sera visible par aucun client.
                </InlineAlert>
              )}
              <ErrorText message={fieldError('enabled_modules')} className="mt-2" />
            </fieldset>

            <ErrorText message={saveError} />
            {/* Enter in a field submits. */}
            <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">Enregistrer</button>
          </form>
        )}
      </Drawer>
      {confirmDialog}
      {guardDialog}
    </>
  );
}
