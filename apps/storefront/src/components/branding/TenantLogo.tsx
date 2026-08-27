'use client';

import Image from 'next/image';
import { useOptionalTenant } from '@/providers/TenantProvider';

type TenantLogoVariant = 'header' | 'hero' | 'compact';

type TenantLogoIdentity = {
  name: string;
  logo_url: string | null;
};

interface TenantLogoProps {
  variant?: TenantLogoVariant;
  priority?: boolean;
  className?: string;
  showNameFallback?: boolean;
  identity?: TenantLogoIdentity;
  fallbackClassName?: string;
}

const VARIANTS: Record<TenantLogoVariant, { wrapper: string; sizes: string; name: string }> = {
  header: {
    wrapper: 'h-[52px] w-[160px] max-w-[46vw] md:h-[60px] md:w-[200px] md:max-w-none',
    sizes: '(max-width: 767px) 160px, 200px',
    name: 'text-lg md:text-xl',
  },
  hero: {
    wrapper: 'h-[88px] w-[260px] max-w-[78vw] sm:h-[104px] sm:w-[320px]',
    sizes: '(max-width: 639px) 260px, 320px',
    name: 'text-2xl sm:text-3xl',
  },
  compact: {
    wrapper: 'h-10 w-[128px] max-w-[40vw]',
    sizes: '128px',
    name: 'text-base',
  },
};

export function TenantLogo({
  variant = 'header',
  priority = false,
  className = '',
  showNameFallback = true,
  identity,
  fallbackClassName = '',
}: TenantLogoProps) {
  const contextTenant = useOptionalTenant();
  const tenant = identity ?? contextTenant;
  const styles = VARIANTS[variant];

  if (!tenant) {
    throw new Error('TenantLogo requires a TenantProvider or an explicit identity prop');
  }

  if (!tenant.logo_url) {
    if (!showNameFallback) return null;
    return (
      <span
        className={`font-display font-bold ${styles.name} ${fallbackClassName || className}`.trim()}
        style={fallbackClassName ? undefined : { color: 'var(--color-primary)' }}
      >
        {tenant.name}
      </span>
    );
  }

  return (
    <span className={`relative block shrink-0 ${styles.wrapper} ${className}`.trim()}>
      <Image
        src={tenant.logo_url}
        alt={tenant.name}
        fill
        sizes={styles.sizes}
        className="object-contain"
        priority={priority}
      />
    </span>
  );
}
