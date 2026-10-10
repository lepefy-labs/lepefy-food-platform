'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { calculateAmbassadorDiscount } from '@/lib/ambassador/calculateAmbassadorDiscount';
import { calculateSplitPoolAmounts } from '@/lib/ambassador/calculateSplitPool';
import {
  ambassadorSettingsIssues,
  derivedCommissionRate,
  normalizeAmbassadorSettings,
  proportionalCommission,
  settingsEqual,
  type AmbassadorSettings,
} from '@/lib/ambassador/ambassadorAdmin';
import { formatPrice } from '@/lib/utils/format';
import Button from '../../_components/ui/Button';
import ConfirmDialog from '../../_components/ui/ConfirmDialog';
import type { AmbassadorCommissionMode, AmbassadorDiscountType } from '@lepefy/types';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900 disabled:bg-gray-50 disabled:text-gray-500';
const LABEL_CLS = 'text-gray-500 text-xs font-medium mb-1 block';
const HINT_CLS = 'text-xs text-gray-400 mt-1';

function NumberField({ id, label, hint, value, onChange, disabled, step = '0.01', max }: {
  id: string;
  label: string;
  hint?: string;
  value: number | null;
  onChange: (value: number) => void;
  disabled: boolean;
  step?: string;
  max?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLS}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        max={max}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className={INPUT_CLS}
      />
      {hint && <p className={HINT_CLS}>{hint}</p>}
    </div>
  );
}

export function AmbassadorConfigSection({ initialSettings, currency, canEdit }: {
  initialSettings: AmbassadorSettings;
  currency: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [baseline, setBaseline] = useState(initialSettings);
  const [form, setForm] = useState(initialSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmModeChange, setConfirmModeChange] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const dirty = !settingsEqual(normalizeAmbassadorSettings(baseline), normalizeAmbassadorSettings(form));
  const issues = ambassadorSettingsIssues(form);
  const isSplitPool = form.ambassador_commission_mode === 'SPLIT_POOL';
  const modeChanged = form.ambassador_commission_mode !== baseline.ambassador_commission_mode;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  function set<K extends keyof AmbassadorSettings>(key: K, value: AmbassadorSettings[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setMessage(null);
  }

  const rate = derivedCommissionRate(form.ambassador_min_purchase_amount, form.ambassador_min_commission_amount);
  const exampleSubtotal = Math.max(form.ambassador_min_purchase_amount, 0);
  const exampleDiscount = useMemo(() => calculateAmbassadorDiscount(exampleSubtotal, {
    minPurchaseAmount: form.ambassador_min_purchase_amount,
    discountType: form.ambassador_first_order_discount_type,
    discountValue: form.ambassador_first_order_discount_value,
  }), [exampleSubtotal, form.ambassador_min_purchase_amount, form.ambassador_first_order_discount_type, form.ambassador_first_order_discount_value]);
  const examplePaid = Math.max(exampleSubtotal - exampleDiscount, 0);
  const exampleCommission = proportionalCommission(examplePaid, rate, form.ambassador_max_commission_amount);
  const commissionReachesCapAt = rate > 0 ? form.ambassador_max_commission_amount / rate : null;

  const pool = calculateSplitPoolAmounts({
    poolAmount: form.ambassador_split_pool_amount,
    ambassadorPercent: form.ambassador_split_pool_ambassador_percent,
  });

  async function save() {
    setConfirmModeChange(false);
    setIsSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/ambassador/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizeAmbassadorSettings(form)),
      });
      const body = await res.json().catch(() => null) as ({ error?: string } & Partial<AmbassadorSettings>) | null;
      if (!res.ok) {
        setMessage({ text: body?.error ?? 'Enregistrement impossible.', tone: 'error' });
        return;
      }
      const saved = normalizeAmbassadorSettings(form);
      setBaseline(saved);
      setForm(saved);
      setMessage({ text: 'Programme ambassadeur enregistré. Les nouvelles règles s’appliquent aux prochaines commandes livrées.', tone: 'ok' });
      router.refresh();
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setIsSaving(false);
    }
  }

  const disabled = !canEdit || isSaving;

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <div>
        <h2 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">Règles du programme</h2>
        <p className="text-xs text-gray-400">
          Un ambassadeur gagne une commission en argent (pas de points) sur la <strong>première commande livrée</strong> de
          chaque client qu&apos;il a invité, si cette commande atteint l&apos;achat minimum. Le client invité peut recevoir une
          réduction sur cette première commande.
        </p>
        {!canEdit && (
          <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-800">
            Lecture seule : la modification des règles demande la permission « Paramètres de la boutique ».
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          id="amb-min-purchase"
          label={`Achat minimum (${currency})`}
          hint="Sous-total de la première commande (avant réduction) qui débloque la réduction et la commission."
          value={form.ambassador_min_purchase_amount}
          onChange={(v) => set('ambassador_min_purchase_amount', v)}
          disabled={disabled}
        />
        <div>
          <label htmlFor="amb-mode" className={LABEL_CLS}>Calcul de la commission</label>
          <select
            id="amb-mode"
            value={form.ambassador_commission_mode}
            disabled={disabled}
            onChange={(e) => set('ambassador_commission_mode', e.target.value as AmbassadorCommissionMode)}
            className={INPUT_CLS}
          >
            <option value="PROPORTIONAL">Proportionnelle au montant payé</option>
            <option value="SPLIT_POOL">Montant fixe partagé (pool)</option>
          </select>
          <p className={HINT_CLS}>Un seul mode actif à la fois. Les commissions déjà créées gardent leurs valeurs.</p>
        </div>
      </div>

      {isSplitPool ? (
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="amb-pool"
              label={`Pool (${currency})`}
              hint="Montant fixe partagé entre l’ambassadeur et le client invité."
              value={form.ambassador_split_pool_amount}
              onChange={(v) => set('ambassador_split_pool_amount', v)}
              disabled={disabled}
            />
            <NumberField
              id="amb-pool-percent"
              label="Part de l’ambassadeur (%)"
              hint="Le reste devient la réduction du client invité."
              value={form.ambassador_split_pool_ambassador_percent}
              onChange={(v) => set('ambassador_split_pool_ambassador_percent', v)}
              disabled={disabled}
              step="1"
              max={100}
            />
          </div>
          <div className="rounded-lg bg-amber-50 px-3 py-3 text-xs text-gray-600 dark:bg-amber-950/30 dark:text-gray-300">
            <p className="font-medium text-gray-700 dark:text-gray-200">
              Pour une première commande d&apos;au moins {formatPrice(form.ambassador_min_purchase_amount, currency)} :
            </p>
            <ul className="mt-1 space-y-0.5">
              <li>Commission de l&apos;ambassadeur : <strong>{formatPrice(pool.ambassadorAmount, currency)}</strong></li>
              <li>Réduction du client invité : <strong>{formatPrice(pool.referredDiscount, currency)}</strong></li>
            </ul>
            <p className="mt-1 text-gray-500">Montants fixes, quel que soit le total de la commande au-delà du minimum.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="amb-commission-threshold"
              label={`Commission au seuil (${currency})`}
              hint={`Commission pour une commande de ${formatPrice(form.ambassador_min_purchase_amount, currency)} : fixe le taux (${(rate * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %). Ce n’est pas un minimum garanti.`}
              value={form.ambassador_min_commission_amount}
              onChange={(v) => set('ambassador_min_commission_amount', v)}
              disabled={disabled}
            />
            <NumberField
              id="amb-commission-max"
              label={`Plafond par commission (${currency})`}
              hint={commissionReachesCapAt ? `Atteint à partir de ${formatPrice(commissionReachesCapAt, currency)} payés.` : undefined}
              value={form.ambassador_max_commission_amount}
              onChange={(v) => set('ambassador_max_commission_amount', v)}
              disabled={disabled}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="amb-discount-type" className={LABEL_CLS}>Réduction sur la première commande</label>
              <select
                id="amb-discount-type"
                value={form.ambassador_first_order_discount_type ?? ''}
                disabled={disabled}
                onChange={(e) => set('ambassador_first_order_discount_type', (e.target.value || null) as AmbassadorDiscountType | null)}
                className={INPUT_CLS}
              >
                <option value="">Aucune réduction</option>
                <option value="PERCENT">Pourcentage</option>
                <option value="FIXED">Montant fixe</option>
              </select>
            </div>
            {form.ambassador_first_order_discount_type && (
              <NumberField
                id="amb-discount-value"
                label={`Valeur (${form.ambassador_first_order_discount_type === 'PERCENT' ? '%' : currency})`}
                value={form.ambassador_first_order_discount_value}
                onChange={(v) => set('ambassador_first_order_discount_value', v)}
                disabled={disabled}
              />
            )}
          </div>
          <div className="rounded-lg bg-amber-50 px-3 py-3 text-xs text-gray-600 dark:bg-amber-950/30 dark:text-gray-300">
            <p className="font-medium text-gray-700 dark:text-gray-200">
              Exemple, commande de {formatPrice(exampleSubtotal, currency)} :
            </p>
            <ul className="mt-1 space-y-0.5">
              <li>Réduction du client invité : {formatPrice(exampleDiscount, currency)}</li>
              <li>Montant payé : {formatPrice(examplePaid, currency)}</li>
              <li>Commission de l&apos;ambassadeur : <strong>{formatPrice(exampleCommission, currency)}</strong></li>
            </ul>
            <p className="mt-1 text-gray-500">La commission se calcule sur le montant payé après réduction : une réduction élevée la diminue aussi.</p>
          </div>
        </div>
      )}

      <hr className="border-gray-100 dark:border-gray-800" />

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          id="amb-payout-threshold"
          label={`Seuil de versement conseillé (${currency})`}
          hint="Indicatif : un ambassadeur est signalé « prêt à verser » à partir de ce solde. Vous pouvez verser avant."
          value={form.ambassador_payout_threshold_amount}
          onChange={(v) => set('ambassador_payout_threshold_amount', v)}
          disabled={disabled}
        />
        <label className="flex items-start gap-2 self-center text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.ambassador_loyalty_from_second_order}
            disabled={disabled}
            onChange={(e) => set('ambassador_loyalty_from_second_order', e.target.checked)}
          />
          <span>
            Le client invité gagne des points de fidélité à partir de sa 2ᵉ commande
            <span className="block text-xs text-gray-400">Sinon, aucun point sur ses commandes suivantes. Sa 1ʳᵉ commande ne rapporte des points que si aucune réduction parrainage n&apos;a été appliquée ; l&apos;ambassadeur lui-même ne gagne jamais de points.</span>
          </span>
        </label>
      </div>

      {issues.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {issues.map((issue) => <li key={issue}>{issue}</li>)}
        </ul>
      )}

      {message && !dirty && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-xs ${message.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{message.text}</p>
      )}

      {canEdit && dirty && (
        <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-xs text-gray-600 dark:text-gray-300">
            <strong>Modifications non enregistrées</strong>
            {modeChanged && <span className="block">Le mode de calcul change pour les prochaines commandes livrées.</span>}
            {message && <span role="alert" className={`block ${message.tone === 'error' ? 'text-red-700' : 'text-green-700'}`}>{message.text}</span>}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" disabled={isSaving} onClick={() => { setForm(baseline); setMessage(null); }}>Annuler</Button>
            <Button
              size="sm"
              loading={isSaving}
              disabled={issues.length > 0}
              onClick={() => (modeChanged ? setConfirmModeChange(true) : void save())}
            >
              Enregistrer
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmModeChange}
        title="Changer le mode de commission ?"
        description={`Les prochaines premières commandes livrées seront calculées en mode « ${isSplitPool ? 'pool partagé' : 'proportionnel'} ». Les commissions déjà créées ne changent pas.`}
        confirmLabel="Enregistrer"
        loading={isSaving}
        onCancel={() => setConfirmModeChange(false)}
        onConfirm={() => void save()}
      />
    </section>
  );
}
