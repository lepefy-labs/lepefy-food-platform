import Image from 'next/image';
import Link from 'next/link';
import { contrastRatio, mixWithBlack } from '@/lib/utils/color';
import type { HomeProduct } from '@/app/(shop)/page';

interface CategoryBlockProps {
  /** Index de la catégorie dans le tableau complet (pas seulement les blocs
   *  rendus) — garantit un cycle de couleur stable indépendant des catégories
   *  vides masquées. */
  index: number;
  name: string;
  slug: string;
  count: number;
  products: HomeProduct[];
  primaryColor: string;
  secondaryColor: string;
  /** Marque une copie décorative dupliquée pour l'autoscroll en boucle
   *  (CategoryBlocksRow) — masquée des lecteurs d'écran et retirée du tab
   *  order, jamais cliquable, pour ne pas doubler la navigation clavier. */
  hiddenFromA11y?: boolean;
  /** Compact, manually navigated Catalogue rendering. Home remains default. */
  variant?: 'home' | 'catalog';
  imageUrl?: string | null;
  active?: boolean;
  onSelect?: () => void;
}

// Rotation de teinte appliquée au gradient brand — dérivée des vrais tokens
// du tenant, jamais d'une palette fixe pensée pour un tenant particulier.
const HUE_ROTATIONS = [0, -35, 35];

/**
 * Bloc-catégorie de la home (Feature 2, cycle redesign home) — remplace le
 * shelf de ProductCard par catégorie. Le fond décoratif (gradient + hue-rotate
 * ou secondary solide) est un calque séparé derrière le contenu : le filtre
 * CSS ne doit jamais s'appliquer aux vraies photos produit.
 */
export function CategoryBlock({
  index,
  name,
  slug,
  count,
  products,
  primaryColor,
  secondaryColor,
  hiddenFromA11y = false,
  variant = 'home',
  imageUrl,
  active = false,
  onSelect,
}: CategoryBlockProps) {
  const cyclePos = index % 4;
  const isSolidSecondary = cyclePos === 3;

  // Sur fond secondary solide, on vérifie le contraste réel avant de choisir
  // le texte : primary-dark si suffisant, sinon un neutre sombre (même
  // raisonnement que ShopTag pour le badge sur --color-secondary).
  const primaryDarkApprox = mixWithBlack(primaryColor, 75);
  const primaryDarkIsReadable = isSolidSecondary && contrastRatio(secondaryColor, primaryDarkApprox) >= 4.5;
  const textColor = isSolidSecondary
    ? (primaryDarkIsReadable ? 'var(--color-primary-dark)' : '#1a1a1a')
    : '#ffffff';

  if (variant === 'catalog') {
    const previewImage = imageUrl ?? products[0]?.image_url ?? null;
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={`group relative flex-[0_0_31%] sm:flex-[0_0_23%] md:flex-[0_0_168px] aspect-[4/5] snap-start overflow-hidden rounded-[18px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${active ? 'ring-2 ring-offset-2' : ''}`}
        style={{ '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}
      >
        {previewImage ? (
          <Image src={previewImage} alt="" fill className="object-cover transition-transform duration-300 motion-reduce:transition-none group-hover:scale-105" sizes="(max-width: 640px) 31vw, (max-width: 768px) 23vw, 168px" />
        ) : (
          <div aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(145deg, var(--color-primary), var(--color-primary-dark))' }} />
        )}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
        <span className="absolute inset-x-0 bottom-0 z-10 p-3 text-sm font-bold leading-tight text-white drop-shadow-sm">{name}</span>
      </button>
    );
  }

  return (
    <Link
      href={`/products?category=${slug}`}
      aria-hidden={hiddenFromA11y || undefined}
      tabIndex={hiddenFromA11y ? -1 : undefined}
      className={`relative flex-[0_0_78%] md:flex-[0_0_300px] snap-start rounded-[20px] overflow-hidden p-4 flex flex-col ${
        hiddenFromA11y ? 'pointer-events-none' : ''
      }`}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={
          isSolidSecondary
            ? { backgroundColor: 'var(--color-secondary)' }
            : {
                backgroundImage: 'linear-gradient(160deg, var(--color-primary), var(--color-primary-dark))',
                filter: `hue-rotate(${HUE_ROTATIONS[cyclePos]}deg)`,
              }
        }
      />

      <div className="relative z-10 flex flex-col h-full" style={{ color: textColor }}>
        <h3 className="font-display font-bold text-lg leading-tight">{name}</h3>
        {count > 0 && (
          <p className="text-xs opacity-80 mt-0.5">
            {count} produit{count > 1 ? 's' : ''}
          </p>
        )}

        <div className="grid grid-cols-2 gap-1.5 mt-3 mb-3 flex-1">
          {Array.from({ length: 4 }).map((_, i) => {
            const product = products[i];
            return (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-white/15">
                {product?.image_url && (
                  <Image
                    src={product.image_url}
                    alt={product.name}
                    fill
                    className="object-cover"
                    sizes="140px"
                  />
                )}
              </div>
            );
          })}
        </div>

        <span className="text-xs font-semibold mt-auto">Tout voir →</span>
      </div>
    </Link>
  );
}
