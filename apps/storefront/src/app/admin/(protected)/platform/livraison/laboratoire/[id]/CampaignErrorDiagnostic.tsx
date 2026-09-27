import { ERROR_REASONS } from '@/lib/shipping/intelligence/campaignErrorReasons';
import type { ErrorBreakdownEntry } from '@/lib/shipping/intelligence/campaignCoverage';

const KIND_LABEL = { incident: 'Incident', data: 'Donnée', history: 'Historique' } as const;
const KIND_CLS = {
  incident: 'bg-red-50 text-red-700',
  data: 'bg-gray-100 text-gray-700',
  history: 'bg-amber-50 text-amber-800',
} as const;

const MAX_POSTAL_SHOWN = 12;

function formatKg(value: number): string {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

/**
 * Diagnostic des scénarios sans devis valide, par motif — à consulter avant
 * toute remesure : il indique la cause, les CAP et poids concernés et si le
 * motif sera inclus dans une remesure.
 */
export function CampaignErrorDiagnostic({ breakdown }: { breakdown: ErrorBreakdownEntry[] }) {
  if (breakdown.length === 0) {
    return <p className="text-xs text-green-700">Aucune erreur ni donnée incompatible dans cette campagne.</p>;
  }

  return (
    <div className="space-y-2">
      {breakdown.map((entry) => {
        const info = ERROR_REASONS[entry.code];
        const shown = entry.postalCodes.slice(0, MAX_POSTAL_SHOWN);
        return (
          <details key={entry.code} className="rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 group">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
              <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded ${KIND_CLS[info.kind]}`}>{KIND_LABEL[info.kind]}</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{info.label}</span>
              <span className="text-xs text-gray-500">
                {entry.scenarios} scénario(s) · {entry.postalCodes.length} CAP
              </span>
              <span className={`ml-auto text-2xs font-semibold px-1.5 py-0.5 rounded ${entry.resample ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                {entry.resample ? 'Inclus dans la remesure' : 'Exclu de la remesure'}
              </span>
            </summary>
            <div className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300">
              <p>{info.explanation}</p>
              <p>
                <span className="text-gray-400">CAP : </span>
                <span className="tabular-nums">{shown.join(', ')}{entry.postalCodes.length > shown.length ? ` +${entry.postalCodes.length - shown.length}` : ''}</span>
              </p>
              <p><span className="text-gray-400">Poids : </span>{entry.weightsKg.map(formatKg).join(' · ')} kg</p>
              {entry.sampleMessage && (
                <p><span className="text-gray-400">Message d&apos;exemple : </span><code className="break-all">{entry.sampleMessage}</code></p>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
