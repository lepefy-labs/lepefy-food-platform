'use client';

import { useEffect, useMemo, useState } from 'react';
import Badge from '@/app/admin/_components/ui/Badge';
import { Drawer } from '@/app/admin/_components/ui/Dialog';
import Link from 'next/link';
import { IconAlertTriangle, IconChevronLeft, IconChevronRight, IconInfoCircle, IconListSearch, IconRefresh, IconSearch, IconStethoscope } from '@tabler/icons-react';
import type {
  PacklinkListDiagnostics,
  PacklinkListedShipment,
  PacklinkListResult,
} from '@/lib/shipping/packlinkShipmentList';

type LinkFilter = 'all' | 'linked' | 'unlinked';

const INPUT_CLS =
  'w-full rounded-xl border border-a-border bg-a-surface px-3.5 py-2.5 text-sm text-a-text outline-none transition focus:border-transparent focus:ring-2 focus:ring-a-focus';

const DASH = '—';

function formatDate(value: string | null): string {
  if (!value) return DASH;
  const parsed = new Date(value.replace(/\//g, '-'));
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('fr-FR');
}

function destination(summary: PacklinkListedShipment['summary']): string {
  const place = [summary.postalCode, summary.city].filter(Boolean).join(' ');
  return [summary.country, place].filter(Boolean).join(' · ') || DASH;
}

// Tone only; the label is always Packlink's raw status value.
function statusTone(status: string | null): string {
  const value = status?.toUpperCase() ?? '';
  if (!value) return 'bg-a-hover text-a-text-2';
  if (value.includes('DELIVERED')) return 'bg-tone-success-bg text-tone-success-fg';
  if (/INCIDENT|RETURN|CANCEL|ERROR/.test(value)) return 'bg-tone-danger-bg text-tone-danger-fg';
  if (/TRANSIT|DELIVERY|TRACKING|SHIPPING|PROCESSING|COLLECT/.test(value)) return 'bg-tone-info-bg text-tone-info-fg';
  return 'bg-tone-warning-bg text-tone-warning-fg';
}

function StatusPill({ status }: { status: string | null }) {
  return (
    <span className={`inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-xs font-semibold ${statusTone(status)}`}>
      {status ?? 'Statut inconnu'}
    </span>
  );
}

function OrderPill({ shipment }: { shipment: PacklinkListedShipment }) {
  if (!shipment.lepefyOrder) {
    return <span className="text-xs text-a-text-3">Non associée</span>;
  }
  return (
    <Link
      href={`/admin/orders/${shipment.lepefyOrder.id}`}
      onClick={(event) => event.stopPropagation()}
      className="inline-flex items-center rounded-full bg-a-brand-soft px-2 py-0.5 font-mono text-xs font-semibold text-a-brand-fg hover:underline"
    >
      {shipment.lepefyOrder.label}
    </Link>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-a-border py-2 text-sm last:border-0">
      <dt className="text-a-text-3">{label}</dt>
      <dd className="break-words text-a-text">{children}</dd>
    </div>
  );
}

function ShipmentDetail({
  shipment,
  onClose,
  onInspect,
}: {
  shipment: PacklinkListedShipment;
  onClose: () => void;
  onInspect: (reference: string) => void;
}) {
  const { summary } = shipment;
  const parcelCount = summary.parcelCount ?? (summary.packages.length || null);
  const totalWeight = summary.totalWeightKg
    ?? (summary.packages.reduce((sum, pkg) => sum + (pkg.weightKg ?? 0), 0) || null);


  return (
    <Drawer
      open
      onClose={onClose}
      bodyClassName="p-0 flex flex-col"
      title={<span className="break-all font-mono">{summary.reference ?? 'Référence absente'}</span>}
      description={<span className="flex flex-wrap items-center gap-1.5">
        <span>Expédition Packlink</span>
        <StatusPill status={summary.status} />
        {summary.canceled && <Badge tone="danger">Annulée</Badge>}
      </span>}
    >
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <dl>
            <DetailRow label="Destinataire">
              {[summary.recipientName, summary.recipientCompany].filter(Boolean).join(' · ') || DASH}
            </DetailRow>
            <DetailRow label="Adresse">
              {[summary.street, [summary.postalCode, summary.city].filter(Boolean).join(' '), summary.country].filter(Boolean).join(', ') || DASH}
            </DetailRow>
            <DetailRow label="Colis">
              {[
                parcelCount != null ? `${parcelCount} colis` : null,
                totalWeight != null ? `${totalWeight.toLocaleString('fr-FR')} kg au total` : null,
              ].filter(Boolean).join(' · ') || DASH}
            </DetailRow>
            {summary.packages.map((pkg, index) => (
              <DetailRow key={index} label={`Colis ${index + 1}`}>
                {[
                  pkg.weightKg != null ? `${pkg.weightKg.toLocaleString('fr-FR')} kg` : null,
                  [pkg.lengthCm, pkg.widthCm, pkg.heightCm].every(v => v != null)
                    ? `${pkg.lengthCm}×${pkg.widthCm}×${pkg.heightCm} cm` : null,
                ].filter(Boolean).join(' · ') || DASH}
              </DetailRow>
            ))}
            <DetailRow label="Transporteur">
              {[summary.carrier, summary.service].filter(Boolean).join(' · ') || DASH}
            </DetailRow>
            <DetailRow label="Coût">
              {summary.price != null
                ? `${summary.price.toLocaleString('fr-FR', { style: 'currency', currency: summary.currency ?? 'EUR' })} (valeur renvoyée par la liste)`
                : DASH}
            </DetailRow>
            <DetailRow label="Suivi">
              {summary.trackingCodes.length ? (
                <span className="font-mono text-xs">{summary.trackingCodes.join(', ')}</span>
              ) : (
                <span className="text-a-text-3">Non fourni par la liste. Utilisez le diagnostic complet.</span>
              )}
              {summary.trackingUrl && /^https:\/\//i.test(summary.trackingUrl) && (
                <a href={summary.trackingUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-a-brand-fg hover:underline">
                  Ouvrir
                </a>
              )}
            </DetailRow>
            <DetailRow label="Contenu">{summary.content ?? DASH}</DetailRow>
            <DetailRow label="Réf. client">{summary.customReference ?? DASH}</DetailRow>
            <DetailRow label="Date">{formatDate(summary.createdAt)}</DetailRow>
            <DetailRow label="Enlèvement">{formatDate(summary.collectionDate)}</DetailRow>
            <DetailRow label="Origine">{summary.source ?? DASH}</DetailRow>
            <DetailRow label="Commande Lepefy">
              {shipment.lepefyOrder ? <OrderPill shipment={shipment} /> : 'Aucune commande associée à cette référence'}
            </DetailRow>
          </dl>

          <p className="text-xs text-a-text-3">
            « {DASH} » : champ absent de la réponse Packlink pour cet enregistrement.
          </p>

          <details className="overflow-hidden rounded-xl border border-a-border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-a-text-2">
              Enregistrement JSON (données sensibles masquées)
            </summary>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-a-inverse p-3 text-xs leading-5 text-a-text-3">
              {JSON.stringify(shipment.raw, null, 2)}
            </pre>
          </details>
        </div>

        {summary.reference && /^[A-Z0-9]{6,40}$/i.test(summary.reference) && (
          <footer className="border-t border-a-border px-5 py-4">
            <button
              type="button"
              onClick={() => onInspect(summary.reference!.toUpperCase())}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-a-border px-4 py-2.5 text-sm font-semibold text-a-text hover:bg-a-surface-2"
            >
              <IconStethoscope size={17} /> Diagnostic complet (shipment, tracking, labels)
            </button>
          </footer>
        )}
    </Drawer>
  );
}

function TechnicalDiagnostics({ diagnostics }: { diagnostics: PacklinkListDiagnostics }) {
  const hints = Object.keys(diagnostics.pagination.hints);
  return (
    <details className="overflow-hidden rounded-2xl border border-a-border bg-a-surface">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-a-text hover:bg-a-surface-2">
        Diagnostic technique
      </summary>
      <div className="space-y-3 border-t border-a-border px-4 py-3">
        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {[
            ['Endpoint interrogé', diagnostics.endpoint],
            ['Code HTTP Packlink', diagnostics.upstreamStatus ?? 'aucune réponse'],
            ['Durée de la requête', `${diagnostics.durationMs} ms`],
            ['Enregistrements reçus', diagnostics.receivedCount ?? DASH],
            ['Enregistrements affichés', diagnostics.returnedCount],
            ['Conteneur de la liste', diagnostics.container ?? DASH],
            ['Clés racine', diagnostics.responseKeys.join(', ') || (diagnostics.container === 'root' ? '(tableau racine)' : DASH)],
            ['Page demandée / renvoyée', `${diagnostics.pagination.requestedPage} / ${diagnostics.pagination.currentPage ?? DASH}`],
            ['Pagination', diagnostics.pagination.verified
              ? `vérifiée · ${diagnostics.pagination.totalPages} pages · ${diagnostics.pagination.totalRecords ?? DASH} enregistrements annoncés · base ${diagnostics.pagination.oneIndexed === false ? '0' : '1'}`
              : hints.length ? `non vérifiée · clés : ${hints.join(', ')}` : 'aucune information de pagination dans la réponse'],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex gap-2 py-0.5">
              <dt className="shrink-0 text-a-text-3">{label} :</dt>
              <dd className="break-all font-mono text-a-text">{String(value)}</dd>
            </div>
          ))}
        </dl>
        {diagnostics.shipmentFields.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-a-text-3">Champs du premier enregistrement</p>
            <div className="flex flex-wrap gap-1">
              {diagnostics.shipmentFields.map(field => (
                <span key={field} className="rounded bg-a-hover px-1.5 py-0.5 font-mono text-xs text-a-text-2">{field}</span>
              ))}
            </div>
          </div>
        )}
        {(hints.length > 0 || diagnostics.unknownShapeSample !== undefined) && (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-a-inverse p-3 text-xs leading-5 text-a-text-3">
            {JSON.stringify(diagnostics.unknownShapeSample ?? diagnostics.pagination.hints, null, 2)}
          </pre>
        )}
      </div>
    </details>
  );
}

function Pager({
  page,
  totalPages,
  loading,
  onPage,
}: {
  page: number;
  totalPages: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  const [draft, setDraft] = useState(String(page));
  useEffect(() => setDraft(String(page)), [page]);
  const target = Number(draft);
  const valid = Number.isInteger(target) && target >= 1 && target <= totalPages;
  const BTN = 'inline-flex min-h-10 items-center gap-1 rounded-xl border border-a-border bg-a-surface px-3 py-2 text-sm font-semibold text-a-text transition hover:bg-a-surface-2 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <nav aria-label="Pagination des expéditions" className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex gap-2">
        <button type="button" className={BTN} disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>
          <IconChevronLeft size={16} /> Précédente
        </button>
        <button type="button" className={BTN} disabled={loading || page >= totalPages} onClick={() => onPage(page + 1)}>
          Suivante <IconChevronRight size={16} />
        </button>
      </div>
      <form
        className="flex items-center gap-2 text-sm text-a-text-2"
        onSubmit={(event) => { event.preventDefault(); if (valid && target !== page) onPage(target); }}
      >
        <label htmlFor="packlink-page">Page</label>
        <input
          id="packlink-page"
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').slice(0, 5))}
          className="w-20 rounded-xl border border-a-border bg-a-surface px-2.5 py-2 text-center text-sm text-a-text outline-none focus:ring-2 focus:ring-a-focus"
        />
        <span>sur {totalPages.toLocaleString('fr-FR')}</span>
        <button type="submit" className={BTN} disabled={loading || !valid || target === page}>Aller</button>
      </form>
    </nav>
  );
}

export function PacklinkShipmentList({ onInspect }: { onInspect: (reference: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PacklinkListResult | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [linkFilter, setLinkFilter] = useState<LinkFilter>('all');
  const [selected, setSelected] = useState<PacklinkListedShipment | null>(null);
  // Failure while moving to another page: the page already shown stays visible.
  const [pageFailure, setPageFailure] = useState<Extract<PacklinkListResult, { available: false }> | null>(null);
  // Once Packlink ignores a page request, stop offering navigation that cannot work.
  const [paginationUnsupported, setPaginationUnsupported] = useState(false);

  const pagination = result?.available ? result.diagnostics.pagination : null;
  const currentPage = pagination?.requestedPage ?? 1;

  async function load(targetPage = currentPage) {
    setLoading(true);
    setNetworkError(null);
    setPageFailure(null);
    try {
      const url = targetPage > 1 ? `/api/admin/packlink-shipments?page=${targetPage}` : '/api/admin/packlink-shipments';
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json() as PacklinkListResult | { error?: string };
      if (!('available' in data)) {
        setNetworkError(data.error ?? `Réponse inattendue (HTTP ${response.status}).`);
      } else if (!data.available && result?.available && targetPage !== currentPage) {
        setPageFailure(data);
        if (data.reason === 'page_not_honored') setPaginationUnsupported(true);
      } else {
        setResult(data);
        setSelected(null);
      }
    } catch {
      setNetworkError('Erreur réseau lors du chargement des expéditions.');
    } finally {
      setLoading(false);
    }
  }

  const shipments = useMemo(() => (result?.available ? result.shipments : []), [result]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    shipments.forEach(({ summary }) => {
      const key = summary.status ?? '';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [shipments]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return shipments.filter(shipment => {
      const { summary } = shipment;
      if (status !== 'all' && (summary.status ?? '') !== status) return false;
      if (linkFilter === 'linked' && !shipment.lepefyOrder) return false;
      if (linkFilter === 'unlinked' && shipment.lepefyOrder) return false;
      if (!needle) return true;
      return [summary.reference, summary.customReference, summary.recipientName, summary.recipientCompany, ...summary.trackingCodes, shipment.lepefyOrder?.label]
        .some(value => value?.toLowerCase().includes(needle));
    });
  }, [shipments, query, status, linkFilter]);

  const linkedCount = shipments.filter(shipment => shipment.lepefyOrder).length;
  // The observed Packlink list carries no tracking code: hide the empty column.
  const hasTracking = shipments.some(({ summary }) => summary.trackingCodes.length > 0);

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-a-border bg-a-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-a-text">Expéditions Packlink PRO</h2>
            <p className="mt-1 text-xs leading-5 text-a-text-3">
              {result
                ? <>Mis à jour le {new Date(result.queriedAt).toLocaleString('fr-FR')}
                    {result.available && pagination?.verified && <> · page {pagination.currentPage} sur {pagination.totalPages?.toLocaleString('fr-FR')}</>}
                    {result.available && <> · {result.diagnostics.returnedCount} expédition{result.diagnostics.returnedCount > 1 ? 's' : ''} {pagination?.verified ? 'sur cette page' : `récupérée${result.diagnostics.returnedCount > 1 ? 's' : ''}`} · {linkedCount} associée{linkedCount > 1 ? 's' : ''} à une commande</>}
                    {result.available && pagination?.verified && pagination.totalRecords != null && <> · {pagination.totalRecords.toLocaleString('fr-FR')} annoncées par Packlink</>}
                  </>
                : 'Consultez les expéditions visibles avec la clé API Packlink du tenant. Lecture seule, une requête par clic.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className={result
              ? 'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-a-border px-4 py-2 text-sm font-semibold text-a-text transition hover:bg-a-surface-2 disabled:opacity-50'
              : 'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-a-brand px-5 py-2.5 text-sm font-semibold text-a-on-brand transition-opacity disabled:cursor-not-allowed disabled:opacity-50'}
          >
            {result ? <IconRefresh size={17} className={loading ? 'animate-spin' : ''} /> : <IconListSearch size={17} />}
            {loading ? 'Chargement…' : result ? 'Actualiser' : 'Charger les expéditions'}
          </button>
        </div>

        {networkError && (
          <div className="mt-4 rounded-xl border border-tone-danger-border bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger-fg">{networkError}</div>
        )}

        {result && !result.available && (
          <div className="mt-4 rounded-xl border border-tone-danger-border bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger-fg">
            {result.message}
            {result.reason === 'list_endpoint_not_available' && (
              <span className="mt-1 block text-xs">Cela ne signifie pas que le compte n’a aucune expédition. Utilisez le diagnostic par référence ci-dessous.</span>
            )}
          </div>
        )}

        {pageFailure && (
          <div className="mt-4 rounded-xl border border-tone-danger-border bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger-fg">
            {pageFailure.message}
            <span className="mt-1 block text-xs">La page {currentPage} reste affichée. Détails dans le diagnostic technique.</span>
          </div>
        )}

        {result?.available && pagination?.verified && (
          <div className="mt-4 flex gap-2.5 rounded-xl border border-tone-info-border bg-tone-info-bg px-3 py-2.5 text-xs leading-5 text-tone-info-fg">
            <IconInfoCircle size={16} className="mt-0.5 shrink-0" />
            <p>
              Pagination Packlink vérifiée : la page renvoyée correspond à la page demandée. Le total est celui annoncé par Packlink (liste non documentée officiellement).
              {' '}La recherche et les filtres portent uniquement sur la page affichée.
              {result.diagnostics.truncated && <> Seuls les {result.diagnostics.returnedCount} premiers enregistrements de la page sont affichés.</>}
              {result.orderLookup === 'error' && <> Les associations Lepefy n’ont pas pu être vérifiées.</>}
            </p>
          </div>
        )}

        {result?.available && (
          <>
            {!pagination?.verified && <div className="mt-4 flex gap-2.5 rounded-xl border border-tone-warning-border bg-tone-warning-bg px-3 py-2.5 text-xs leading-5 text-tone-warning-fg">
              <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>
                Liste potentiellement incomplète : Packlink ne documente officiellement ni cette liste ni sa pagination.
                {' '}{result.diagnostics.receivedCount} = enregistrements reçus par cette requête, pas le total du compte.
                {result.diagnostics.truncated && <> Seuls les {result.diagnostics.returnedCount} premiers sont affichés.</>}
                {result.orderLookup === 'error' && <> Les associations Lepefy n’ont pas pu être vérifiées.</>}
              </p>
            </div>}

            {shipments.length > 0 && (
              <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <label className="relative block">
                  <span className="sr-only">Rechercher</span>
                  <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Référence, destinataire ou suivi"
                    className={`${INPUT_CLS} pl-9`}
                  />
                </label>
                <select value={status} onChange={(event) => setStatus(event.target.value)} className={INPUT_CLS} aria-label="Filtrer par statut">
                  <option value="all">Tous les statuts ({statusCounts.length})</option>
                  {statusCounts.map(([value, count]) => (
                    <option key={value} value={value}>{value || 'Statut inconnu'} · {count}</option>
                  ))}
                </select>
                <select value={linkFilter} onChange={(event) => setLinkFilter(event.target.value as LinkFilter)} className={INPUT_CLS} aria-label="Filtrer par association Lepefy">
                  <option value="all">Commandes : toutes</option>
                  <option value="linked">Associées à Lepefy</option>
                  <option value="unlinked">Non associées</option>
                </select>
              </div>
            )}
          </>
        )}
      </div>

      {result?.available && shipments.length === 0 && (
        <p className="rounded-2xl border border-a-border bg-a-surface px-5 py-6 text-center text-sm text-a-text-3">
          Packlink a renvoyé une liste vide pour cette clé. Vérifiez dans Packlink PRO si des expéditions existent : la liste n’étant pas documentée, une réponse vide n’est pas une preuve d’absence.
        </p>
      )}

      {result?.available && shipments.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-a-border bg-a-surface shadow-sm">
          {filtered.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-a-text-3">Aucune expédition ne correspond aux filtres.</p>
          ) : (
            <>
              <table className="hidden w-full table-fixed text-left text-sm lg:table">
                <thead>
                  <tr className="border-b border-a-border text-xs uppercase tracking-wide text-a-text-3">
                    <th className="w-[19%] px-4 py-2.5 font-semibold">Référence Packlink</th>
                    <th className="w-[13%] px-2 py-2.5 font-semibold">Statut</th>
                    <th className="w-[14%] px-2 py-2.5 font-semibold">Destinataire</th>
                    <th className="w-[15%] px-2 py-2.5 font-semibold">Destination</th>
                    <th className="w-[10%] px-2 py-2.5 font-semibold">Transporteur</th>
                    {hasTracking && <th className="w-[11%] px-2 py-2.5 font-semibold">Suivi</th>}
                    <th className="w-[8%] px-2 py-2.5 font-semibold">Date</th>
                    <th className="w-[10%] px-2 py-2.5 font-semibold">Commande</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((shipment, index) => {
                    const { summary } = shipment;
                    return (
                      <tr
                        key={`${summary.reference ?? 'row'}-${index}`}
                        onClick={() => setSelected(shipment)}
                        onKeyDown={(event) => { if (event.key === 'Enter') setSelected(shipment); }}
                        tabIndex={0}
                        className="cursor-pointer border-b border-a-border last:border-0 hover:bg-a-surface-2 focus:bg-a-surface-2 focus:outline-none"
                      >
                        <td className="truncate px-4 py-2.5 font-mono text-xs font-semibold text-a-text">{summary.reference ?? DASH}</td>
                        <td className="px-2 py-2.5"><StatusPill status={summary.status} /></td>
                        <td className="truncate px-2 py-2.5 text-a-text-2">{summary.recipientName ?? summary.recipientCompany ?? DASH}</td>
                        <td className="truncate px-2 py-2.5 text-a-text-2">{destination(summary)}</td>
                        <td className="truncate px-2 py-2.5 text-a-text-2">{summary.carrier ?? DASH}</td>
                        {hasTracking && <td className="truncate px-2 py-2.5 font-mono text-xs text-a-text-2">{summary.trackingCodes[0] ?? DASH}</td>}
                        <td className="truncate px-2 py-2.5 text-xs text-a-text-2">{formatDate(summary.createdAt)}</td>
                        <td className="truncate px-2 py-2.5"><OrderPill shipment={shipment} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <ul className="divide-y divide-a-border lg:hidden">
                {filtered.map((shipment, index) => {
                  const { summary } = shipment;
                  return (
                    <li key={`${summary.reference ?? 'row'}-${index}`}>
                      <button type="button" onClick={() => setSelected(shipment)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-a-surface-2">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-xs font-semibold text-a-text">{summary.reference ?? DASH}</span>
                            <StatusPill status={summary.status} />
                          </div>
                          <p className="truncate text-sm text-a-text-2">
                            {[summary.recipientName ?? summary.recipientCompany, destination(summary)].filter(v => v && v !== DASH).join(' · ') || DASH}
                          </p>
                          <p className="flex flex-wrap items-center gap-x-2 text-xs text-a-text-3">
                            <span>{summary.carrier ?? DASH}</span>
                            <span>· {formatDate(summary.createdAt)}</span>
                            <span>·</span><OrderPill shipment={shipment} />
                          </p>
                        </div>
                        <IconChevronRight size={16} className="shrink-0 text-a-text-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {pagination?.verified && !paginationUnsupported && (pagination.totalPages ?? 0) > 1 && (
        <Pager
          page={pagination.currentPage ?? currentPage}
          totalPages={pagination.totalPages ?? 1}
          loading={loading}
          onPage={(target) => load(target)}
        />
      )}

      {(pageFailure?.diagnostics ?? result?.diagnostics) && (
        <TechnicalDiagnostics diagnostics={(pageFailure?.diagnostics ?? result?.diagnostics)!} />
      )}

      {selected && (
        <ShipmentDetail
          shipment={selected}
          onClose={() => setSelected(null)}
          onInspect={(reference) => { setSelected(null); onInspect(reference); }}
        />
      )}
    </section>
  );
}
