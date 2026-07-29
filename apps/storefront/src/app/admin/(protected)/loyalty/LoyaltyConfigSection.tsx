'use client';

import { useState } from 'react';
import type { ReferralAvailabilityMode, ReferralFraudAction, TenantReferralTier } from '@lepefy/types';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

interface LoyaltyConfigSectionProps {
  loyalty_enabled: boolean;
  referral_max_depth: number;
  purchase_points_rate: number;
  referral_availability_mode: ReferralAvailabilityMode;
  referral_unlock_spending_threshold: number | null;
  referral_fraud_max_conversions: number;
  referral_fraud_period_days: number;
  referral_fraud_action: ReferralFraudAction;
  initialTiers: TenantReferralTier[];
}

export function LoyaltyConfigSection({
  loyalty_enabled,
  referral_max_depth,
  purchase_points_rate,
  referral_availability_mode,
  referral_unlock_spending_threshold,
  referral_fraud_max_conversions,
  referral_fraud_period_days,
  referral_fraud_action,
  initialTiers,
}: LoyaltyConfigSectionProps) {
  const [form, setForm] = useState({
    loyalty_enabled,
    referral_max_depth,
    purchase_points_rate,
    referral_availability_mode,
    referral_unlock_spending_threshold: referral_unlock_spending_threshold ?? 0,
    referral_fraud_max_conversions,
    referral_fraud_period_days,
    referral_fraud_action,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [tiers, setTiers] = useState(initialTiers);
  const [tierDraft, setTierDraft] = useState<{ level: number; pct: string }>({ level: 1, pct: '' });
  const [isSavingTier, setIsSavingTier] = useState(false);

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
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      showToast('Enregistré', 'success');
    } catch {
      showToast('Erreur lors de l\'enregistrement', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddTier() {
    const pctNum = parseFloat(tierDraft.pct);
    if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 1) {
      showToast('Pourcentage invalide (entre 0 et 1, ex: 0.10 pour 10%)', 'error');
      return;
    }
    setIsSavingTier(true);
    try {
      const res = await fetch('/api/admin/loyalty/tiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: tierDraft.level, pct: pctNum }),
      });
      if (!res.ok) throw new Error();
      const newTier: TenantReferralTier = await res.json();
      setTiers((prev) => [
        newTier,
        ...prev.map((t) => (t.level === newTier.level ? { ...t, is_active: false } : t)),
      ]);
      showToast('Palier enregistré', 'success');
    } catch {
      showToast('Erreur lors de l\'enregistrement du palier', 'error');
    } finally {
      setIsSavingTier(false);
    }
  }

  const activeTiersByLevel = new Map(tiers.filter((t) => t.is_active).map((t) => [t.level, t]));
  const historyTiers = tiers.filter((t) => !t.is_active).sort((a, b) => a.level - b.level);

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Fidélité & parrainage</h2>
      <p className="text-xs text-gray-400 mb-4">
        Configuration générale — aucune valeur n&apos;est appliquée tant que &quot;Activé&quot; n&apos;est pas coché.
      </p>

      {toast && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {toast.msg}
        </div>
      )}

      <div className="space-y-4 mb-4">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={form.loyalty_enabled}
            onChange={(e) => setForm({ ...form, loyalty_enabled: e.target.checked })}
          />
          Programme de fidélité activé
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Profondeur de la chaîne (1-5)</label>
            <input
              type="number" min={1} max={5}
              value={form.referral_max_depth}
              onChange={(e) => setForm({ ...form, referral_max_depth: Number(e.target.value) })}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Taux points / € dépensé</label>
            <input
              type="number" step="0.01"
              value={form.purchase_points_rate}
              onChange={(e) => setForm({ ...form, purchase_points_rate: Number(e.target.value) })}
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div>
          <label className={LABEL_CLS}>Mode d&apos;éligibilité au parrainage</label>
          <select
            value={form.referral_availability_mode}
            onChange={(e) => setForm({ ...form, referral_availability_mode: e.target.value as ReferralAvailabilityMode })}
            className={INPUT_CLS}
          >
            <option value="ALL_CUSTOMERS">Tous les clients</option>
            <option value="SPENDING_THRESHOLD">Seuil de dépense</option>
            <option value="ADMIN_GRANTED_ONLY">Accordé manuellement uniquement</option>
          </select>
        </div>

        {form.referral_availability_mode === 'SPENDING_THRESHOLD' && (
          <div>
            <label className={LABEL_CLS}>Seuil de déblocage (€)</label>
            <input
              type="number" step="0.01"
              value={form.referral_unlock_spending_threshold}
              onChange={(e) => setForm({ ...form, referral_unlock_spending_threshold: Number(e.target.value) })}
              className={INPUT_CLS}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Max conversions confirmées</label>
            <input
              type="number" step="1"
              value={form.referral_fraud_max_conversions}
              onChange={(e) => setForm({ ...form, referral_fraud_max_conversions: Number(e.target.value) })}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Fenêtre (jours)</label>
            <input
              type="number" step="1"
              value={form.referral_fraud_period_days}
              onChange={(e) => setForm({ ...form, referral_fraud_period_days: Number(e.target.value) })}
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div>
          <label className={LABEL_CLS}>Action anti-fraude au-delà du seuil</label>
          <select
            value={form.referral_fraud_action}
            onChange={(e) => setForm({ ...form, referral_fraud_action: e.target.value as ReferralFraudAction })}
            className={INPUT_CLS}
          >
            <option value="FLAG_FOR_REVIEW">Signaler pour revue manuelle</option>
            <option value="CAP_AT_THRESHOLD">Plafonner (ignorer au-delà)</option>
            <option value="AUTO_BLOCK">Bloquer automatiquement le parrain</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="px-3 py-1.5 text-xs rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50"
      >
        Enregistrer
      </button>

      <hr className="my-5 border-gray-100 dark:border-gray-800" />

      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Pourcentages par niveau</h3>
      <p className="text-xs text-gray-400 mb-3">
        Chaque ajout crée une nouvelle version et désactive la précédente — l&apos;historique complet reste visible.
      </p>

      <div className="flex items-end gap-2 mb-4">
        <div>
          <label className={LABEL_CLS}>Niveau</label>
          <input
            type="number" min={1}
            value={tierDraft.level}
            onChange={(e) => setTierDraft({ ...tierDraft, level: Number(e.target.value) })}
            className={`${INPUT_CLS} w-20`}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Pourcentage (0-1)</label>
          <input
            type="number" step="0.01" min={0} max={1}
            value={tierDraft.pct}
            onChange={(e) => setTierDraft({ ...tierDraft, pct: e.target.value })}
            placeholder="0.10"
            className={`${INPUT_CLS} w-28`}
          />
        </div>
        <button
          onClick={handleAddTier}
          disabled={isSavingTier}
          className="px-3 py-2 text-xs rounded-lg border border-gray-200 text-gray-700 disabled:opacity-50"
        >
          Ajouter une version
        </button>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-400 uppercase tracking-wide">
            <th className="py-1.5 font-medium">Niveau</th>
            <th className="py-1.5 font-medium">%</th>
            <th className="py-1.5 font-medium">Statut</th>
            <th className="py-1.5 font-medium">Depuis</th>
          </tr>
        </thead>
        <tbody>
          {[...activeTiersByLevel.values()].sort((a, b) => a.level - b.level).map((t) => (
            <tr key={t.id} className="border-t border-gray-100 dark:border-gray-800">
              <td className="py-1.5">{t.level}</td>
              <td className="py-1.5">{(t.pct * 100).toFixed(1)}%</td>
              <td className="py-1.5 text-green-600">Actif</td>
              <td className="py-1.5 text-gray-400">{new Date(t.effective_from).toLocaleDateString('fr-FR')}</td>
            </tr>
          ))}
          {historyTiers.map((t) => (
            <tr key={t.id} className="border-t border-gray-100 dark:border-gray-800 text-gray-400">
              <td className="py-1.5">{t.level}</td>
              <td className="py-1.5">{(t.pct * 100).toFixed(1)}%</td>
              <td className="py-1.5">Historique</td>
              <td className="py-1.5">{new Date(t.effective_from).toLocaleDateString('fr-FR')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
