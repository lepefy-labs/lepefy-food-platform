'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconAlertTriangle } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import ConfirmDialog from '../../_components/ui/ConfirmDialog';
import type { ReferralAvailabilityMode, ReferralFraudAction, TenantReferralTier } from '@lepefy/types';
import {
  MAX_REFERRAL_DEPTH,
  changedLoyaltySections,
  formatTierPercent,
  loyaltyFormIssues,
  percentInputToDecimal,
  pointsForAmount,
  referralTierIssues,
  type LoyaltyForm,
} from '@/lib/loyalty/loyaltyAdmin';

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900 disabled:bg-gray-50 disabled:text-gray-500';
const LABEL_CLS = 'text-gray-500 text-xs font-medium mb-1 block';
const EXAMPLE_AMOUNT = 50;

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
  /** tenant_settings.manage: the two settings APIs re-check it. */
  canEditSettings: boolean;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function LoyaltyConfigSection(props: LoyaltyConfigSectionProps) {
  const initial: LoyaltyForm = {
    loyalty_enabled: props.loyalty_enabled,
    purchase_points_rate: props.purchase_points_rate,
    referral_max_depth: props.referral_max_depth,
    referral_availability_mode: props.referral_availability_mode,
    referral_unlock_spending_threshold: props.referral_unlock_spending_threshold ?? 0,
    referral_fraud_max_conversions: props.referral_fraud_max_conversions,
    referral_fraud_period_days: props.referral_fraud_period_days,
    referral_fraud_action: props.referral_fraud_action,
  };
  const [baseline, setBaseline] = useState<LoyaltyForm>(initial);
  const [form, setForm] = useState<LoyaltyForm>(initial);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [tiers, setTiers] = useState(props.initialTiers);
  const [tierLevel, setTierLevel] = useState(1);
  const [tierPct, setTierPct] = useState('');
  const [tierMessage, setTierMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [isSavingTier, setIsSavingTier] = useState(false);

  const changes = useMemo(() => changedLoyaltySections(baseline, form), [baseline, form]);
  const dirty = changes.loyalty || changes.referral;
  const formIssues = loyaltyFormIssues(form);
  const tierIssues = referralTierIssues(form.referral_max_depth, tiers);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  function set<K extends keyof LoyaltyForm>(key: K, value: LoyaltyForm[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setMessage(null);
  }

  function requestSave() {
    if (formIssues.length > 0) {
      setMessage({ text: formIssues[0] ?? 'Valeurs invalides.', tone: 'error' });
      return;
    }
    if (baseline.loyalty_enabled && !form.loyalty_enabled) {
      setConfirmDisable(true);
      return;
    }
    void save();
  }

  // Each section has its own API: save only what changed and say exactly what
  // was saved, so a partial failure is never presented as a success.
  async function save() {
    setConfirmDisable(false);
    setIsSaving(true);
    setMessage(null);
    const done: string[] = [];
    let failure: string | null = null;
    let next = baseline;
    try {
      if (changes.loyalty) {
        const res = await fetch('/api/admin/loyalty/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: form.loyalty_enabled, config: { purchase_points_rate: form.purchase_points_rate } }),
        });
        if (res.ok) {
          next = { ...next, loyalty_enabled: form.loyalty_enabled, purchase_points_rate: form.purchase_points_rate };
          done.push('programme');
        } else {
          failure = `Programme : ${await errorMessage(res, 'enregistrement impossible.')}`;
        }
      }
      if (!failure && changes.referral) {
        const res = await fetch('/api/admin/loyalty/referral', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            config: {
              max_depth: form.referral_max_depth,
              availability_mode: form.referral_availability_mode,
              unlock_spending_threshold: form.referral_unlock_spending_threshold,
              fraud_max_conversions: form.referral_fraud_max_conversions,
              fraud_period_days: form.referral_fraud_period_days,
              fraud_action: form.referral_fraud_action,
            },
          }),
        });
        if (res.ok) {
          next = {
            ...next,
            referral_max_depth: form.referral_max_depth,
            referral_availability_mode: form.referral_availability_mode,
            referral_unlock_spending_threshold: form.referral_unlock_spending_threshold,
            referral_fraud_max_conversions: form.referral_fraud_max_conversions,
            referral_fraud_period_days: form.referral_fraud_period_days,
            referral_fraud_action: form.referral_fraud_action,
          };
          done.push('parrainage');
        } else {
          failure = `Parrainage : ${await errorMessage(res, 'enregistrement impossible.')}`;
        }
      }
    } catch {
      failure = 'Erreur réseau — réessayez.';
    } finally {
      setBaseline(next);
      setIsSaving(false);
    }
    if (failure) {
      setMessage({ text: done.length > 0 ? `${done.join(' et ')} enregistré ; ${failure}` : failure, tone: 'error' });
    } else {
      setMessage({ text: `Enregistré (${done.join(' et ')}).`, tone: 'ok' });
    }
  }

  async function handleAddTier() {
    const pct = percentInputToDecimal(tierPct);
    if (pct === null) {
      setTierMessage({ text: 'Indiquez un pourcentage entre 0 et 100 (ex. 10 pour 10 %).', tone: 'error' });
      return;
    }
    setIsSavingTier(true);
    setTierMessage(null);
    try {
      const res = await fetch('/api/admin/loyalty/tiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: tierLevel, pct }),
      });
      if (!res.ok) {
        setTierMessage({ text: await errorMessage(res, 'Enregistrement du pourcentage impossible.'), tone: 'error' });
        return;
      }
      const newTier: TenantReferralTier = await res.json();
      setTiers((previous) => [newTier, ...previous.map((tier) => (tier.level === newTier.level ? { ...tier, is_active: false } : tier))]);
      setTierPct('');
      setTierMessage({ text: `Niveau ${newTier.level} : ${formatTierPercent(newTier.pct)} appliqué aux prochaines commissions.`, tone: 'ok' });
    } catch {
      setTierMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setIsSavingTier(false);
    }
  }

  const activeTiers = tiers.filter((tier) => tier.is_active).sort((a, b) => a.level - b.level);
  const historyTiers = tiers.filter((tier) => !tier.is_active).sort((a, b) => a.level - b.level || b.effective_from.localeCompare(a.effective_from));
  const levelOptions = Array.from({ length: Math.max(1, Math.min(MAX_REFERRAL_DEPTH, form.referral_max_depth || 1)) }, (_, i) => i + 1);

  return (
    <section className="space-y-5">
      {!props.canEditSettings && (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300">
          Lecture seule : la configuration du programme nécessite la permission « Paramètres de la boutique ». Les pourcentages, accès et revues restent gérables.
        </p>
      )}

      <fieldset disabled={!props.canEditSettings} className="min-w-0 space-y-5">
        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Programme de fidélité</h2>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${baseline.loyalty_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
              {baseline.loyalty_enabled ? 'Actif' : 'Désactivé'}
            </span>
          </div>
          <label className="mb-4 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={form.loyalty_enabled} onChange={(e) => set('loyalty_enabled', e.target.checked)} />
            Programme de fidélité activé
          </label>
          <div className="max-w-xs">
            <label htmlFor="loyalty-rate" className={LABEL_CLS}>Points gagnés par € dépensé</label>
            <input id="loyalty-rate" type="number" step="0.01" min={0.01} value={form.purchase_points_rate} onChange={(e) => set('purchase_points_rate', Number(e.target.value))} className={INPUT_CLS} />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            → Un panier de {EXAMPLE_AMOUNT} € rapporte <strong className="text-gray-800 dark:text-gray-200">{pointsForAmount(EXAMPLE_AMOUNT, form.purchase_points_rate)} pts</strong> (en ligne et au scan en boutique).
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">Parrainage</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="referral-depth" className={LABEL_CLS}>Profondeur de la chaîne (1 à {MAX_REFERRAL_DEPTH} niveaux)</label>
              <input id="referral-depth" type="number" min={1} max={MAX_REFERRAL_DEPTH} value={form.referral_max_depth} onChange={(e) => set('referral_max_depth', Number(e.target.value))} className={INPUT_CLS} />
            </div>
            <div>
              <label htmlFor="referral-mode" className={LABEL_CLS}>Qui peut parrainer</label>
              <select id="referral-mode" value={form.referral_availability_mode} onChange={(e) => set('referral_availability_mode', e.target.value as ReferralAvailabilityMode)} className={INPUT_CLS}>
                <option value="ALL_CUSTOMERS">Tous les clients</option>
                <option value="SPENDING_THRESHOLD">Après un seuil de dépense</option>
                <option value="ADMIN_GRANTED_ONLY">Seulement les clients autorisés manuellement</option>
              </select>
            </div>
            {form.referral_availability_mode === 'SPENDING_THRESHOLD' && (
              <div>
                <label htmlFor="referral-threshold" className={LABEL_CLS}>Seuil de déblocage (€ dépensés)</label>
                <input id="referral-threshold" type="number" step="0.01" min={0} value={form.referral_unlock_spending_threshold} onChange={(e) => set('referral_unlock_spending_threshold', Number(e.target.value))} className={INPUT_CLS} />
              </div>
            )}
          </div>
          <div className="mt-4 rounded-lg bg-gray-50 p-3 dark:bg-gray-950">
            <p className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">Anti-fraude</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="fraud-max" className={LABEL_CLS}>Conversions confirmées max</label>
                <input id="fraud-max" type="number" step="1" min={1} value={form.referral_fraud_max_conversions} onChange={(e) => set('referral_fraud_max_conversions', Number(e.target.value))} className={INPUT_CLS} />
              </div>
              <div>
                <label htmlFor="fraud-days" className={LABEL_CLS}>Sur (jours)</label>
                <input id="fraud-days" type="number" step="1" min={1} value={form.referral_fraud_period_days} onChange={(e) => set('referral_fraud_period_days', Number(e.target.value))} className={INPUT_CLS} />
              </div>
              <div>
                <label htmlFor="fraud-action" className={LABEL_CLS}>Au-delà</label>
                <select id="fraud-action" value={form.referral_fraud_action} onChange={(e) => set('referral_fraud_action', e.target.value as ReferralFraudAction)} className={INPUT_CLS}>
                  <option value="FLAG_FOR_REVIEW">Signaler pour revue manuelle</option>
                  <option value="CAP_AT_THRESHOLD">Plafonner (ignorer au-delà)</option>
                  <option value="AUTO_BLOCK">Bloquer automatiquement le parrain</option>
                </select>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Un parrain qui dépasse {form.referral_fraud_max_conversions || '…'} conversions en {form.referral_fraud_period_days || '…'} jours est{' '}
              {form.referral_fraud_action === 'FLAG_FOR_REVIEW' ? 'mis en revue (section « En révision »)' : form.referral_fraud_action === 'CAP_AT_THRESHOLD' ? 'plafonné' : 'bloqué automatiquement'}.
            </p>
          </div>
        </div>
      </fieldset>

      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-1 text-sm font-semibold text-gray-800 dark:text-gray-100">Commission par niveau</h3>
        <p className="mb-3 text-xs text-gray-500">Pourcentage de l&apos;achat du filleul versé en points au parrain de chaque niveau. Chaque modification crée une nouvelle version ; l&apos;historique reste visible.</p>

        {tierIssues.length > 0 && (
          <div role="alert" className="mb-3 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {tierIssues.map((issue) => (
              <p key={issue.kind} className="flex items-start gap-1.5"><IconAlertTriangle size={14} stroke={1.8} className="mt-0.5 shrink-0" aria-hidden="true" />{issue.message}</p>
            ))}
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="tier-level" className={LABEL_CLS}>Niveau</label>
            <select id="tier-level" value={tierLevel} onChange={(e) => setTierLevel(Number(e.target.value))} className={`${INPUT_CLS} w-24`}>
              {levelOptions.map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tier-pct" className={LABEL_CLS}>Commission (%)</label>
            <input id="tier-pct" type="text" inputMode="decimal" value={tierPct} onChange={(e) => setTierPct(e.target.value)} placeholder="10" className={`${INPUT_CLS} w-28`} />
          </div>
          <Button variant="outline" onClick={handleAddTier} loading={isSavingTier}>Nouvelle version</Button>
        </div>
        {tierMessage && (
          <p role={tierMessage.tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-3 py-2 text-xs ${tierMessage.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{tierMessage.text}</p>
        )}

        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400">
              <th className="py-1.5 font-medium">Niveau</th>
              <th className="py-1.5 font-medium">Commission</th>
              <th className="py-1.5 font-medium">Statut</th>
              <th className="py-1.5 font-medium">Depuis</th>
            </tr>
          </thead>
          <tbody>
            {activeTiers.map((tier) => (
              <tr key={tier.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="py-1.5">{tier.level}</td>
                <td className="py-1.5 font-medium">{formatTierPercent(tier.pct)}</td>
                <td className="py-1.5 text-green-600">{tier.level > form.referral_max_depth ? 'Actif (hors profondeur)' : 'Actif'}</td>
                <td className="py-1.5 text-gray-400">{new Date(tier.effective_from).toLocaleDateString('fr-FR')}</td>
              </tr>
            ))}
            {historyTiers.map((tier) => (
              <tr key={tier.id} className="border-t border-gray-100 text-gray-400 dark:border-gray-800">
                <td className="py-1.5">{tier.level}</td>
                <td className="py-1.5">{formatTierPercent(tier.pct)}</td>
                <td className="py-1.5">Historique</td>
                <td className="py-1.5">{new Date(tier.effective_from).toLocaleDateString('fr-FR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {message && !dirty && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-xs ${message.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{message.text}</p>
      )}

      {props.canEditSettings && dirty && (
        <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-xs text-gray-600 dark:text-gray-300">
            <strong>{changes.labels.length} modification{changes.labels.length > 1 ? 's' : ''} non enregistrée{changes.labels.length > 1 ? 's' : ''}</strong> : {changes.labels.join(', ')}
            {message && <span role="alert" className={`block ${message.tone === 'error' ? 'text-red-700' : 'text-green-700'}`}>{message.text}</span>}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" onClick={() => { setForm(baseline); setMessage(null); }} disabled={isSaving}>Annuler</Button>
            <Button onClick={requestSave} loading={isSaving}>Enregistrer</Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDisable}
        title="Désactiver le programme de fidélité ?"
        description="Les clients ne gagneront plus de points, le scan en boutique et le parrainage s'arrêtent. Les soldes existants sont conservés."
        confirmLabel="Désactiver"
        cancelLabel="Garder actif"
        destructive
        loading={isSaving}
        onCancel={() => setConfirmDisable(false)}
        onConfirm={() => void save()}
      />
    </section>
  );
}
