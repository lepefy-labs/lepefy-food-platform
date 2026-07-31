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

  return (
    <Link
      href={`/products?category=${slug}`}
      className="relative flex-[0_0_78%] md:flex-[0_0_300px] snap-start rounded-[20px] overflow-hidden p-4 flex flex-col"
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
