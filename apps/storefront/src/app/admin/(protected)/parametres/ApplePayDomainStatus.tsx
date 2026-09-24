'use client';

import { useCallback, useEffect, useState } from 'react';
import { IconBrandApple, IconCircleCheck, IconAlertTriangle, IconRefresh } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';

// Statut de l'enregistrement du domaine tenant chez Stripe pour Apple Pay
// (GET/POST /api/admin/payment-methods/apple-pay/domain). Affiché seulement
// quand une ligne apple_pay active existe.

interface DomainStatus {
  domain?: string;
  registered?: boolean | null;
  enabled?: boolean | null;
  applePayStatus?: string | null;
  applePayError?: string | null;
  error?: string;
}

function statusLabel(s: DomainStatus): { text: string; ok: boolean } {
  if (s.registered === null || s.registered === undefined) return { text: 'Statut inconnu', ok: false };
  if (!s.registered) return { text: 'Domaine non enregistré', ok: false };
  if (s.enabled === false) return { text: 'Domaine désactivé chez Stripe', ok: false };
  if (s.applePayStatus === 'active') return { text: 'Domaine enregistré · Apple Pay actif', ok: true };
  return { text: `Domaine enregistré · Apple Pay : ${s.applePayStatus ?? 'en attente'}`, ok: false };
}

export function ApplePayDomainStatus() {
  const [status, setStatus] = useState<DomainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/payment-methods/apple-pay/domain', { cache: 'no-store' });
      setStatus(await res.json() as DomainStatus);
    } catch {
      setStatus({ error: 'Impossible de lire le statut du domaine.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function register() {
    setRegistering(true);
    try {
      const res = await fetch('/api/admin/payment-methods/apple-pay/domain', { method: 'POST' });
      const data = await res.json() as DomainStatus;
      setStatus(res.ok ? data : { ...status, error: data.error ?? 'Erreur lors de l’enregistrement.' });
    } catch {
      setStatus({ ...status, error: 'Erreur lors de l’enregistrement.' });
    } finally {
      setRegistering(false);
    }
  }

  const label = status ? statusLabel(status) : null;

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950/30">
      <div className="flex items-start gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black text-white">
          <IconBrandApple size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Apple Pay : domaine Stripe</p>
          <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">
            Apple Pay ne s’affiche dans /card que si le domaine de la boutique est enregistré sur le compte Stripe du module Carte.
          </p>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {loading ? (
          <p className="text-xs text-gray-400">Chargement du statut…</p>
        ) : status && (
          <>
            {status.domain && (
              <p className="break-all text-sm text-gray-700 dark:text-gray-300">
                Domaine : <span className="font-mono font-semibold">{status.domain}</span>
              </p>
            )}
            {label && !status.error && (
              <p className={`flex items-center gap-1.5 text-sm font-medium ${label.ok ? 'text-emerald-700' : 'text-amber-700'}`}>
                {label.ok ? <IconCircleCheck size={16} /> : <IconAlertTriangle size={16} />}
                {label.text}
              </p>
            )}
            {status.applePayError && <p className="text-xs text-amber-700">{status.applePayError}</p>}
            {status.error && <p className="text-xs font-medium text-red-600">{status.error}</p>}
          </>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={register} loading={registering} disabled={loading || !status?.domain}>
            Enregistrer le domaine
          </Button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300"
          >
            <IconRefresh size={14} />
            Actualiser
          </button>
        </div>

        <p className="rounded-xl bg-[var(--admin-surface-subtle)] px-3 py-2.5 text-xs leading-5 text-gray-600 dark:bg-gray-900 dark:text-gray-400">
          À faire aussi : activer Apple Pay dans le Dashboard Stripe (Réglages → Moyens de paiement → Apple Pay) sur chaque compte Stripe utilisé par le module Carte.
        </p>
      </div>
    </div>
  );
}
