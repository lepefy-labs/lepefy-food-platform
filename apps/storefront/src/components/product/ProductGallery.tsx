'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ShopTag } from '@/components/ui/ShopTag';
import type { ProductImage } from '@lepefy/types';

interface ProductGalleryProps {
  name: string;
  imageUrl: string | null;
  images: ProductImage[];
  isHomemade: boolean;
}

/**
 * Aujourd'hui chaque produit n'a qu'une seule image réelle — le composant
 * est déjà prêt pour N images (pipeline photo multi-image à venir) : la
 * rangée de miniatures ne s'affiche que si `images` en contient plus d'une,
 * et se déduit dynamiquement de leur nombre (jamais 4 slots fixes).
 */
export function ProductGallery({ name, imageUrl, images, isHomemade }: ProductGalleryProps) {
  const gallery = images.length > 0 ? images : imageUrl ? [{ url: imageUrl, alt: name }] : [];
  const [activeIndex, setActiveIndex] = useState(0);
  const active = gallery[activeIndex] ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="aspect-square bg-gray-100 rounded-2xl overflow-hidden relative">
        {active ? (
          <Image
            src={active.url}
            alt={active.alt || name}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 50vw"
            priority
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-200">
            <svg className="w-24 h-24" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {isHomemade && (
          <ShopTag className="absolute top-4 left-4 z-10">Fait maison</ShopTag>
        )}
      </div>

      {gallery.length > 1 && (
        <div className="grid grid-cols-4 gap-3">
          {gallery.map((img, i) => (
            <button
              key={img.url + i}
              type="button"
              onClick={() => setActiveIndex(i)}
              aria-label={`Voir l'image ${i + 1}`}
              aria-current={i === activeIndex}
              className="aspect-square bg-gray-100 rounded-lg overflow-hidden relative border-2 transition-colors"
              style={{ borderColor: i === activeIndex ? 'var(--color-primary)' : 'transparent' }}
            >
              <Image src={img.url} alt={img.alt || name} fill className="object-cover" sizes="120px" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
