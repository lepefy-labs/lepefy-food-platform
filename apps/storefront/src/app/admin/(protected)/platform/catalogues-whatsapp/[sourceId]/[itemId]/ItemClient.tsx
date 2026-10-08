'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconExternalLink } from '@tabler/icons-react';
import { computeUnitPrice, lotPriceFor, type PriceRounding } from '@/lib/externalCatalog/pricing';
import { netQuantityDisplay, unitWeightGrams } from '@/lib/externalCatalog/proposalFormat';
import type { NormalizedExternalProduct } from '@/lib/externalCatalog/types';
import { CARD, CONSENT, INPUT, ITEM_STATUS, LABEL, PRIMARY, SECONDARY, apiJson, dateTime, euro, readItemNavigation, type ItemStatus } from '../../ui';

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  min_order_quantity: number;
  order_quantity_step: number;
  weight_grams: number | null;
  net_quantity_display: string | null;
  category_id: string | null;
  active: boolean;
  image_url: string | null;
  images: Array<{ url: string }> | null;
}

interface Detail {
  item: {
    id: string;
    status: ItemStatus;
    normalized: NormalizedExternalProduct;
    displayed_price: number | null;
    sale_price: number | null;
    currency: string | null;
    previous_price: number | null;
    linked_product_id: string | null;
    applied_at: string | null;
    last_seen_at: string;
  };
  source: {
    label: string;
    default_discount_pct: number;
    consent_status: string;
    status: string;
    tenants: { slug: string; name: string; storefront_url: string | null } | null;
  };
  categories: Array<{ id: string; name: string }>;
  product: Product | null;
  events: Array<{ action: string; fields: Record<string, unknown>; created_at: string }>;
  flagEnabled: boolean;
}

type FieldKey = 'name' | 'description' | 'price' | 'min_order_quantity' | 'order_quantity_step' | 'weight_grams' | 'net_quantity_display' | 'category_id';

const FIELD_LABEL: Record<FieldKey, string> = {
  name: 'Nom',
  description: 'Description',
  price: 'Prix unitaire',
  min_order_quantity: 'Quantité minimale',
  order_quantity_step: 'Incrément',
  weight_grams: 'Poids unitaire (g)',
  net_quantity_display: 'Quantité nette',
  category_id: 'Catégorie',
};

const EVENT_LABEL: Record<string, string> = {
  created: 'Produit créé', updated: 'Produit mis à jour', images_applied: 'Photos ajoutées', dismissed: 'Écarté', restored: 'Restauré',
};

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export default function ItemClient({ sourceId, itemId }: { sourceId: string; itemId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'create' | 'update'>('create');
  const [target, setTarget] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [values, setValues] = useState<Record<FieldKey, string>>({
    name: '', description: '', price: '', min_order_quantity: '1', order_quantity_step: '1', weight_grams: '', net_quantity_display: '', category_id: '',
  });
  const [apply, setApply] = useState<Record<FieldKey, boolean>>({
    name: true, description: true, price: true, min_order_quantity: true, order_quantity_step: true, weight_grams: true, net_quantity_display: true, category_id: true,
  });
  const [withImages, setWithImages] = useState(true);
  const [usePromo, setUsePromo] = useState(false);
  const [discount, setDiscount] = useState('0');
  const [rounding, setRounding] = useState<PriceRounding>('nearest');
  const [priceEdited, setPriceEdited] = useState(false);
  const [requestKey, setRequestKey] = useState(newKey);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [listSearch, setListSearch] = useState('');
  const [nav, setNav] = useState<{ prev: string | null; next: string | null; index: number; total: number } | null>(null);

  // Liste filtrée de la page source (sessionStorage) : absente si on arrive par un lien direct.
  useEffect(() => {
    const { ids, search } = readItemNavigation(sourceId);
    const index = ids.indexOf(itemId);
    setListSearch(search);
    setNav(index < 0 ? null : { prev: ids[index - 1] ?? null, next: ids[index + 1] ?? null, index, total: ids.length });
  }, [sourceId, itemId]);

  const load = useCallback(async () => {
    const res = await apiJson<Detail>(`/api/admin/platform/external-catalogs/items/${itemId}`);
    if (!res.ok) { setError(res.error); return; }
    const d = res.data;
    setDetail(d);
    const n = d.item.normalized;
    const linked = d.product;
    setMode(linked ? 'update' : 'create');
    setTarget(linked);
    setDiscount(String(d.source.default_discount_pct ?? 0));
    setPriceEdited(false);
    setValues({
      name: n.normalized_name ?? '',
      description: n.original_description ?? '',
      price: '',
      min_order_quantity: String(n.suggested_min_quantity ?? 1),
      order_quantity_step: String(n.suggested_quantity_step ?? 1),
      weight_grams: unitWeightGrams(n.unit_format)?.toString() ?? '',
      net_quantity_display: netQuantityDisplay(n.unit_format) ?? '',
      category_id: linked?.category_id ?? '',
    });
    // Mise à jour : seuls les champs différents du produit actuel sont cochés par défaut.
    if (linked) {
      setApply({
        name: (n.normalized_name ?? '') !== linked.name,
        description: (n.original_description ?? '') !== (linked.description ?? ''),
        price: true,
        min_order_quantity: (n.suggested_min_quantity ?? 1) !== linked.min_order_quantity,
        order_quantity_step: (n.suggested_quantity_step ?? 1) !== linked.order_quantity_step,
        weight_grams: false,
        net_quantity_display: false,
        category_id: false,
      });
      setWithImages(!(linked.images?.length));
    }
  }, [itemId]);

  useEffect(() => { void load(); }, [load]);

  const minQty = Number(values.min_order_quantity);
  const discountPct = Number(discount.replace(',', '.'));
  const lotPrice = detail ? lotPriceFor(detail.item.displayed_price, detail.item.sale_price, usePromo) : null;
  const pricing = useMemo(() => (
    lotPrice !== null && Number.isInteger(minQty) && minQty >= 1 && Number.isFinite(discountPct)
      ? computeUnitPrice({ lotPrice, minQuantity: minQty, discountPct, rounding })
      : null
  ), [lotPrice, minQty, discountPct, rounding]);

  useEffect(() => {
    if (!priceEdited) setValues((v) => ({ ...v, price: pricing ? pricing.unitPrice.toFixed(2) : '' }));
  }, [pricing, priceEdited]);

  async function searchProducts(q: string) {
    setSearch(q);
    const res = await apiJson<Product[]>(`/api/admin/platform/external-catalogs/${sourceId}/products?q=${encodeURIComponent(q)}`);
    if (res.ok) setResults(res.data);
  }

  async function submit() {
    if (!detail) return;
    setFormError(null);
    setNotice(null);
    if (mode === 'update' && !target) { setFormError('Choisissez le produit Lepefy à mettre à jour.'); return; }
    if (mode === 'create' && !values.category_id) { setFormError('Choisissez une catégorie pour le nouveau produit.'); return; }
    const fields: Record<string, unknown> = {};
    for (const key of Object.keys(FIELD_LABEL) as FieldKey[]) {
      const forced = mode === 'create' && (key === 'name' || key === 'price' || key === 'category_id');
      if (!apply[key] && !forced) continue;
      const raw = values[key].trim();
      if (key === 'price') {
        const normalized = raw.replace(',', '.');
        if (!/^\d{1,8}(\.\d{1,2})?$/.test(normalized) || Number(normalized) <= 0) { setFormError('Prix unitaire invalide (ex. 3,33).'); return; }
        fields.price = Number(normalized).toFixed(2);
      } else if (key === 'min_order_quantity' || key === 'order_quantity_step') {
        if (!/^\d{1,5}$/.test(raw) || Number(raw) < 1) { setFormError(`${FIELD_LABEL[key]} : entier supérieur ou égal à 1.`); return; }
        fields[key] = Number(raw);
      } else if (key === 'weight_grams') {
        if (raw && (!/^\d{1,7}$/.test(raw) || Number(raw) < 1)) { setFormError('Poids unitaire : entier en grammes.'); return; }
        fields.weight_grams = raw ? Number(raw) : null;
      } else if (key === 'name') {
        if (!raw) { setFormError('Le nom est obligatoire.'); return; }
        fields.name = raw;
      } else {
        fields[key] = raw || null;
      }
    }
    setBusy('apply');
    const res = await apiJson<{ productId: string; created: boolean; replayed: boolean; images: { attached: number; failed: Array<{ reason: string }> } }>(
      `/api/admin/platform/external-catalogs/items/${itemId}/apply`,
      { method: 'POST', body: JSON.stringify({ mode, productId: mode === 'update' ? target?.id : null, fields, images: withImages, requestKey }) },
    );
    setBusy(null);
    if (!res.ok) { setFormError(res.error); return; }
    const r = res.data;
    const imgText = withImages ? ` ${r.images.attached} photo(s) ajoutée(s)${r.images.failed.length ? `, ${r.images.failed.length} non récupérée(s) (${r.images.failed[0]?.reason ?? ''})` : ''}.` : '';
    setNotice({ tone: 'ok', text: `${r.created ? 'Produit créé (inactif, stock 0).' : 'Produit mis à jour.'}${imgText} Visible sur la boutique du tenant d’ici quelques minutes.` });
    setRequestKey(newKey());
    void load();
  }

  async function setStatus(action: 'dismiss' | 'restore') {
    setBusy(action);
    const res = await apiJson(`/api/admin/platform/external-catalogs/items/${itemId}/status`, { method: 'POST', body: JSON.stringify({ action }) });
    setBusy(null);
    if (!res.ok) { setNotice({ text: res.error, tone: 'error' }); return; }
    void load();
  }

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!detail) return <p className="text-sm text-gray-500">Chargement…</p>;

  const { item, source } = detail;
  const n = item.normalized;
  const currency = item.currency ?? 'EUR';
  const st = ITEM_STATUS[item.status];
  const preview = n.images[0]?.preview_url ?? n.images[0]?.url ?? null;
  const blockedReason = !detail.flagEnabled
    ? 'Import désactivé pour ce tenant (flag external_catalog_import).'
    : source.consent_status !== 'granted'
      ? 'Consentement du vendeur non enregistré sur la source.'
      : item.status === 'dismissed'
        ? 'Produit écarté : restaurez-le pour l’appliquer.'
        : null;
  const storefront = source.tenants?.storefront_url?.replace(/\/$/, '');
  const itemHref = (id: string) => `/admin/platform/catalogues-whatsapp/${sourceId}/${id}`;
  // Retour à la liste avec les mêmes filtres (référent même onglet uniquement).
  const backHref = `/admin/platform/catalogues-whatsapp/${sourceId}${listSearch}`;
  const current = mode === 'update' ? target : null;
  const currentValue = (key: FieldKey): string => {
    if (!current) return '—';
    if (key === 'price') return euro(current.price);
    if (key === 'category_id') return detail.categories.find((c) => c.id === current.category_id)?.name ?? '—';
    const v = current[key as keyof Product];
    return v === null || v === undefined || v === '' ? '—' : String(v);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
          <IconArrowLeft size={16} aria-hidden /> {source.label}
        </Link>
        {nav && nav.total > 1 && (
          <nav aria-label="Produits de la liste" className="flex items-center gap-1 text-sm">
            {nav.prev
              ? <Link href={itemHref(nav.prev)} className={`${SECONDARY} min-h-8 px-2.5 py-1`}><IconChevronLeft size={16} aria-hidden /> Précédent</Link>
              : <span className={`${SECONDARY} min-h-8 cursor-not-allowed px-2.5 py-1 opacity-40`} aria-disabled><IconChevronLeft size={16} aria-hidden /> Précédent</span>}
            <span className="px-2 text-xs tabular-nums text-gray-500">{nav.index + 1} / {nav.total}</span>
            {nav.next
              ? <Link href={itemHref(nav.next)} className={`${SECONDARY} min-h-8 px-2.5 py-1`}>Suivant <IconChevronRight size={16} aria-hidden /></Link>
              : <span className={`${SECONDARY} min-h-8 cursor-not-allowed px-2.5 py-1 opacity-40`} aria-disabled>Suivant <IconChevronRight size={16} aria-hidden /></span>}
          </nav>
        )}
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-gray-950 dark:text-white">{n.original_name ?? '(sans nom)'}</h1>
          <p className="mt-1 text-sm text-gray-500">vers {source.tenants?.name} ({source.tenants?.slug}) · vu le {dateTime(item.last_seen_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
          {item.status === 'dismissed'
            ? <button type="button" className={SECONDARY} onClick={() => setStatus('restore')} disabled={busy !== null}>Restaurer</button>
            : <button type="button" className={SECONDARY} onClick={() => setStatus('dismiss')} disabled={busy !== null}>Écarter</button>}
        </div>
      </header>

      {notice && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm ${notice.tone === 'ok' ? 'border border-green-200 bg-green-50 text-green-800' : 'border border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</p>
      )}

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <section className={`${CARD} space-y-3 self-start`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Source WhatsApp</p>
          {preview
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={preview} alt="" referrerPolicy="no-referrer" className="aspect-square w-full rounded-xl border border-gray-200 bg-white object-contain dark:border-gray-800" />
            : <div className="grid aspect-square place-items-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-400">Aucune photo</div>}
          <p className="text-xs text-gray-500">{n.images.length} photo(s) originale(s). Les liens WhatsApp expirent : actualisez la source si l’aperçu ne s’affiche plus.</p>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-xs text-gray-500">Description</dt><dd className="whitespace-pre-wrap">{n.original_description ?? '—'}</dd></div>
            <div><dt className="text-xs text-gray-500">Prix affiché (lot)</dt><dd className="font-semibold">{euro(item.displayed_price, currency)}
              {item.previous_price !== null && item.previous_price !== item.displayed_price && <span className="ml-2 text-xs font-normal text-red-600">était {euro(item.previous_price, currency)}</span>}
              {item.sale_price !== null && <span className="ml-2 text-xs font-normal text-gray-500">promo {euro(item.sale_price, currency)}</span>}</dd></div>
            <div><dt className="text-xs text-gray-500">Interprétation</dt><dd>
              min {n.suggested_min_quantity ?? '—'}{n.suggested_min_quantity !== null && !n.inference.min_is_explicit ? ' (inféré)' : ''} · contenu {n.package_count ?? '—'} · format {n.unit_format ? `${n.unit_format.value ?? ''} ${n.unit_format.unit}` : '—'}
            </dd></div>
            <div><dt className="text-xs text-gray-500">Disponibilité</dt><dd>{n.product_availability ?? '—'}</dd></div>
          </dl>
          <details className="text-xs text-gray-600 dark:text-gray-300">
            <summary className="cursor-pointer font-semibold">Pourquoi ces propositions</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">{n.review_reasons.map((r) => <li key={r.code + r.message}>{r.message}</li>)}</ul>
          </details>
        </section>

        <section className={`${CARD} space-y-5`}>
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Produit Lepefy</p>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" checked={mode === 'create'} onChange={() => setMode('create')} disabled={Boolean(item.linked_product_id)} /> Créer un nouveau produit</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="mode" checked={mode === 'update'} onChange={() => setMode('update')} /> Mettre à jour un produit existant</label>
          </div>

          {mode === 'update' && (
            target ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 px-4 py-3 text-sm dark:bg-gray-800/60">
                <span><strong className="font-semibold">{target.name}</strong> · {euro(target.price)} · min {target.min_order_quantity}{!target.active && ' · inactif'}</span>
                <span className="flex items-center gap-3">
                  {storefront && <a className="inline-flex items-center gap-1 text-xs text-[var(--admin-primary-fg)] hover:underline" href={`${storefront}/admin/catalogue/${target.id}`} target="_blank" rel="noreferrer">Ouvrir dans l’admin du tenant <IconExternalLink size={14} aria-hidden /></a>}
                  {!item.linked_product_id && <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => setTarget(null)}>Changer</button>}
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor="search" className={LABEL}>Rechercher le produit du tenant</label>
                <input id="search" className={INPUT} value={search} onChange={(e) => void searchProducts(e.target.value)} placeholder="Arachide…" />
                <ul className="max-h-56 divide-y divide-gray-100 overflow-auto rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {results.map((p) => (
                    <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800" onClick={() => { setTarget(p); setResults([]); }}>
                      {p.name} <span className="text-xs text-gray-500">· {euro(p.price)} · min {p.min_order_quantity}{!p.active && ' · inactif'}</span>
                    </button></li>
                  ))}
                  {results.length === 0 && <li className="px-3 py-2 text-xs text-gray-500">Tapez un nom pour rechercher.</li>}
                </ul>
              </div>
            )
          )}

          <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <p className="mb-3 text-sm font-semibold">Calcul du prix unitaire</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <span className={LABEL}>Prix de départ</span>
                <select className={INPUT} value={usePromo ? 'promo' : 'full'} onChange={(e) => setUsePromo(e.target.value === 'promo')} aria-label="Prix de départ">
                  <option value="full">Plein · {euro(item.displayed_price, currency)}</option>
                  {item.sale_price !== null && <option value="promo">Promo · {euro(item.sale_price, currency)}</option>}
                </select>
              </div>
              <div>
                <span className={LABEL}>÷ Quantité minimale</span>
                <p className="py-2 text-sm font-semibold">{Number.isInteger(minQty) && minQty >= 1 ? minQty : '—'}</p>
              </div>
              <div>
                <label htmlFor="discount" className={LABEL}>Remise (%)</label>
                <input id="discount" className={INPUT} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </div>
              <div>
                <label htmlFor="rounding" className={LABEL}>Arrondi</label>
                <select id="rounding" className={INPUT} value={rounding} onChange={(e) => setRounding(e.target.value as PriceRounding)}>
                  <option value="nearest">Au centime le plus proche</option>
                  <option value="up">Au centime supérieur</option>
                  <option value="down">Au centime inférieur</option>
                </select>
              </div>
            </div>
            <p className="mt-3 text-sm">
              {pricing
                ? <>= <strong className="font-semibold">{euro(pricing.unitPrice)}</strong> / unité · lot de {minQty} = {euro(pricing.lotTotal)}
                    {pricing.roundingDelta !== 0 && <span className="ml-1 text-amber-700 dark:text-amber-300">(écart {pricing.roundingDelta > 0 ? '+' : ''}{euro(pricing.roundingDelta)} dû à l’arrondi)</span>}</>
                : <span className="text-red-600">Calcul impossible : vérifiez le prix WhatsApp, le minimum et la remise (0 à 90 %).</span>}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-gray-500">
                <th className="w-10 pb-2 font-medium">Appl.</th><th className="pb-2 font-medium">Champ</th>
                {mode === 'update' && <th className="pb-2 font-medium">Actuel</th>}
                <th className="pb-2 font-medium">Nouvelle valeur</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {(Object.keys(FIELD_LABEL) as FieldKey[]).map((key) => {
                  const forced = mode === 'create' && (key === 'name' || key === 'price' || key === 'category_id');
                  return (
                    <tr key={key} className="align-top">
                      <td className="py-2"><input type="checkbox" aria-label={`Appliquer ${FIELD_LABEL[key]}`} checked={forced || apply[key]} disabled={forced} onChange={(e) => setApply({ ...apply, [key]: e.target.checked })} /></td>
                      <td className="py-2 pr-3 font-medium">{FIELD_LABEL[key]}</td>
                      {mode === 'update' && <td className="py-2 pr-3 text-gray-500">{currentValue(key)}</td>}
                      <td className="py-2">
                        {key === 'description' ? (
                          <textarea className={INPUT} rows={2} maxLength={4000} value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} aria-label="Description" />
                        ) : key === 'category_id' ? (
                          <select className={INPUT} value={values.category_id} onChange={(e) => setValues({ ...values, category_id: e.target.value })} aria-label="Catégorie">
                            <option value="">Choisir…</option>
                            {detail.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        ) : (
                          <div>
                            <input className={INPUT} aria-label={FIELD_LABEL[key]} value={values[key]}
                              inputMode={key === 'name' || key === 'net_quantity_display' ? 'text' : key === 'price' ? 'decimal' : 'numeric'}
                              onChange={(e) => { if (key === 'price') setPriceEdited(true); setValues({ ...values, [key]: e.target.value }); }} />
                            {key === 'price' && priceEdited && <button type="button" className="mt-1 text-xs text-[var(--admin-primary-fg)] hover:underline" onClick={() => setPriceEdited(false)}>Revenir au prix calculé</button>}
                            {key === 'min_order_quantity' && n.suggested_min_quantity === null && <p className="mt-1 text-xs text-gray-500">Aucun minimum déduit du texte : vérifiez avec le vendeur.</p>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="py-2"><input type="checkbox" aria-label="Appliquer les photos" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} /></td>
                  <td className="py-2 pr-3 font-medium">Photos</td>
                  {mode === 'update' && <td className="py-2 pr-3 text-gray-500">{current?.images?.length ?? 0} photo(s)</td>}
                  <td className="py-2 text-gray-600 dark:text-gray-300">Copier {n.images.length} photo(s) originale(s) dans le stockage du tenant (ajoutées à la galerie, 8 max).</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
            {formError && <p role="alert" className="mr-auto text-sm text-red-600">{formError}</p>}
            {!formError && blockedReason && <p className="mr-auto text-sm text-amber-700 dark:text-amber-300">{blockedReason}</p>}
            {!formError && !blockedReason && mode === 'create' && <p className="mr-auto text-xs text-gray-500">Le produit sera créé inactif, stock 0 : à activer depuis l’admin du tenant après contrôle.</p>}
            <button type="button" className={PRIMARY} onClick={submit} disabled={busy !== null || Boolean(blockedReason)}>
              {busy === 'apply' ? 'Application…' : mode === 'create' ? 'Créer le produit' : 'Appliquer les champs cochés'}
            </button>
          </div>
        </section>
      </div>

      {detail.events.length > 0 && (
        <section className={CARD}>
          <p className="mb-3 text-sm font-semibold">Historique</p>
          <ul className="space-y-2 text-sm">
            {detail.events.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-2">
                <span className="text-gray-500">{dateTime(e.created_at)}</span>
                <span className="font-medium">{EVENT_LABEL[e.action] ?? e.action}</span>
                {(e.action === 'created' || e.action === 'updated') && (
                  <span className="text-gray-500">{Object.keys(e.fields).map((k) => FIELD_LABEL[k as FieldKey] ?? k).join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-xs text-gray-500">
        <span className={`mr-2 rounded-full px-2 py-0.5 font-semibold ${(CONSENT[source.consent_status] ?? CONSENT.missing!).cls}`}>{(CONSENT[source.consent_status] ?? CONSENT.missing!).label}</span>
        Dernière application : {dateTime(item.applied_at)}
      </p>
    </div>
  );
}
