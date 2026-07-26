type StorageType = 'dry' | 'fresh' | 'frozen';

const STORAGE_LABEL: Record<'fr' | 'it', Record<StorageType, string>> = {
  fr: { dry: 'Ambiant', fresh: 'Réfrigéré', frozen: 'Congelé' },
  it: { dry: 'Ambiente', fresh: 'Refrigerato', frozen: 'Surgelato' },
};

const SPEC_LABEL = {
  fr: { weight: 'Poids', origin: 'Origine', conservation: 'Conservation' },
  it: { weight: 'Peso', origin: 'Origine', conservation: 'Conservazione' },
};

function formatWeight(grams: number): string {
  return grams >= 1000 ? `${+(grams / 1000).toFixed(2)} kg` : `${grams} g`;
}

interface ProductSpecsProps {
  netQuantityDisplay: string | null;
  weightGrams: number | null;
  countryOfOrigin: string | null;
  storageType: 'dry' | 'fresh' | 'frozen' | null;
  locale: string;
}

/**
 * Rangée Poids / Origine / Conservation. Chaque colonne n'existe que si sa
 * donnée réelle est disponible — pas de 3 slots fixes avec des vides au
 * milieu, et surtout : "Conservation" ici est une étiquette courte dérivée
 * de `storage_type` (ex. "Réfrigéré"), jamais le texte long de
 * `conservation_instructions` (celui-ci vit dans l'onglet Conservation).
 */
export function ProductSpecs({ netQuantityDisplay, weightGrams, countryOfOrigin, storageType, locale }: ProductSpecsProps) {
  const lang = locale === 'it' ? 'it' : 'fr';
  const labels = SPEC_LABEL[lang];

  const weightValue = netQuantityDisplay || (weightGrams ? formatWeight(weightGrams) : null);
  const conservationValue: string | null = storageType ? STORAGE_LABEL[lang][storageType] : null;

  const columns = [
    weightValue && { label: labels.weight, value: weightValue },
    countryOfOrigin && { label: labels.origin, value: countryOfOrigin },
    conservationValue && { label: labels.conservation, value: conservationValue },
  ].filter((c): c is { label: string; value: string } => Boolean(c));

  if (columns.length === 0) return null;

  return (
    <div
      className="grid gap-4 py-4"
      style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)`, borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}
    >
      {columns.map((col) => (
        <div key={col.label}>
          <p className="text-sm text-gray-400">{col.label}</p>
          <p className="text-sm font-bold text-gray-900">{col.value}</p>
        </div>
      ))}
    </div>
  );
}
