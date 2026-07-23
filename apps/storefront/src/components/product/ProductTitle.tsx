'use client';

import { useLocaleStore, resolveLocale } from '@/lib/store/localeStore';
import { useTenant } from '@/providers/TenantProvider';
import type { Product } from '@lepefy/types';

/**
 * Titolo prodotto localizzato. Usa `name_alt` quando la lingua attiva non è
 * la lingua di default del tenant (tenant.locales[0]) ed è disponibile,
 * altrimenti ripiega su `name`. Condivide lo store con ProductDescription:
 * titolo e descrizione restano sincronizzati senza prop condivise.
 */
export function ProductTitle({ product }: { product: Pick<Product, 'name' | 'name_alt'> }) {
  const tenant        = useTenant();
  const storeLocale   = useLocaleStore((s) => s.locale);
  const tenantLocales = tenant.locales ?? [];
  const activeLocale  = resolveLocale(storeLocale, tenantLocales);
  const isDefault     = activeLocale === tenantLocales[0];

  const title = !isDefault && product.name_alt ? product.name_alt : product.name;

  return <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">{title}</h1>;
}
