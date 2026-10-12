'use client';

import { forwardRef, useState } from 'react';
import Image, { type ImageProps } from 'next/image';
import { useOptionalTenant } from '@/providers/TenantProvider';
import { useProductImageDelivery } from '@/providers/ProductImageDeliveryProvider';
import { isExternalHttpImage, resolveProductImage, type ProductImageVariant } from '@/lib/images/productImageDelivery';

type Props = Omit<ImageProps, 'src' | 'unoptimized'> & {
  src: string;
  variant: ProductImageVariant;
};

/** Direct CDN delivery is used only for complete, versioned product-image sets. */
export const LepefyImage = forwardRef<HTMLImageElement, Props>(function LepefyImage({ src, variant, alt, fill, width, height, sizes, priority, className, style, ...rest }, ref) {
  const enabled = useProductImageDelivery();
  const tenant = useOptionalTenant();
  const resolved = resolveProductImage(src, variant, enabled, process.env.NEXT_PUBLIC_SUPABASE_URL, tenant?.id);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const unavailable = <span role="img" aria-label={alt || 'Image indisponible'} className="absolute inset-0 flex items-center justify-center bg-gray-100 text-xs text-gray-600">Image indisponible</span>;
  if (!src || src.startsWith('//') || (!src.startsWith('/') && !/^https?:\/\//i.test(src))) return unavailable;
  if (!resolved.direct) {
    if (failedSrc === src) return unavailable;
    if (isExternalHttpImage(src, process.env.NEXT_PUBLIC_SUPABASE_URL)) {
      return (
        // eslint-disable-next-line @next/next/no-img-element -- third-party URLs are not in Next remotePatterns
        <img ref={ref} src={src} alt={alt} width={fill ? undefined : width} height={fill ? undefined : height}
          loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : undefined} decoding="async"
          className={className} style={fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', ...style } : style}
          onError={() => setFailedSrc(src)} />
      );
    }
    return <Image ref={ref} src={src} alt={alt} fill={fill} width={width} height={height} sizes={sizes} priority={priority} className={className} style={style} onError={() => setFailedSrc(src)} {...rest} />;
  }
  const currentSrc = failedSrc === resolved.src ? resolved.masterUrl : resolved.src;
  const fallbackFailed = failedSrc === resolved.masterUrl;
  if (fallbackFailed) return unavailable;
  const sourceSet = failedSrc
    ? undefined
    : `${resolved.variants.thumbnail} 160w, ${resolved.variants.catalog} 480w, ${resolved.variants.detail} 960w, ${resolved.variants.full} 1600w`;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- immutable Supabase variants bypass Vercel transforms
    <img
      ref={ref}
      src={currentSrc}
      srcSet={sourceSet}
      sizes={sizes}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
      className={className}
      style={fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', ...style } : style}
      onError={() => setFailedSrc(currentSrc)}
    />
  );
});
