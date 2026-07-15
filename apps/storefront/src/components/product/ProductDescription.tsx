'use client';

import { useLocaleStore, resolveLocale } from '@/lib/store/localeStore';
import { useTenant } from '@/providers/TenantProvider';
import type { Product } from '@lepefy/types';

export function ProductDescription({ product }: { product: Pick<Product, 'description' | 'descriptions'> }) {
  const tenant       = useTenant();
  const storeLocale  = useLocaleStore((s) => s.locale);
  const tenantLocales = tenant.locales ?? [];
  const activeLocale = resolveLocale(storeLocale, tenantLocales);

  const text = product.descriptions?.[activeLocale]
    ?? product.description
    ?? null;

  if (!text) return null;

  return <p className="text-gray-600 leading-relaxed">{text}</p>;
}
