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
    <section className="rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-a-brand-soft text-a-brand-fg">
          <IconBox size={18} />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-a-brand-fg">Suggestion</p>
          <h2 className="text-sm font-semibold text-a-text">Carton à utiliser</h2>
        </div>
      </div>

      <ul className="space-y-2">
        {groups.map((group) => (
          <li key={group.carton?.id ?? 'none'} className="rounded-xl bg-a-surface-2 px-3 py-2.5">
            {group.carton ? (
              <>
                <p className="text-sm font-semibold text-a-text">
                  {group.count} × {group.carton.name}
                </p>
                <p className="mt-0.5 text-xs text-a-text-3">
                  {dims(group.carton)} · {group.weightsG.map(kg).join(' + ')}
                </p>
              </>
            ) : (
              <p className="text-xs font-medium text-tone-warning-fg">
                {group.count} colis ({group.weightsG.map(kg).join(' + ')}) : aucun carton configuré pour ce poids.
              </p>
            )}
          </li>
        ))}
      </ul>

      {alternatives.length > 0 && (
        <p className="mt-2 text-xs text-a-text-3">
          Si la marchandise est volumineuse : {alternatives.map((carton) => `${carton.name} (${dims(carton)})`).join(', ')}.
        </p>
      )}

      {missingWeightLines > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-tone-warning-fg">
          <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
          {missingWeightLines} ligne{missingWeightLines > 1 ? 's' : ''} sans poids produit : suggestion à vérifier.
        </p>
      )}

      <p className="mt-3 text-xs text-a-text-3">
        Poids total {kg(suggestion.totalWeightG)} · suggestion indicative, sans effet sur le prix facturé.
      </p>
    </section>
  );
}
