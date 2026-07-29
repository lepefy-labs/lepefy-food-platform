import { formatPrice } from '@/lib/utils/format';

interface LockedTagProgressProps {
  currentSpend: number;
  threshold: number;
  currency: string;
}

/**
 * "Cartellino contorno che si riempie" — même géométrie que ShopTag (clip-path
 * pointe + perforation), rempli verticalement par mask-image (proportion =
 * dépense actuelle / seuil) plutôt qu'une barre de progression générique.
 */
export function LockedTagProgress({ currentSpend, threshold, currency }: LockedTagProgressProps) {
  const pct = threshold > 0 ? Math.max(0, Math.min(1, currentSpend / threshold)) : 0;
  const remaining = Math.max(0, threshold - currentSpend);
  const clipPath = 'polygon(0% 0%, 100% 0%, 100% 100%, 14% 100%, 0% 68%)';
  const maskImage = `linear-gradient(to top, black ${pct * 100}%, transparent ${pct * 100}%)`;

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="relative w-40 h-16">
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{ backgroundColor: 'var(--color-primary-light)', clipPath }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundColor: 'var(--color-primary)',
            clipPath,
            WebkitMaskImage: maskImage,
            maskImage,
          }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{ clipPath, boxShadow: 'inset 0 0 0 2px var(--color-primary-dark)' }}
        />
      </div>
      <p className="text-sm text-gray-600 text-center max-w-[220px]">
        Encore <span className="font-semibold" style={{ color: 'var(--color-primary-dark)' }}>
          {formatPrice(remaining, currency)}
        </span>{' '}
        pour débloquer les invitations
      </p>
    </div>
  );
}
