'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import Badge from '../../../_components/ui/Badge';
import Button, { IconButton } from '../../../_components/ui/Button';
import InlineAlert, { ErrorText } from '../../../_components/ui/InlineAlert';
import HelpHint from '../../../_components/help/HelpHint';
import { controlClasses, hintClasses, labelClasses } from '@/app/admin/_components/ui/Form';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';
import { formatPrice } from '@/lib/utils/format';
import { buildSaleFormatOptions, formatSavings } from '@/lib/catalog/saleFormats';
import { MAX_SALE_FORMATS, saleFormatWarnings } from '@/lib/catalog/saleFormatsAdmin';
import type { AdminSaleFormatsResponse } from '@/app/api/admin/catalogue/[id]/formats/route';

interface Props {
  productId: string;
  currency: string;
  canManage: boolean;
}

interface DraftFormat {
  key: string;
  id: string | null;
  label: string;
  units: string;
  price: string;
  weight: string;
  active: boolean;
  stockMode: 'shared' | 'own';
  /** Promotion en cours : le prix se change depuis la fiche du format. */
  priceLocked: boolean;
  stock: number;
}

const SECTION_CLS = 'bg-a-surface rounded-xl border border-a-border p-5';

function money(raw: string): number {
  const value = Number(raw.replace(',', '.').trim());
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
}

function toDraft(row: AdminSaleFormatsResponse['formats'][number]): DraftFormat {
  return {
    key: row.id,
    id: row.id,
    label: row.format_label ?? '',
    units: String(row.units_per_sale),
    price: String(row.price).replace('.', ','),
    weight: row.weight_grams == null ? '' : String(row.weight_grams),
    active: row.active,
    stockMode: row.format_stock_mode,
    priceLocked: row.promo_applied || row.promo_price != null || row.compare_at_price != null,
    stock: row.stock,
  };
}

/**
 * « Formats de vente » (migration 187) : plusieurs formats sous une seule
 * fiche (« 1 paquet », « Lot de 3 paquets »). Le stock reste celui de la fiche,
 * en unités de base ; un format partagé ne se modifie jamais à part. Les
 * minimums et groupes contradictoires sont signalés, jamais corrigés à la
 * place de l'admin. Écriture atomique (liste complète) via PUT …/formats.
 */
export default function ProductSaleFormatsSection({ productId, currency, canManage }: Props) {
  const [data, setData] = useState<AdminSaleFormatsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseLabel, setBaseLabel] = useState('');
  const [drafts, setDrafts] = useState<DraftFormat[]>([]);
  const { run, pending, error } = useAdminMutation();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch(`/api/admin/catalogue/${productId}/formats`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({})) as AdminSaleFormatsResponse & { error?: string };
      if (!response.ok) { setLoadError(json.error ?? 'Impossible de charger les formats.'); return; }
      setData(json);
      setBaseLabel(json.base.format_label ?? '');
      setDrafts(json.formats.map(toDraft));
    } catch {
      setLoadError('Connexion impossible. Vérifiez le réseau puis réessayez.');
    }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  const basePrice = Number(data?.base.price ?? 0);
  const baseStock = Number(data?.base.stock ?? 0);
  const parsed = drafts.map((draft) => ({
    draft,
    units: Number.parseInt(draft.units, 10),
    price: money(draft.price),
    weight: draft.weight.trim() === '' ? null : Number.parseInt(draft.weight, 10),
  }));
  const liveWarnings = useMemo(() => data ? saleFormatWarnings({
    base: data.base,
    basePrice,
    groups: data.groups,
    formats: parsed.filter((row) => Number.isInteger(row.units) && row.units > 1 && Number.isFinite(row.price)).map((row) => ({
      label: row.draft.label || 'Format sans nom', units_per_sale: row.units, weight_grams: row.weight, active: row.draft.active, price: row.price,
    })),
  }) : [], [data, basePrice, parsed]);
  const preview = data ? buildSaleFormatOptions({
    ...data.base,
    formats: parsed.filter((row) => row.draft.active && Number.isInteger(row.units) && row.units > 1 && Number.isFinite(row.price) && row.draft.label.trim())
      .map((row, index) => ({
        id: row.draft.key, price: row.price, stock: row.draft.stockMode === 'own' ? row.draft.stock : null, active: true,
        units_per_sale: row.units, format_label: row.draft.label.trim(), format_position: index + 1, format_stock_mode: row.draft.stockMode,
        format_parent_id: data.base.id,
      })),
    format_label: baseLabel.trim() || '1 article',
  }) : [];

  function update(key: string, patch: Partial<DraftFormat>) {
    setDrafts((list) => list.map((draft) => draft.key === key ? { ...draft, ...patch } : draft));
  }
  function move(index: number, delta: -1 | 1) {
    setDrafts((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }
  function addFormat() {
    if (drafts.length >= MAX_SALE_FORMATS) return;
    setDrafts((list) => [...list, {
      key: `new-${Date.now()}`, id: null, label: '', units: '3', price: '', weight: '', active: true, stockMode: 'shared', priceLocked: false, stock: 0,
    }]);
    if (!baseLabel.trim()) setBaseLabel('1 article');
  }

  async function save() {
    const result = await run<AdminSaleFormatsResponse>(`/api/admin/catalogue/${productId}/formats`, {
      method: 'PUT',
      body: {
        baseLabel: baseLabel.trim(),
        formats: parsed.map((row) => ({
          id: row.draft.id,
          label: row.draft.label.trim(),
          units_per_sale: row.units,
          price: row.price,
          weight_grams: row.weight,
          active: row.draft.active,
          stock_mode: row.draft.stockMode,
        })),
      },
      successMessage: 'Formats enregistrés',
    });
    if (result && 'base' in result) {
      setData(result);
      setBaseLabel(result.base.format_label ?? '');
      setDrafts(result.formats.map(toDraft));
    }
  }

  const activeCount = drafts.filter((draft) => draft.active).length;

  return (
    <section className={SECTION_CLS} aria-labelledby="product-sale-formats-title">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 id="product-sale-formats-title" className="text-sm font-semibold text-a-text-2">Formats de vente</h2>
        <HelpHint slug="formats-de-vente" label="Formats de vente" />
        {activeCount > 0 && <Badge tone="success">{activeCount + 1} formats en vente</Badge>}
      </div>

      {loadError && <InlineAlert tone="danger" action={<Button size="sm" variant="secondary" onClick={() => void load()}>Réessayer</Button>}>{loadError}</InlineAlert>}
      {!data && !loadError && <p className="text-sm text-a-text-3" role="status">Chargement…</p>}

      {data && (
        <div className="grid gap-4">
          <p className="text-sm text-a-text-2">
            Vendez ce produit à l’unité et en lots sous une seule fiche. Le stock reste celui de la fiche :{' '}
            <span className="font-semibold text-a-text tabular-nums">{baseStock}</span> unités de base.
          </p>

          <div className="max-w-sm">
            <label htmlFor="sale-format-base-label" className={labelClasses}>Nom du format de base</label>
            <input id="sale-format-base-label" className={controlClasses} value={baseLabel} maxLength={60}
              placeholder="1 paquet" disabled={!canManage} onChange={(event) => setBaseLabel(event.target.value)} />
            <p className={hintClasses}>
              {formatPrice(basePrice, currency)} · 1 unité · stock {baseStock} · minimum {data.base.min_order_quantity}
            </p>
          </div>

          {drafts.length > 0 && (
            <ul className="grid gap-3" aria-label="Formats supplémentaires">
              {parsed.map((row, index) => {
                const { draft } = row;
                const savings = Number.isFinite(row.price) && Number.isInteger(row.units) ? formatSavings(basePrice, row.units, row.price) : 0;
                const derivedStock = draft.stockMode === 'shared' && Number.isInteger(row.units) && row.units > 0 ? Math.floor(Math.max(0, baseStock) / row.units) : draft.stock;
                return (
                  <li key={draft.key} className="rounded-lg border border-a-border p-3">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
                      <div>
                        <label htmlFor={`fmt-label-${draft.key}`} className={labelClasses}>Nom du format</label>
                        <input id={`fmt-label-${draft.key}`} className={controlClasses} value={draft.label} maxLength={60}
                          placeholder="Lot de 3 paquets" disabled={!canManage} onChange={(event) => update(draft.key, { label: event.target.value })} />
                      </div>
                      <div>
                        <label htmlFor={`fmt-units-${draft.key}`} className={labelClasses}>Unités par vente</label>
                        <input id={`fmt-units-${draft.key}`} className={controlClasses} type="number" min={2} max={999} inputMode="numeric"
                          value={draft.units} disabled={!canManage} onChange={(event) => update(draft.key, { units: event.target.value })} />
                      </div>
                      <div>
                        <label htmlFor={`fmt-price-${draft.key}`} className={labelClasses}>Prix du format</label>
                        <input id={`fmt-price-${draft.key}`} className={controlClasses} inputMode="decimal" value={draft.price}
                          disabled={!canManage || draft.priceLocked} onChange={(event) => update(draft.key, { price: event.target.value })} />
                        <p className={hintClasses}>
                          {draft.priceLocked
                            ? 'En promotion : modifiez le prix dans la fiche du format.'
                            : Number.isFinite(row.price) && row.units > 1
                              ? `${formatPrice(row.price / row.units, currency)} l’unité${savings > 0 ? ` · −${formatPrice(savings, currency)}` : ' · aucune économie'}`
                              : 'Prix total du format.'}
                        </p>
                      </div>
                      <div>
                        <label htmlFor={`fmt-weight-${draft.key}`} className={labelClasses}>Poids du format (g)</label>
                        <input id={`fmt-weight-${draft.key}`} className={controlClasses} type="number" min={0} inputMode="numeric"
                          value={draft.weight} disabled={!canManage} onChange={(event) => update(draft.key, { weight: event.target.value })} />
                        <p className={hintClasses}>Ensemble emballé : sert à la livraison.</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-a-text">
                        <input type="checkbox" checked={draft.active} disabled={!canManage} onChange={(event) => update(draft.key, { active: event.target.checked })} />
                        En vente
                      </label>
                      <label className="flex min-h-11 items-center gap-2 text-sm text-a-text-2">
                        <span>Stock</span>
                        <select className={`${controlClasses} w-auto`} value={draft.stockMode} disabled={!canManage || Boolean(draft.id)}
                          onChange={(event) => update(draft.key, { stockMode: event.target.value === 'own' ? 'own' : 'shared' })}>
                          <option value="shared">Partagé avec la fiche</option>
                          <option value="own">Cartons séparés</option>
                        </select>
                      </label>
                      <span className="text-sm text-a-text-3 tabular-nums">
                        {draft.stockMode === 'shared' ? `${derivedStock} disponibles (calculé)` : `${draft.stock} en stock propre`}
                      </span>
                      {draft.id && <Link href={`/admin/catalogue/${draft.id}`} prefetch={false} className="text-sm font-semibold text-a-brand-fg underline-offset-2 hover:underline">Fiche du format</Link>}
                      <span className="ml-auto flex items-center gap-1">
                        <IconButton label="Monter" icon={<IconArrowUp size={16} />} disabled={!canManage || index === 0} onClick={() => move(index, -1)} />
                        <IconButton label="Descendre" icon={<IconArrowDown size={16} />} disabled={!canManage || index === drafts.length - 1} onClick={() => move(index, 1)} />
                        {!draft.id && <IconButton label="Retirer ce format" icon={<IconTrash size={16} />} disabled={!canManage} onClick={() => setDrafts((list) => list.filter((entry) => entry.key !== draft.key))} />}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={addFormat} disabled={drafts.length >= MAX_SALE_FORMATS}>
                <IconPlus size={16} aria-hidden="true" /> Ajouter un format
              </Button>
              <Button onClick={() => void save()} loading={pending}>Enregistrer les formats</Button>
            </div>
          )}
          <ErrorText message={error} />

          {liveWarnings.length > 0 && (
            <InlineAlert tone="warning" title="À vérifier avant d’enregistrer">
              <ul className="list-disc space-y-1 pl-4">{liveWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </InlineAlert>
          )}

          {preview.length > 0 && (
            <div className="rounded-lg border border-dashed border-a-border p-3">
              <p className="mb-2 text-sm font-semibold text-a-text-2">Aperçu client</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {preview.map((option) => (
                  <li key={option.id} className="flex items-center justify-between gap-3 rounded-lg border border-a-border bg-a-surface px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block font-semibold text-a-text">{option.label}</span>
                      <span className="block text-xs text-a-text-3">
                        {option.unitPrice != null ? `${formatPrice(option.unitPrice, currency)} l’unité` : '1 unité'}
                        {option.savings > 0 ? ` · Économisez ${formatPrice(option.savings, currency)}` : ''}
                        {!option.purchasable ? ' · épuisé' : ''}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums text-a-text">{formatPrice(option.price, currency)}</span>
                  </li>
                ))}
              </ul>
              <p className={hintClasses}>Aucun format n’est présélectionné pour le client. Retirer un format le met hors vente : les commandes passées restent intactes.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
