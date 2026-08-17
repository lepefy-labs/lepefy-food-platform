'use client';

import { useState, useMemo } from 'react';
import { calculateAmbassadorDiscount } from '@/lib/ambassador/calculateAmbassadorDiscount';
import { calculateSplitPoolAmounts } from '@/lib/ambassador/calculateSplitPool';
import { formatPrice } from '@/lib/utils/format';
import Button from '../../_components/ui/Button';
import type { AmbassadorCommissionMode, AmbassadorDiscountType } from '@lepefy/types';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

interface AmbassadorConfigSectionProps {
  ambassador_min_purchase_amount: number;
  ambassador_min_commission_amount: number;
  ambassador_max_commission_amount: number;
  ambassador_loyalty_from_second_order: boolean;
  ambassador_first_order_discount_type: AmbassadorDiscountType | null;
  ambassador_first_order_discount_value: number | null;
  ambassador_payout_threshold_amount: number;
  ambassador_commission_mode: AmbassadorCommissionMode;
  ambassador_split_pool_amount: number | null;
  ambassador_split_pool_ambassador_percent: number | null;
  currency: string;
}

// Exemple d'ordre fictif utilisé pour illustrer, en direct, l'impact du
// paramétrage sur la commission — pas modifiable par l'admin, juste assez
// au-dessus du seuil par défaut pour être parlant.
const EXAMPLE_ORDER_SUBTOTAL = 40;

export function AmbassadorConfigSection({
  ambassador_min_purchase_amount,
  ambassador_min_commission_amount,
  ambassador_max_commission_amount,
  ambassador_loyalty_from_second_order,
  ambassador_first_order_discount_type,
  ambassador_first_order_discount_value,
  ambassador_payout_threshold_amount,
  ambassador_commission_mode,
  ambassador_split_pool_amount,
  ambassador_split_pool_ambassador_percent,
  currency,
}: AmbassadorConfigSectionProps) {
  const [form, setForm] = useState({
    ambassador_min_purchase_amount,
    ambassador_min_commission_amount,
    ambassador_max_commission_amount,
    ambassador_loyalty_from_second_order,
    ambassador_first_order_discount_type: ambassador_first_order_discount_type ?? '',
    ambassador_first_order_discount_value: ambassador_first_order_discount_value ?? 0,
    ambassador_payout_threshold_amount,
    ambassador_commission_mode,
    ambassador_split_pool_amount: ambassador_split_pool_amount ?? 0,
    ambassador_split_pool_ambassador_percent: ambassador_split_pool_ambassador_percent ?? 50,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          ambassador_first_order_discount_type: form.ambassador_first_order_discount_type || null,
        }),
      });
      if (!res.ok) throw new Error();
      showToast('Enregistré', 'success');
    } catch {
      showToast('Erreur lors de l\'enregistrement', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  const isSplitPool = form.ambassador_commission_mode === 'SPLIT_POOL';

  // Taux dérivé, calculé en direct côté client — jamais stocké tel quel
  // (voir migration 046) : la valeur historicisée par commande est
  // ambassador_commissions.rate_applied.
  const derivedRate = form.ambassador_min_purchase_amount > 0
    ? form.ambassador_min_commission_amount / form.ambassador_min_purchase_amount
    : 0;

  const exampleDiscount = useMemo(() => calculateAmbassadorDiscount(EXAMPLE_ORDER_SUBTOTAL, {
    minPurchaseAmount: form.ambassador_min_purchase_amount,
    discountType: (form.ambassador_first_order_discount_type || null) as AmbassadorDiscountType | null,
    discountValue: form.ambassador_first_order_discount_value,
  }), [form.ambassador_min_purchase_amount, form.ambassador_first_order_discount_type, form.ambassador_first_order_discount_value]);

  const exampleAmountPaid = EXAMPLE_ORDER_SUBTOTAL - exampleDiscount;
  const exampleCommission = Math.min(exampleAmountPaid * derivedRate, form.ambassador_max_commission_amount);

  const splitPoolAmounts = useMemo(() => calculateSplitPoolAmounts({
    poolAmount: form.ambassador_split_pool_amount,
    ambassadorPercent: form.ambassador_split_pool_ambassador_percent,
  }), [form.ambassador_split_pool_amount, form.ambassador_split_pool_ambassador_percent]);

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Programme Ambassadeur</h2>
      <p className="text-xs text-gray-400 mb-4">
        Commission en argent réel, payée manuellement hors plateforme — pas de points. Sconto optionnel au premier
        ordre du client invité.
      </p>

      {toast && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.msg}
        </div>
      )}

      <div className="space-y-4 mb-4">
        <div>
          <label className={LABEL_CLS}>Achat minimum ({currency})</label>
          <input
            type="number" step="0.01" min={0}
            value={form.ambassador_min_purchase_amount}
            onChange={(e) => setForm({ ...form, ambassador_min_purchase_amount: Number(e.target.value) })}
            className={INPUT_CLS}
          />
          <p className="text-xs text-gray-400 mt-1">
            Seuil de subtotal partagé entre les deux modes ci-dessous : débloque la réduction/le pool et la commission.
          </p>
        </div>

        <div>
          <label className={LABEL_CLS}>Mode de commission</label>
          <select
            value={form.ambassador_commission_mode}
            onChange={(e) => setForm({ ...form, ambassador_commission_mode: e.target.value as AmbassadorCommissionMode })}
            className={INPUT_CLS}
          >
            <option value="PROPORTIONAL">Proportionnelle</option>
            <option value="SPLIT_POOL">Pool partagé</option>
          </select>
        </div>

        {isSplitPool ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Pool ({currency})</label>
                <input
                  type="number" step="0.01" min={0}
                  value={form.ambassador_split_pool_amount}
                  onChange={(e) => setForm({ ...form, ambassador_split_pool_amount: Number(e.target.value) })}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Part ambassadeur (%)</label>
                <input
                  type="number" step="1" min={0} max={100}
                  value={form.ambassador_split_pool_ambassador_percent}
                  onChange={(e) => setForm({ ...form, ambassador_split_pool_ambassador_percent: Number(e.target.value) })}
                  className={INPUT_CLS}
                />
              </div>
            </div>

            <div className="text-xs text-gray-500 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-3 space-y-2">
              <p>
                Le pool est un montant fixe divisé entre l&apos;ambassadeur et le client invité — pas de pourcentage
                du montant payé, pas de plafond séparé (le pool est déjà le plafond).
              </p>
              <p className="font-medium text-gray-700 dark:text-gray-300">
                Avec ces valeurs, pour une première commande ≥ {formatPrice(form.ambassador_min_purchase_amount, currency)} :
              </p>
              <ul className="space-y-0.5">
                <li>L&apos;ambassadeur gagne : <strong>{formatPrice(splitPoolAmounts.ambassadorAmount, currency)}</strong></li>
                <li>Le client invité reçoit : <strong>{formatPrice(splitPoolAmounts.referredDiscount, currency)}</strong> de réduction sur son premier ordre</li>
              </ul>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Commission minimum ({currency})</label>
                <input
                  type="number" step="0.01" min={0}
                  value={form.ambassador_min_commission_amount}
                  onChange={(e) => setForm({ ...form, ambassador_min_commission_amount: Number(e.target.value) })}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>Commission maximum ({currency})</label>
                <input
                  type="number" step="0.01" min={0}
                  value={form.ambassador_max_commission_amount}
                  onChange={(e) => setForm({ ...form, ambassador_max_commission_amount: Number(e.target.value) })}
                  className={INPUT_CLS}
                />
              </div>
            </div>

            <p className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
              Taux dérivé : <strong>{(derivedRate * 100).toFixed(2)}%</strong> du montant payé par le client invité
              (jamais stocké tel quel — recalculé et historicisé à chaque commission).
            </p>

            <div>
              <label className={LABEL_CLS}>Réduction premier ordre</label>
              <select
                value={form.ambassador_first_order_discount_type}
                onChange={(e) => setForm({ ...form, ambassador_first_order_discount_type: e.target.value })}
                className={INPUT_CLS}
              >
                <option value="">Désactivée</option>
                <option value="PERCENT">Pourcentage</option>
                <option value="FIXED">Montant fixe</option>
              </select>
            </div>

            {form.ambassador_first_order_discount_type && (
              <div>
                <label className={LABEL_CLS}>
                  Valeur ({form.ambassador_first_order_discount_type === 'PERCENT' ? '%' : currency})
                </label>
                <input
                  type="number" step="0.01" min={0}
                  value={form.ambassador_first_order_discount_value}
                  onChange={(e) => setForm({ ...form, ambassador_first_order_discount_value: Number(e.target.value) })}
                  className={INPUT_CLS}
                />
              </div>
            )}

            <div className="text-xs text-gray-500 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-3 space-y-2">
              <p>
                La commission de l&apos;ambassadeur se calcule sur le montant que le client paie <strong>après</strong> la
                réduction — un sconto élevé réduit aussi la commission générée sur cette commande.
              </p>
              <p className="font-medium text-gray-700 dark:text-gray-300">
                Exemple pour une commande de {formatPrice(EXAMPLE_ORDER_SUBTOTAL, currency)} :
              </p>
              <ul className="space-y-0.5">
                <li>Réduction client : {formatPrice(exampleDiscount, currency)}</li>
                <li>Montant payé : {formatPrice(exampleAmountPaid, currency)}</li>
                <li>Commission ambassadeur : <strong>{formatPrice(exampleCommission, currency)}</strong></li>
              </ul>
            </div>
          </>
        )}

        <hr className="border-gray-100 dark:border-gray-800" />

        <div>
          <label className={LABEL_CLS}>Seuil de paiement ({currency})</label>
          <input
            type="number" step="0.01" min={0}
            value={form.ambassador_payout_threshold_amount}
            onChange={(e) => setForm({ ...form, ambassador_payout_threshold_amount: Number(e.target.value) })}
            className={INPUT_CLS}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={form.ambassador_loyalty_from_second_order}
            onChange={(e) => setForm({ ...form, ambassador_loyalty_from_second_order: e.target.checked })}
          />
          Le client invité rejoint le programme de fidélité normal à partir de sa 2ᵉ commande
        </label>
      </div>

      <Button onClick={handleSave} loading={isSaving}>
        Enregistrer
      </Button>
    </section>
  );
}
