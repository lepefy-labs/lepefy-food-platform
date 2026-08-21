'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

interface CatalogCategoryImageProps {
  images: string[];
  categoryIndex: number;
  animate: boolean;
}

export function CatalogCategoryImage({ images, categoryIndex, animate }: CatalogCategoryImageProps) {
  const [imageIndex, setImageIndex] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const currentImage = images[imageIndex] ?? images[0];

  useEffect(() => {
    setImageIndex(0);
    if (images.length < 2 || !animate) return;
    const interval = window.setInterval(
      () => setImageIndex(current => (current + 1) % images.length),
      3500 + (categoryIndex % 3) * 250,
    );
    return () => window.clearInterval(interval);
  }, [animate, categoryIndex, images]);

  useEffect(() => {
    if (!animate || imageIndex === 0) return;
    imageRef.current?.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
  }, [animate, imageIndex]);

  if (!currentImage) return null;

  return (
    <Image
      ref={imageRef}
      key={currentImage}
      src={currentImage}
      alt=""
      fill
      className="object-cover"
      sizes="(max-width: 640px) 31vw, (max-width: 768px) 23vw, 168px"
    />
  );
}
