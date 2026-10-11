type StorageType = 'dry' | 'fresh' | 'frozen';

const STORAGE_LABEL: Record<'fr' | 'it', Record<StorageType, string>> = {
  fr: { dry: 'Ambiant', fresh: 'Réfrigéré', frozen: 'Congelé' },
  it: { dry: 'Ambiente', fresh: 'Refrigerato', frozen: 'Surgelato' },
};

const SPEC_LABEL = {
  fr: { content: 'Contenu', origin: 'Origine', conservation: 'Conservation' },
  it: { content: 'Contenuto', origin: 'Origine', conservation: 'Conservazione' },
};

interface ProductSpecsProps {
  /** Quantité nette vendue (« 500 g », « 12 × 33 cl ») ; null si inconnue. */
  content: string | null;
  countryOfOrigin: string | null;
  storageType: 'dry' | 'fresh' | 'frozen' | null;
  locale: string;
}

/**
 * Rangée Contenu / Origine / Conservation. Chaque colonne n'existe que si sa
 * donnée réelle est disponible — pas de 3 slots fixes avec des vides au
 * milieu. « Contenu » est la quantité nette vendue, jamais `weight_grams`
 * (poids logistique, emballage compris). "Conservation" est une étiquette
 * courte dérivée de `storage_type` (ex. "Réfrigéré"), jamais le texte long de
 * `conservation_instructions` (celui-ci vit dans l'onglet Conservation).
 */
export function ProductSpecs({ content, countryOfOrigin, storageType, locale }: ProductSpecsProps) {
  const lang = locale === 'it' ? 'it' : 'fr';
  const labels = SPEC_LABEL[lang];

  const conservationValue: string | null = storageType ? STORAGE_LABEL[lang][storageType] : null;

  const columns = [
    content && { label: labels.content, value: content },
    countryOfOrigin && { label: labels.origin, value: countryOfOrigin },
    conservationValue && { label: labels.conservation, value: conservationValue },
  ].filter((c): c is { label: string; value: string } => Boolean(c));

  if (columns.length === 0) return null;

  return (
    <dl
      className="grid gap-4 rounded-2xl px-4 py-3.5"
      style={{
        gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
        backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, white)',
        border: '1px solid color-mix(in srgb, var(--color-primary) 30%, white)',
      }}
    >
      {columns.map((col) => (
        <div key={col.label} className="min-w-0">
          <dt
            className="text-xs font-medium uppercase tracking-wide"
            style={{ color: 'color-mix(in srgb, var(--color-primary) 70%, black)' }}
          >
            {col.label}
          </dt>
          <dd
            className="mt-0.5 break-words text-sm font-bold"
            style={{ color: 'color-mix(in srgb, var(--color-primary) 80%, black)' }}
          >
            {col.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
