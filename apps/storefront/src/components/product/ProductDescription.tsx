'use client';

import { useLocaleStore, resolveLocale } from '@/lib/store/localeStore';
import { useTenant } from '@/providers/TenantProvider';
import { LanguageToggle } from '@/components/layout/LanguageToggle';
import type { Product } from '@lepefy/types';

export function ProductDescription({ product }: { product: Pick<Product, 'description' | 'descriptions'> }) {
  const tenant         = useTenant();
  const storeLocale    = useLocaleStore((s) => s.locale);
  const tenantLocales  = tenant.locales ?? [];
  const activeLocale   = resolveLocale(storeLocale, tenantLocales);
  const showToggle     = tenantLocales.length > 1;

  const text = product.descriptions?.[activeLocale]
    ?? product.description
    ?? null;

  if (!text && !showToggle) return null;

  return (
    <div>
      {showToggle && (
        <div className="mb-2">
          <LanguageToggle locales={tenantLocales} />
        </div>
      )}
      {text && <p className="text-gray-600 leading-relaxed">{text}</p>}
    </div>
  );
}
