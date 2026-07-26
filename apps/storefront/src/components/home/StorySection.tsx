import Image from 'next/image';

interface StorySectionProps {
  heading: string | null;
  text: string | null;
  imageUrl: string | null;
  productsCount: number;
  countriesServed: number | null;
}

/**
 * Section "Notre origine" — contenu 100% éditorial (jamais généré/déduit).
 * Ne se rend pas du tout si le tenant n'a pas encore rempli son texte : pas
 * de placeholder, pas de section vide.
 */
export function StorySection({ heading, text, imageUrl, productsCount, countriesServed }: StorySectionProps) {
  if (!heading || !text) return null;

  return (
    <section id="origine" className="px-4 mt-10 mb-4">
      <div className="grid gap-6 md:grid-cols-2 md:gap-10 md:items-center">
        {imageUrl && (
          <div className="relative aspect-[4/3] rounded-lg overflow-hidden">
            <Image
              src={imageUrl}
              alt={heading}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          </div>
        )}

        <div className={imageUrl ? '' : 'md:col-span-2'}>
          <h2 className="font-display text-xl font-bold text-gray-900 mb-3">{heading}</h2>
          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{text}</p>

          <div className="flex flex-wrap gap-x-8 gap-y-3 mt-6">
            <div>
              <p className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>
                {productsCount}+
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Produits</p>
            </div>
            {countriesServed !== null && (
              <div>
                <p className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>
                  {countriesServed}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Pays desservis</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
