'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { IconAlertTriangle, IconArrowLeft, IconChevronDown, IconPhotoOff, IconRefresh, IconSearch, IconX } from '@tabler/icons-react';
import { computeUnitPrice } from '@/lib/externalCatalog/pricing';
import type { NormalizedExternalProduct } from '@/lib/externalCatalog/types';
import { CARD, CONSENT, INPUT, ITEM_STATUS, LABEL, PRIMARY, SECONDARY, apiJson, dateTime, euro, phoneFromChatId, saveItemNavigation, type ItemStatus } from '../ui';

interface Source {
  id: string;
  tenant_id: string;
  label: string;
  source_url: string;
  seller_chat_id: string;
  default_discount_pct: number;
  consent_status: string;
  consent_note: string | null;
  consent_recorded_at: string | null;
  status: string;
  last_fetched_at: string | null;
  last_fetch_status: string | null;
  last_fetch_error: string | null;
  last_fetch_truncated: boolean;
  tenants: { slug: string; name: string } | null;
}

interface Item {
  id: string;
  normalized: NormalizedExternalProduct;
  collections: Array<{ id: string; name: string | null }> | null;
  displayed_price: number | null;
  sale_price: number | null;
  currency: string | null;
  previous_price: number | null;
  status: ItemStatus;
  products: { id: string; name: string; price: number; active: boolean } | null;
}

type StatusFilter = ItemStatus | 'all' | 'todo';

const FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'todo', label: 'À traiter' },
  { key: 'new', label: 'Nouveaux' },
  { key: 'changed', label: 'Modifiés' },
  { key: 'linked', label: 'Liés' },
  { key: 'unavailable', label: 'Retirés' },
  { key: 'dismissed', label: 'Écartés' },
];

type SortKey = 'catalog' | 'name' | 'price_asc' | 'price_desc';

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'catalog', label: 'Ordre du catalogue' },
  { key: 'name', label: 'Nom (A → Z)' },
  { key: 'price_asc', label: 'Prix croissant' },
  { key: 'price_desc', label: 'Prix décroissant' },
];

/** Valeur du filtre collection pour les produits rattachés à aucune collection. */
const NO_COLLECTION = '_none';

interface RefreshStep {
  done: boolean;
  resume: unknown;
  startedAt: string;
  progress: { collectionIndex: number; collections: number };
  received: number; new: number; changed: number; unchanged: number; unavailable: number;
  completeness: 'complete' | 'partial' | 'truncated';
  stats: { stopReason: string | null } | null;
  totals: { unique: number; outsideCollections: number } | null;
  message: string | null;
}

/** Une lecture = plusieurs blocs d’au plus 40 s ; garde-fou côté navigateur. */
const MAX_REFRESH_STEPS = 30;

function refreshSummary(acc: { new: number; changed: number; unavailable: number; steps: number }, last: RefreshStep): string {
  const unique = last.totals?.unique;
  const base = `${unique ?? '?'} produit(s) uniques lus en ${acc.steps} bloc(s) : ${acc.new} nouveau(x), ${acc.changed} modifié(s), ${acc.unavailable} retiré(s).`;
  if (last.completeness === 'complete') return `${base} Lecture complète.`;
  if (last.completeness === 'partial') {
    const outside = last.totals?.outsideCollections ?? 0;
    return `${base} Lecture partielle : toutes les collections ont été lues ; ${outside} produit(s) ne sont dans aucune collection et d’autres produits hors collection peuvent exister au-delà des 10 premiers (non lisibles via GREEN-API). Aucun produit n’est marqué « retiré ».`;
  }
  const why = last.message ?? last.stats?.stopReason ?? null;
  return `${base} Lecture interrompue${why ? ` : ${why}` : ''}. Relancez « Actualiser » plus tard. Aucun produit n’est marqué « retiré ».`;
}

function matchesStatus(it: Item, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'todo') return it.status === 'new' || it.status === 'changed';
  return it.status === filter;
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function parseParam<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

/** Miniature WhatsApp : lien signé qui expire, d’où le repli sans erreur. */
function Thumb({ item }: { item: Item }) {
  const [failed, setFailed] = useState(false);
  const img = item.normalized.images[0];
  const src = img?.preview_url ?? img?.url ?? null;
  if (!src || failed) {
    return (
      <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-dashed border-a-border text-a-text-3">
        <IconPhotoOff size={18} aria-hidden />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}
      className="size-12 shrink-0 rounded-lg border border-a-border bg-a-surface object-cover" />
  );
}

function QuantityHint({ n }: { n: NormalizedExternalProduct }) {
  if (n.suggested_min_quantity === null) {
    return <span className="block text-xs text-tone-warning-fg">minimum à confirmer</span>;
  }
  if (!n.inference.min_is_explicit) {
    return <span className="block text-xs text-a-text-3">minimum déduit, à vérifier</span>;
  }
  return null;
}

function Stat({ label, value, hint, onClick, active }: { label: string; value: number | string; hint?: string; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <span className="block text-xs font-medium text-a-text-3">{label}</span>
      <span className="mt-1 block text-2xl font-semibold text-a-text">{value}</span>
      {hint && <span className="mt-0.5 block text-xs text-a-text-3">{hint}</span>}
    </>
  );
  const cls = `rounded-2xl border bg-a-surface p-4 text-left ${active ? 'border-a-brand ring-1 ring-a-focus' : 'border-a-border'}`;
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} hover:bg-a-surface-2`}>{body}</button>
    : <div className={cls}>{body}</div>;
}

export default function SourceClient({ sourceId }: { sourceId: string }) {
  const params = useSearchParams();
  const [source, setSource] = useState<Source | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>(() => parseParam(params.get('statut'), FILTERS.map((f) => f.key), 'all'));
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const [collection, setCollection] = useState(() => params.get('collection') ?? '');
  const [sort, setSort] = useState<SortKey>(() => parseParam(params.get('tri'), SORTS.map((s) => s.key), 'catalog'));
  const [reviewOnly, setReviewOnly] = useState(() => params.get('verifier') === '1');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [settings, setSettings] = useState({ discountPct: '0', consentStatus: 'missing', consentNote: '' });

  const load = useCallback(async () => {
    const res = await apiJson<{ source: Source; items: Item[] }>(`/api/admin/platform/external-catalogs/${sourceId}`);
    if (!res.ok) { setError(res.error); return; }
    setError(null);
    setSource(res.data.source);
    setItems(res.data.items);
    setSettings({
      discountPct: String(res.data.source.default_discount_pct),
      consentStatus: res.data.source.consent_status,
      consentNote: res.data.source.consent_note ?? '',
    });
  }, [sourceId]);

  useEffect(() => { void load(); }, [load]);

  // Filtres dans l’URL : le retour depuis une fiche produit retrouve la même vue.
  useEffect(() => {
    const next = new URLSearchParams();
    if (filter !== 'all') next.set('statut', filter);
    if (query.trim()) next.set('q', query.trim());
    if (collection) next.set('collection', collection);
    if (sort !== 'catalog') next.set('tri', sort);
    if (reviewOnly) next.set('verifier', '1');
    const qs = next.toString();
    // history.replaceState (Next ≥ 14.1) : pas de nouveau rendu serveur à chaque frappe.
    if (qs !== window.location.search.replace(/^\?/, '')) {
      window.history.replaceState(window.history.state, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    }
  }, [filter, query, collection, sort, reviewOnly]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length, todo: 0, review: 0 };
    for (const it of items) {
      c[it.status] = (c[it.status] ?? 0) + 1;
      if (it.status === 'new' || it.status === 'changed') c.todo!++;
      if (it.normalized.requires_review && it.status !== 'dismissed') c.review!++;
    }
    return c;
  }, [items]);

  const collections = useMemo(() => {
    const byId = new Map<string, { name: string; count: number }>();
    let none = 0;
    for (const it of items) {
      const list = it.collections ?? [];
      if (list.length === 0) none++;
      for (const c of list) {
        const entry = byId.get(c.id) ?? { name: c.name?.trim() || `Collection ${c.id}`, count: 0 };
        entry.count++;
        byId.set(c.id, entry);
      }
    }
    const options = [...byId.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return { options, none };
  }, [items]);

  const visible = useMemo(() => {
    const q = normalizeText(query.trim());
    const list = items.filter((it) => {
      if (!matchesStatus(it, filter)) return false;
      if (reviewOnly && !it.normalized.requires_review) return false;
      if (collection === NO_COLLECTION ? (it.collections ?? []).length > 0 : collection && !(it.collections ?? []).some((c) => c.id === collection)) return false;
      if (!q) return true;
      const hay = normalizeText(`${it.normalized.original_name ?? ''} ${it.normalized.original_description ?? ''} ${it.products?.name ?? ''}`);
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
    if (sort === 'name') list.sort((a, b) => (a.normalized.original_name ?? '').localeCompare(b.normalized.original_name ?? '', 'fr'));
    if (sort === 'price_asc' || sort === 'price_desc') {
      const dir = sort === 'price_asc' ? 1 : -1;
      // Produits sans prix toujours en fin de liste.
      list.sort((a, b) => (a.displayed_price === null ? 1 : b.displayed_price === null ? -1 : (Number(a.displayed_price) - Number(b.displayed_price)) * dir));
    }
    return list;
  }, [items, filter, reviewOnly, collection, query, sort]);

  useEffect(() => {
    saveItemNavigation(sourceId, { ids: visible.map((it) => it.id), search: window.location.search });
  }, [sourceId, visible, filter, query, collection, sort, reviewOnly]);

  const hasFilters = filter !== 'all' || query.trim() !== '' || collection !== '' || reviewOnly;
  function resetFilters() {
    setFilter('all');
    setQuery('');
    setCollection('');
    setReviewOnly(false);
  }

  async function refresh() {
    setBusy('refresh');
    setNotice(null);
    const acc = { new: 0, changed: 0, unavailable: 0, steps: 0 };
    let resume: unknown = null;
    let startedAt: string | null = null;
    let last: RefreshStep | null = null;
    while (acc.steps < MAX_REFRESH_STEPS) {
      const res: Awaited<ReturnType<typeof apiJson<RefreshStep>>> = await apiJson<RefreshStep>(`/api/admin/platform/external-catalogs/${sourceId}/refresh`, {
        method: 'POST',
        body: JSON.stringify(resume ? { resume, startedAt } : {}),
      });
      if (!res.ok) {
        const partial = acc.steps > 0 ? ` (${acc.steps} bloc(s) déjà enregistré(s), ${acc.new} nouveau(x))` : '';
        setNotice({ text: `${res.error}${partial}`, tone: 'error' });
        break;
      }
      const step: RefreshStep = res.data;
      last = step;
      acc.steps++;
      acc.new += step.new;
      acc.changed += step.changed;
      acc.unavailable += step.unavailable;
      if (step.done) break;
      resume = step.resume;
      startedAt = step.startedAt;
      setNotice({
        tone: 'ok',
        text: `Lecture en cours… bloc ${acc.steps} enregistré (${acc.new} nouveau(x) jusqu’ici), collection ${Math.min(step.progress.collectionIndex + 1, step.progress.collections)}/${step.progress.collections || '?'}.`,
      });
      void load();
    }
    if (last?.done) setNotice({ tone: last.completeness === 'truncated' ? 'error' : 'ok', text: refreshSummary(acc, last) });
    setBusy(null);
    void load();
  }

  async function saveSettings() {
    const discount = Number(settings.discountPct.replace(',', '.'));
    if (!Number.isFinite(discount) || discount < 0 || discount > 90) { setNotice({ text: 'Remise entre 0 et 90 %.', tone: 'error' }); return; }
    const body: Record<string, unknown> = { discountPct: Math.round(discount * 100) / 100 };
    if (settings.consentStatus !== source?.consent_status || settings.consentNote !== (source?.consent_note ?? '')) {
      body.consentStatus = settings.consentStatus;
      body.consentNote = settings.consentNote.trim() || null;
    }
    setBusy('settings');
    const res = await apiJson(`/api/admin/platform/external-catalogs/${sourceId}`, { method: 'PATCH', body: JSON.stringify(body) });
    setBusy(null);
    setNotice(res.ok ? { text: 'Réglages enregistrés.', tone: 'ok' } : { text: res.error, tone: 'error' });
    if (res.ok) void load();
  }

  if (error) return <p className="rounded-xl border border-tone-danger-border bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">{error}</p>;
  if (!source) return <p className="text-sm text-a-text-3">Chargement…</p>;

  const consent = CONSENT[source.consent_status] ?? CONSENT.missing!;
  const discount = Number(source.default_discount_pct) || 0;

  return (
    <div className="space-y-5">
      <Link href="/admin/platform/catalogues-whatsapp" className="inline-flex items-center gap-1 text-sm text-a-text-3 hover:text-a-text">
        <IconArrowLeft size={16} aria-hidden /> Catalogues WhatsApp
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-a-text">{source.label}</h1>
          <p className="mt-1 text-sm text-a-text-3">
            {phoneFromChatId(source.seller_chat_id)} · vers <strong className="font-semibold text-a-text-2">{source.tenants?.name}</strong> ({source.tenants?.slug})
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button type="button" className={PRIMARY} onClick={refresh} disabled={busy !== null || source.status !== 'active'}>
            <IconRefresh size={16} aria-hidden className={busy === 'refresh' ? 'animate-spin' : ''} /> {busy === 'refresh' ? 'Lecture…' : 'Actualiser'}
          </button>
          <span className="text-xs text-a-text-3">
            Dernière lecture : {dateTime(source.last_fetched_at)}{source.last_fetched_at && (source.last_fetch_truncated ? ' · partielle' : ' · complète')}
          </span>
        </div>
      </header>

      {notice && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm ${notice.tone === 'ok' ? 'border border-tone-success-border bg-tone-success-bg text-tone-success-fg' : 'border border-tone-danger-border bg-tone-danger-bg text-tone-danger-fg'}`}>{notice.text}</p>
      )}
      {source.last_fetch_status === 'failed' && source.last_fetch_error && !notice && (
        <p className="rounded-xl border border-tone-danger-border bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg">Dernière lecture en échec : {source.last_fetch_error}</p>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Produits lus" value={counts.all ?? 0} hint={`${collections.options.length} collection(s)`} onClick={resetFilters} active={!hasFilters} />
        <Stat label="À traiter" value={counts.todo ?? 0} hint="nouveaux ou modifiés" onClick={() => { setFilter('todo'); setReviewOnly(false); }} active={filter === 'todo' && !reviewOnly} />
        <Stat label="À vérifier" value={counts.review ?? 0} hint="quantité ou prix incertain" onClick={() => { setReviewOnly(true); setFilter('all'); }} active={reviewOnly && filter === 'all'} />
        <Stat label="Liés à Lepefy" value={counts.linked ?? 0} hint={`sur ${counts.all ?? 0}`} onClick={() => { setFilter('linked'); setReviewOnly(false); }} active={filter === 'linked' && !reviewOnly} />
      </section>

      <details className={`${CARD} group p-0`} open={source.consent_status !== 'granted'}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm [&::-webkit-details-marker]:hidden">
          <span className="font-semibold text-a-text">Réglages de la source</span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-a-text-3">
            Remise par défaut {discount.toLocaleString('fr-FR')} %
            <span className={`rounded-full px-2 py-0.5 font-semibold ${consent.cls}`}>{consent.label}</span>
            <IconChevronDown size={16} aria-hidden className="transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="grid gap-4 border-t border-a-border px-5 py-4 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
          <div>
            <label htmlFor="discount" className={LABEL}>Remise par défaut (%)</label>
            <input id="discount" className={INPUT} inputMode="decimal" value={settings.discountPct} onChange={(e) => setSettings({ ...settings, discountPct: e.target.value })} />
          </div>
          <div>
            <label htmlFor="consent" className={LABEL}>Consentement du vendeur</label>
            <select id="consent" className={INPUT} value={settings.consentStatus} onChange={(e) => setSettings({ ...settings, consentStatus: e.target.value })}>
              <option value="missing">Manquant</option>
              <option value="granted">Enregistré</option>
              <option value="revoked">Retiré</option>
            </select>
          </div>
          <div>
            <label htmlFor="consent-note" className={LABEL}>Preuve du consentement (qui, quand, comment)</label>
            <input id="consent-note" className={INPUT} maxLength={2000} value={settings.consentNote} onChange={(e) => setSettings({ ...settings, consentNote: e.target.value })} placeholder="Accord écrit WhatsApp du 08/10/2026 pour textes et photos" />
          </div>
          <button type="button" className={SECONDARY} onClick={saveSettings} disabled={busy !== null}>Enregistrer</button>
          <p className="text-xs text-a-text-3 sm:col-span-4">
            La remise sert au calcul du prix unitaire estimé ci-dessous. Sans consentement enregistré, la lecture reste possible mais l’application aux produits est bloquée.
          </p>
        </div>
      </details>

      {items.length === 0 ? (
        <div className={`${CARD} text-center`}>
          <p className="text-sm font-semibold">Aucun produit lu</p>
          <p className="mt-1 text-sm text-a-text-3">Cliquez sur « Actualiser » pour lire le catalogue du vendeur.</p>
        </div>
      ) : (
        <section className={`${CARD} p-0`}>
          <div className="space-y-3 border-b border-a-border px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
              <div className="relative">
                <label htmlFor="search" className="sr-only">Rechercher</label>
                <IconSearch size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
                <input id="search" type="search" className={`${INPUT} pl-9`} placeholder="Rechercher un produit (nom, description, produit Lepefy)" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div>
                <label htmlFor="collection" className="sr-only">Collection</label>
                <select id="collection" className={INPUT} value={collection} onChange={(e) => setCollection(e.target.value)}>
                  <option value="">Toutes les collections</option>
                  {collections.options.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.count})</option>)}
                  {collections.none > 0 && <option value={NO_COLLECTION}>Hors collection ({collections.none})</option>}
                </select>
              </div>
              <div>
                <label htmlFor="sort" className="sr-only">Trier</label>
                <select id="sort" className={INPUT} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par statut">
                {FILTERS.map((f) => (
                  <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === f.key ? 'border-a-brand bg-a-brand text-a-on-brand' : 'border-a-border text-a-text-2 hover:bg-a-surface-2'}`}>
                    {f.label} {counts[f.key] ?? 0}
                  </button>
                ))}
              </div>
              <label className="ml-auto inline-flex items-center gap-2 text-xs font-medium text-a-text-2">
                <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} className="size-4 rounded border-a-border-strong" />
                À vérifier seulement
              </label>
            </div>
            <p className="flex flex-wrap items-center gap-2 text-xs text-a-text-3" aria-live="polite">
              {visible.length} produit(s) affiché(s) sur {items.length}
              {hasFilters && (
                <button type="button" onClick={resetFilters} className="inline-flex items-center gap-0.5 font-semibold text-a-brand-fg hover:underline">
                  <IconX size={12} aria-hidden /> Effacer les filtres
                </button>
              )}
            </p>
          </div>

          {visible.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-semibold">Aucun produit ne correspond</p>
              <button type="button" onClick={resetFilters} className={`${SECONDARY} mt-3`}>Effacer les filtres</button>
            </div>
          ) : (
            <>
              <div className="hidden grid-cols-[3fr_1fr_1.3fr_1.5fr_0.9fr] gap-3 border-b border-a-border px-5 py-2 text-xs font-medium text-a-text-3 md:grid">
                <span>Produit WhatsApp</span><span>Prix du lot</span><span>Prix unitaire estimé</span><span>Produit Lepefy</span><span>Statut</span>
              </div>
              <ul className="divide-y divide-a-border">
                {visible.map((it) => {
                  const n = it.normalized;
                  const min = n.suggested_min_quantity ?? 1;
                  const unit = it.displayed_price ? computeUnitPrice({ lotPrice: it.displayed_price, minQuantity: min, discountPct: discount, rounding: 'nearest' }) : null;
                  const st = ITEM_STATUS[it.status];
                  const currency = it.currency ?? 'EUR';
                  const cols = it.collections ?? [];
                  return (
                    <li key={it.id}>
                      <Link href={`/admin/platform/catalogues-whatsapp/${sourceId}/${it.id}`}
                        className={`grid gap-x-3 gap-y-2 px-5 py-3 text-sm hover:bg-a-surface-2 md:grid-cols-[3fr_1fr_1.3fr_1.5fr_0.9fr] md:items-center ${it.status === 'dismissed' || it.status === 'unavailable' ? 'opacity-60' : ''}`}>
                        <div className="flex min-w-0 items-center gap-3">
                          <Thumb item={it} />
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 font-semibold">
                              <span className="truncate">{n.original_name ?? '(sans nom)'}</span>
                              {n.requires_review && it.status !== 'dismissed' && (
                                <IconAlertTriangle size={14} className="shrink-0 text-tone-warning-fg" aria-label="À vérifier" />
                              )}
                            </p>
                            <p className="truncate text-xs text-a-text-3">{n.original_description ?? 'Sans description'}</p>
                            {cols.length > 0 && (
                              <p className="mt-1 flex flex-wrap gap-1">
                                {cols.slice(0, 2).map((c) => (
                                  <span key={c.id} className="rounded bg-a-hover px-1.5 py-0.5 text-xs text-a-text-2">{c.name?.trim() || `Collection ${c.id}`}</span>
                                ))}
                                {cols.length > 2 && <span className="text-xs text-a-text-3">+{cols.length - 2}</span>}
                              </p>
                            )}
                          </div>
                        </div>
                        <p className="pl-[3.75rem] md:pl-0">
                          <span className="text-xs text-a-text-3 md:hidden">Lot : </span>
                          {euro(it.displayed_price, currency)}
                          {it.previous_price !== null && it.previous_price !== it.displayed_price && <span className="block text-xs text-tone-danger-fg">était {euro(it.previous_price, currency)}</span>}
                          {it.sale_price !== null && <span className="block text-xs text-a-text-3">promo {euro(it.sale_price, currency)}</span>}
                        </p>
                        <p className="pl-[3.75rem] md:pl-0">
                          <span className="text-xs text-a-text-3 md:hidden">Unitaire : </span>
                          {unit ? <><strong className="font-semibold">{euro(unit.unitPrice)}</strong> <span className="text-xs text-a-text-3">× {min} min.</span></> : '—'}
                          <QuantityHint n={n} />
                        </p>
                        <p className="truncate pl-[3.75rem] md:pl-0">
                          {it.products
                            ? <>{it.products.name}<span className="block text-xs text-a-text-3">{euro(it.products.price)}{!it.products.active && ' · inactif'}</span></>
                            : <span className="text-a-text-3">Non lié</span>}
                        </p>
                        <span className={`ml-[3.75rem] w-fit rounded-full px-2 py-0.5 text-xs font-semibold md:ml-0 ${st.cls}`}>{st.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}
      {source.last_fetch_truncated && (
        <p className="text-xs text-a-text-3">La dernière lecture n’était pas complète (catalogue au-delà des 10 premiers produits lu via les collections, ou lecture interrompue) : aucun produit n’est marqué « retiré » tant que la lecture n’est pas complète.</p>
      )}
    </div>
  );
}
