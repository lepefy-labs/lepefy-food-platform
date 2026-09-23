'use client';

import { useLocaleStore, resolveLocale } from '@/lib/store/localeStore';
import { zoneLabel, type PublicTariffCountry } from '@/lib/shipping/tariff/publicGrid';

const TEXT = {
  fr: {
    title: 'Frais de livraison',
    intro: 'Le prix dépend du poids total des produits de votre commande. Emballage compris.',
    ttc: 'Prix TTC.',
    ht: 'Prix hors TVA, TVA ajoutée au paiement.',
    weight: 'Poids des produits',
    price: 'Livraison',
    upTo: (kg: string) => `Jusqu’à ${kg}`,
    between: (a: string, b: string) => `De ${a} à ${b}`,
    above: (kg: string) => `Plus de ${kg}`,
    block: (kg: string, price: string) => `Au-delà de ${kg} : ${price} par tranche de ${kg}, plus le tarif du poids restant.`,
    parcels: (kg: string) => `Les commandes sont expédiées en colis de ${kg} maximum.`,
    override: 'Tarif unique de livraison',
    surchargesTitle: 'Suppléments géographiques',
    perParcel: 'par colis',
    perOrder: 'par commande',
    conditionsTitle: 'Conditions',
    free: (amount: string) => `Livraison offerte dès ${amount} d’achats.`,
    discountPct: (v: number) => `Remise de ${v} % sur les frais de livraison.`,
    discountFixed: (amount: string) => `Remise de ${amount} sur les frais de livraison.`,
    notServedTitle: 'Destinations non desservies',
    pickup: 'Le retrait en magasin reste possible.',
    finalNote: 'Le montant exact est calculé dans votre panier à partir de votre adresse, avant le paiement.',
  },
  it: {
    title: 'Spese di consegna',
    intro: 'Il prezzo dipende dal peso totale dei prodotti dell’ordine. Imballaggio incluso.',
    ttc: 'Prezzi IVA inclusa.',
    ht: 'Prezzi IVA esclusa, IVA aggiunta al pagamento.',
    weight: 'Peso dei prodotti',
    price: 'Consegna',
    upTo: (kg: string) => `Fino a ${kg}`,
    between: (a: string, b: string) => `Da ${a} a ${b}`,
    above: (kg: string) => `Oltre ${kg}`,
    block: (kg: string, price: string) => `Oltre ${kg}: ${price} per ogni blocco di ${kg}, più la tariffa del peso restante.`,
    parcels: (kg: string) => `Gli ordini sono spediti in colli da massimo ${kg}.`,
    override: 'Tariffa unica di consegna',
    surchargesTitle: 'Supplementi geografici',
    perParcel: 'per collo',
    perOrder: 'per ordine',
    conditionsTitle: 'Condizioni',
    free: (amount: string) => `Consegna gratuita da ${amount} di acquisti.`,
    discountPct: (v: number) => `Sconto del ${v} % sulle spese di consegna.`,
    discountFixed: (amount: string) => `Sconto di ${amount} sulle spese di consegna.`,
    notServedTitle: 'Destinazioni non servite',
    pickup: 'Resta possibile il ritiro in negozio.',
    finalNote: 'L’importo esatto è calcolato nel carrello in base al tuo indirizzo, prima del pagamento.',
  },
} as const;

export function ShippingGridClient({
  grid, locales, currency, clickCollectEnabled,
}: {
  grid: PublicTariffCountry[];
  locales: string[];
  currency: string;
  clickCollectEnabled: boolean;
}) {
  const storeLocale = useLocaleStore((s) => s.locale);
  const locale = resolveLocale(storeLocale, locales) === 'it' ? 'it' : 'fr';
  const t = TEXT[locale];
  const intlLocale = locale === 'it' ? 'it-IT' : 'fr-FR';
  const money = (cents: number) => (cents / 100).toLocaleString(intlLocale, { style: 'currency', currency });
  const kg = (g: number) => `${(g / 1000).toLocaleString(intlLocale, { maximumFractionDigits: 3 })} kg`;
  let regionNames: Intl.DisplayNames | null = null;
  try { regionNames = new Intl.DisplayNames([intlLocale], { type: 'region' }); } catch { regionNames = null; }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{t.title}</h1>
      <p className="text-sm text-gray-600 mb-8">{t.intro}</p>

      <div className="space-y-10">
        {grid.map((c) => (
          <section key={c.country} aria-labelledby={`livraison-${c.country}`}>
            {grid.length > 1 && (
              <h2 id={`livraison-${c.country}`} className="text-lg font-semibold text-gray-900 mb-3">{regionNames?.of(c.country) ?? c.country}</h2>
            )}
            {grid.length === 1 && <h2 id={`livraison-${c.country}`} className="sr-only">{regionNames?.of(c.country) ?? c.country}</h2>}

            {c.flatRateOverrideCents !== null ? (
              <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800">
                {t.override} : <span className="font-semibold tabular-nums">{money(c.flatRateOverrideCents)}</span>
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t.title}</caption>
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th scope="col" className="px-4 py-3 font-medium">{t.weight}</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">{t.price}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.bands.map((b) => (
                      <tr key={b.minG} className="border-b border-gray-50 last:border-0">
                        <th scope="row" className="px-4 py-3 text-left font-normal text-gray-700">
                          {b.maxG === null ? t.above(kg(b.minG)) : b.minG === 0 ? t.upTo(kg(b.maxG)) : t.between(kg(b.minG), kg(b.maxG))}
                        </th>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900">{money(b.priceCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <ul className="mt-3 space-y-1 text-xs text-gray-500">
              <li>{c.pricesIncludeVat ? t.ttc : t.ht}</li>
              {c.flatRateOverrideCents === null && c.block && <li>{t.block(kg(c.block.weightG), money(c.block.priceCents))}</li>}
              <li>{t.parcels(kg(c.maxParcelWeightG))}</li>
            </ul>

            {c.flatRateOverrideCents === null && c.surcharges.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">{t.surchargesTitle}</h3>
                <ul className="space-y-1 text-sm text-gray-700">
                  {c.surcharges.map((s) => (
                    <li key={s.zoneCode} className="flex justify-between gap-4">
                      <span>{zoneLabel(s.zoneCode, locale)}</span>
                      <span className="tabular-nums">+{money(s.amountCents)} {s.perParcel ? t.perParcel : t.perOrder}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(c.freeShippingAboveCents !== null || c.discount) && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">{t.conditionsTitle}</h3>
                <ul className="space-y-1 text-sm text-gray-700">
                  {c.discount && <li>{c.discount.type === 'percentage' ? t.discountPct(c.discount.value) : t.discountFixed(money(Math.round(c.discount.value * 100)))}</li>}
                  {c.freeShippingAboveCents !== null && <li>{t.free(money(c.freeShippingAboveCents))}</li>}
                </ul>
              </div>
            )}

            {(c.nonDeliverableZones.length > 0 || c.extraCustomsTerritories.length > 0) && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-2">{t.notServedTitle}</h3>
                <ul className="space-y-1 text-sm text-gray-700">
                  {c.extraCustomsTerritories.map((x) => <li key={x.postalCode}>{x.name} ({x.postalCode})</li>)}
                  {c.nonDeliverableZones.filter((z) => !z.endsWith('EXTRA_CUSTOMS') || c.extraCustomsTerritories.length === 0)
                    .map((z) => <li key={z}>{zoneLabel(z, locale)}</li>)}
                </ul>
                {clickCollectEnabled && <p className="mt-2 text-xs text-gray-500">{t.pickup}</p>}
              </div>
            )}
          </section>
        ))}
      </div>

      <p className="mt-10 text-xs text-gray-500">{t.finalNote}</p>
    </div>
  );
}
