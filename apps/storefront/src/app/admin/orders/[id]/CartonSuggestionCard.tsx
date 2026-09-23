import { IconAlertTriangle, IconBox } from '@tabler/icons-react';
import { groupSuggestedCartons, type CartonProfile, type CartonSuggestion } from '@/lib/shipping/cartonSuggestion';

function kg(weightG: number) {
  return `${(weightG / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`;
}

function dims(carton: CartonProfile) {
  return `${carton.box_length_cm} × ${carton.box_width_cm} × ${carton.box_height_cm} cm`;
}

interface Props {
  suggestion: CartonSuggestion;
  missingWeightLines: number;
}

export default function CartonSuggestionCard({ suggestion, missingWeightLines }: Props) {
  const groups = groupSuggestedCartons(suggestion);
  const alternatives = Array.from(new Map(
    suggestion.parcels.flatMap((parcel) => parcel.alternatives).map((carton) => [carton.id, carton]),
  ).values());

  return (
    <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]">
          <IconBox size={18} />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--admin-primary-fg)]">Suggestion</p>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Carton à utiliser</h2>
        </div>
      </div>

      <ul className="space-y-2">
        {groups.map((group) => (
          <li key={group.carton?.id ?? 'none'} className="rounded-xl bg-[var(--admin-surface-subtle)] px-3 py-2.5 dark:bg-gray-950/30">
            {group.carton ? (
              <>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {group.count} × {group.carton.name}
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {dims(group.carton)} · {group.weightsG.map(kg).join(' + ')}
                </p>
              </>
            ) : (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                {group.count} colis ({group.weightsG.map(kg).join(' + ')}) : aucun carton configuré pour ce poids.
              </p>
            )}
          </li>
        ))}
      </ul>

      {alternatives.length > 0 && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Si la marchandise est volumineuse : {alternatives.map((carton) => `${carton.name} (${dims(carton)})`).join(', ')}.
        </p>
      )}

      {missingWeightLines > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
          {missingWeightLines} ligne{missingWeightLines > 1 ? 's' : ''} sans poids produit : suggestion à vérifier.
        </p>
      )}

      <p className="mt-3 text-[11px] text-gray-400">
        Poids total {kg(suggestion.totalWeightG)} · suggestion indicative, sans effet sur le prix facturé.
      </p>
    </section>
  );
}
