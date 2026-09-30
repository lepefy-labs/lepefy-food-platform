'use client';

import { useState } from 'react';
import { IconFlask, IconInfoCircle } from '@tabler/icons-react';
import type { TenantFeatureFlag } from '@/lib/featureFlags/featureFlags';
import { SettingsFeedback, SettingsPanel, SettingsStatusBadge } from './_components/SettingsUi';
import { useSettingsFeedback } from './_components/useSettingsFeedback';

interface Props {
  /** null: table indisponible (migration 138 non appliquée) ou erreur de lecture. */
  initialFlags: TenantFeatureFlag[] | null;
  isTestTenant: boolean;
}

/** Flags de déploiement du tenant courant ; une ligne absente = désactivé. */
export function FeatureFlagsSection({ initialFlags, isTestTenant }: Props) {
  const [flags, setFlags] = useState<TenantFeatureFlag[] | null>(initialFlags);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const { feedback, show } = useSettingsFeedback();

  async function toggle(flag: TenantFeatureFlag) {
    const enabled = !flag.enabled;
    setPendingKey(flag.key);
    try {
      const response = await fetch('/api/admin/feature-flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagKey: flag.key, enabled }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; flags?: TenantFeatureFlag[] };
      if (!response.ok || !body.flags) throw new Error(body.error || 'Enregistrement impossible.');
      setFlags(body.flags);
      show(enabled ? `« ${flag.label} » activée.` : `« ${flag.label} » désactivée.`, 'success');
    } catch (error) {
      show(error instanceof Error ? error.message : 'Enregistrement impossible.', 'error');
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <SettingsPanel
      id="fonctionnalites"
      title="Nouveautés en déploiement"
      description="Chaque nouvelle fonctionnalité arrive désactivée. Elle est d’abord testée sur la boutique de test, puis activée ici pour votre boutique."
      aside={isTestTenant ? <SettingsStatusBadge status={{ label: 'Boutique de test', tone: 'warning' }} /> : undefined}
      footer={feedback ? <SettingsFeedback feedback={feedback} /> : undefined}
    >
      {flags === null ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          Les fonctionnalités ne peuvent pas être chargées pour le moment.
        </p>
      ) : flags.length === 0 ? (
        <div className="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-300">
          <IconInfoCircle size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
          <p>Aucune fonctionnalité en cours de déploiement.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {flags.map((flag) => {
            const busy = pendingKey === flag.key;
            return (
              <li key={flag.key} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <IconFlask size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-950 dark:text-gray-100">{flag.label}</p>
                    <p className="mt-0.5 text-sm leading-6 text-gray-500 dark:text-gray-400">{flag.description}</p>
                    <p className="mt-1 break-all font-mono text-xs text-gray-400">{flag.key}</p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={flag.enabled}
                  aria-label={`${flag.enabled ? 'Désactiver' : 'Activer'} ${flag.label}`}
                  disabled={busy}
                  onClick={() => toggle(flag)}
                  className="inline-flex min-h-11 shrink-0 items-center gap-3 self-start rounded-lg px-2 text-sm font-medium text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] disabled:opacity-60 sm:self-auto dark:text-gray-200"
                >
                  <span
                    aria-hidden="true"
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${flag.enabled ? 'bg-[var(--color-primary-dark)]' : 'bg-gray-300 dark:bg-gray-600'}`}
                  >
                    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${flag.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </span>
                  {busy ? 'Enregistrement…' : flag.enabled ? 'Activée' : 'Désactivée'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsPanel>
  );
}
