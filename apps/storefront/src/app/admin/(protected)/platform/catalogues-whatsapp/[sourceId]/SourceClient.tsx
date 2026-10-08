'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconArrowLeft, IconRefresh } from '@tabler/icons-react';
import { computeUnitPrice } from '@/lib/externalCatalog/pricing';
import type { NormalizedExternalProduct } from '@/lib/externalCatalog/types';
import { CARD, CONSENT, INPUT, ITEM_STATUS, LABEL, PRIMARY, SECONDARY, apiJson, dateTime, euro, phoneFromChatId, type ItemStatus } from '../ui';

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
  displayed_price: number | null;
  sale_price: number | null;
  currency: string | null;
  previous_price: number | null;
  status: ItemStatus;
  products: { id: string; name: string; price: number; active: boolean } | null;
}

const FILTERS: Array<{ key: ItemStatus | 'all'; label: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'new', label: 'Nouveaux' },
  { key: 'changed', label: 'Modifiés' },
  { key: 'linked', label: 'Liés' },
  { key: 'unavailable', label: 'Retirés' },
  { key: 'dismissed', label: 'Écartés' },
];

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

export default function SourceClient({ sourceId }: { sourceId: string }) {
  const [source, setSource] = useState<Source | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ItemStatus | 'all'>('all');
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

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const it of items) c[it.status] = (c[it.status] ?? 0) + 1;
    return c;
  }, [items]);

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

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!source) return <p className="text-sm text-gray-500">Chargement…</p>;

  const consent = CONSENT[source.consent_status] ?? CONSENT.missing!;
  const visible = filter === 'all' ? items : items.filter((it) => it.status === filter);
  const discount = Number(source.default_discount_pct) || 0;

  return (
    <div className="space-y-5">
      <Link href="/admin/platform/catalogues-whatsapp" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
        <IconArrowLeft size={16} aria-hidden /> Catalogues WhatsApp
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-gray-950 dark:text-white">{source.label}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {phoneFromChatId(source.seller_chat_id)} · vers <strong className="font-semibold text-gray-700 dark:text-gray-200">{source.tenants?.name}</strong> ({source.tenants?.slug}) · lu {dateTime(source.last_fetched_at)}
          </p>
        </div>
        <button type="button" className={PRIMARY} onClick={refresh} disabled={busy !== null || source.status !== 'active'}>
          <IconRefresh size={16} aria-hidden className={busy === 'refresh' ? 'animate-spin' : ''} /> {busy === 'refresh' ? 'Lecture…' : 'Actualiser'}
        </button>
      </header>

      {notice && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm ${notice.tone === 'ok' ? 'border border-green-200 bg-green-50 text-green-800' : 'border border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</p>
      )}
      {source.last_fetch_status === 'failed' && source.last_fetch_error && !notice && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Dernière lecture en échec : {source.last_fetch_error}</p>
      )}

      <section className={`${CARD} grid gap-4 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end`}>
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
        <p className="text-xs text-gray-500 sm:col-span-4">
          <span className={`mr-2 rounded-full px-2 py-0.5 font-semibold ${consent.cls}`}>{consent.label}</span>
          Sans consentement enregistré, la lecture reste possible mais l’application aux produits est bloquée.
        </p>
      </section>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrer par statut">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === f.key ? 'border-[var(--admin-primary)] bg-[var(--admin-primary)] text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300'}`}>
            {f.label} {counts[f.key] ?? 0}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className={`${CARD} text-center`}>
          <p className="text-sm font-semibold">Aucun produit lu</p>
          <p className="mt-1 text-sm text-gray-500">Cliquez sur « Actualiser » pour lire le catalogue du vendeur.</p>
        </div>
      ) : (
        <div className={`${CARD} p-0`}>
          <div className="hidden grid-cols-[2.4fr_1fr_1.2fr_1.4fr_1fr] gap-3 border-b border-gray-100 px-5 py-2 text-xs font-medium text-gray-500 sm:grid dark:border-gray-800">
            <span>Produit WhatsApp</span><span>Prix lot</span><span>Prix unitaire estimé</span><span>Produit Lepefy</span><span>Statut</span>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {visible.map((it) => {
              const n = it.normalized;
              const min = n.suggested_min_quantity ?? 1;
              const unit = it.displayed_price ? computeUnitPrice({ lotPrice: it.displayed_price, minQuantity: min, discountPct: discount, rounding: 'nearest' }) : null;
              const st = ITEM_STATUS[it.status];
              return (
                <li key={it.id}>
                  <Link href={`/admin/platform/catalogues-whatsapp/${sourceId}/${it.id}`} className="grid gap-2 px-5 py-3 text-sm hover:bg-gray-50 sm:grid-cols-[2.4fr_1fr_1.2fr_1.4fr_1fr] sm:items-center sm:gap-3 dark:hover:bg-gray-800/50">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{n.original_name ?? '(sans nom)'}</p>
                      <p className="truncate text-xs text-gray-500">{n.original_description ?? 'Sans description'}</p>
                    </div>
                    <p>
                      {euro(it.displayed_price, it.currency ?? 'EUR')}
                      {it.previous_price !== null && it.previous_price !== it.displayed_price && <span className="block text-xs text-red-600">était {euro(it.previous_price, it.currency ?? 'EUR')}</span>}
                      {it.sale_price !== null && <span className="block text-xs text-gray-500">promo {euro(it.sale_price, it.currency ?? 'EUR')}</span>}
                    </p>
                    <p>{unit ? `${euro(unit.unitPrice)} × ${min}` : '—'}{n.suggested_min_quantity === null && <span className="block text-xs text-gray-500">minimum à confirmer</span>}</p>
                    <p className="truncate">{it.products ? <>{it.products.name}{!it.products.active && <span className="ml-1 text-xs text-gray-400">(inactif)</span>}</> : <span className="text-gray-400">—</span>}</p>
                    <span className={`w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {source.last_fetch_truncated && (
        <p className="text-xs text-gray-500">La dernière lecture n’était pas complète (catalogue au-delà des 10 premiers produits lu via les collections, ou lecture interrompue) : aucun produit n’est marqué « retiré » tant que la lecture n’est pas complète.</p>
      )}
    </div>
  );
}
