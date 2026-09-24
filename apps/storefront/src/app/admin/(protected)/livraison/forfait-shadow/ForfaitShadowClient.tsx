'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { IconAlertTriangle, IconCircleCheck, IconLock, IconRefresh } from '@tabler/icons-react';
import type { ShippingTariffVersionRow } from '@lepefy/types';
import type { ForfaitShadowAdminData } from '@/lib/shipping/tariff/adminData';
import type { ShadowReport } from '@/lib/shipping/tariff/shadowReport';
import type { ShadowTariffReason } from '@/lib/shipping/tariff/shadowTariff';
import { priceFromTariff, type TariffSnapshot } from '@/lib/shipping/tariff/priceFromTariff';
import { buildVersionFromDraft, parseTariffVersion, TARIFF_ERROR_LABELS } from '@/lib/shipping/tariff/tariffVersion';
import { buildActivationChecklist, describeCountryRule, perOrderSurchargeZones } from '@/lib/shipping/tariff/activationChecklist';
import { resolveCountryRule } from '@/lib/shipping/resolveCountryRule';

const CARD = 'bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5';
const INPUT_CLS =
  'w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';
const BTN = 'min-h-11 px-4 py-2 text-xs font-semibold rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50';
const BTN_GHOST = 'min-h-11 px-4 py-2 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50';

const SAMPLE_WEIGHTS_G = [1000, 5000, 5001, 10000, 15000, 15001, 20000, 30000, 30001, 45000, 60000, 90000];

const REASON_LABELS: Record<ShadowTariffReason, string> = {
  no_shadow_tariff: 'Aucune version shadow pour ce pays',
  missing_product_weight: 'Produit(s) sans poids',
  zone_unresolved: 'Zone non résolue',
  band_not_covered: 'Poids hors tranches',
  zone_not_deliverable: 'Zone non livrable',
  invalid_tariff_config: 'Configuration tarifaire invalide',
  vat_rate_missing: 'Taux de TVA manquant',
  invalid_weight: 'Poids invalide',
  country_mismatch: 'Pays différent de la version',
  timeout: 'Délai de calcul dépassé',
  unexpected_exception: 'Erreur inattendue',
};

const STATUS_LABELS: Record<string, { text: string; cls: string }> = {
  complete: { text: 'Complète', cls: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300' },
  incomplete: { text: 'Incomplète', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  unavailable: { text: 'Indisponible', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  error: { text: 'Erreur', cls: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
};

const RELIABILITY: Record<ShadowReport['reliability'], { text: string; cls: string }> = {
  insufficient: { text: 'Échantillon insuffisant (< 30 simulations complètes)', cls: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
  limited: { text: 'Échantillon limité (< 100 simulations complètes)', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  indicative: { text: 'Indicatif', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
};

function eurCents(value: number | null | undefined, signed = false): string {
  if (value == null) return '—';
  const text = (value / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${signed && value > 0 ? '+' : ''}${text} €`;
}

function kgFromG(g: number | null | undefined): string {
  return g == null ? '—' : `${(g / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} kg`;
}

function gapCls(value: number | null | undefined): string {
  if (value == null) return 'text-gray-400';
  if (value < 0) return 'text-red-600 dark:text-red-400 font-semibold';
  if (value < 100) return 'text-amber-600 dark:text-amber-400 font-semibold';
  return 'text-green-700 dark:text-green-400 font-semibold';
}

function vatRateFor(country: string, rates: ForfaitShadowAdminData['vatRates']): number | null {
  const exact = rates.find((r) => !r.countries.includes('*') && r.countries.includes(country));
  return exact?.vat_rate ?? rates.find((r) => r.countries.includes('*'))?.vat_rate ?? null;
}

function SampleTable({ tariff, vatRate }: { tariff: TariffSnapshot; vatRate: number | null }) {
  const zones = tariff.zoneSurcharges.filter((z) => z.amount_cents > 0).map((z) => z.zone_code);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left text-2xs uppercase tracking-wide text-gray-400 border-b border-gray-100 dark:border-gray-800">
            <th className="py-1.5 pr-3">Poids net</th><th className="py-1.5 pr-3">Colis théoriques</th><th className="py-1.5 pr-3">Tranche / blocs</th>
            <th className="py-1.5 pr-3 text-right">Zones standard</th>
            {zones.map((z) => <th key={z} className="py-1.5 pr-3 text-right">{z}</th>)}
            <th className="py-1.5 pr-3">Note</th>
          </tr>
        </thead>
        <tbody>
          {SAMPLE_WEIGHTS_G.map((weightG) => {
            const standard = priceFromTariff(tariff, { weightG, country: tariff.country, zoneCode: null, vatRate });
            return (
              <tr key={weightG} className="border-b border-gray-50 dark:border-gray-800/60">
                <td className="py-1.5 pr-3 whitespace-nowrap">{kgFromG(weightG)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-gray-500">{standard.available ? standard.parcelsG.map((g) => (g / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 })).join(' + ') : '—'}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-gray-500">
                  {standard.available
                    ? [standard.blocks > 0 ? `${standard.blocks} bloc(s)` : null, standard.band ? `${kgFromG(standard.band.minGExclusive)}–${standard.band.maxGInclusive === null ? '∞' : kgFromG(standard.band.maxGInclusive)}` : null].filter(Boolean).join(' + ')
                    : '—'}
                </td>
                <td className="py-1.5 pr-3 text-right font-medium">{standard.available ? eurCents(standard.totalTtcCents) : <span className="text-gray-400">hors tranches</span>}</td>
                {zones.map((z) => {
                  const r = priceFromTariff(tariff, { weightG, country: tariff.country, zoneCode: z, vatRate });
                  return <td key={z} className="py-1.5 pr-3 text-right">{r.available ? eurCents(r.totalTtcCents) : '—'}</td>;
                })}
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {standard.available && standard.warnings.includes('logistics_unverified_weight') && (
                    <span className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" title="Prix théorique : la faisabilité logistique n'a pas été vérifiée pour ce poids">logistique non vérifiée</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-2xs text-gray-400">Simulation avec le moteur utilisé au checkout, sans commande réelle. Prix TTC avant règles pays (remise, gratuité). Colis : remplissage progressif, limite par colis de la version.</p>
    </div>
  );
}

function VersionDetails({ version, vatRate }: { version: ShippingTariffVersionRow; vatRate: number | null }) {
  const parsed = parseTariffVersion(version);
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead><tr className="text-left text-2xs uppercase tracking-wide text-gray-400 border-b border-gray-100 dark:border-gray-800"><th className="py-1.5 pr-3">Tranche (&gt; min, ≤ max)</th><th className="py-1.5 text-right">Prix {version.prices_include_vat ? 'TTC' : 'HT'}</th></tr></thead>
            <tbody>
              {version.bands.map((b) => (
                <tr key={b.min_g_exclusive} className="border-b border-gray-50 dark:border-gray-800/60">
                  <td className="py-1.5 pr-3">{kgFromG(b.min_g_exclusive)} – {b.max_g_inclusive === null ? '∞' : kgFromG(b.max_g_inclusive)}</td>
                  <td className="py-1.5 text-right font-medium">{eurCents(b.price_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="text-xs text-gray-600 dark:text-gray-300 space-y-1">
          <li>Au-delà de {version.block_weight_g ? kgFromG(version.block_weight_g) : '—'} : {version.block_weight_g ? <>blocs de {kgFromG(version.block_weight_g)} à <b>{eurCents(version.block_price_cents)}</b> + tranche du reste</> : 'aucun bloc (hors tranches)'}</li>
          <li>Colis théorique max : <b>{kgFromG(version.max_parcel_weight_g)}</b></li>
          <li>Logistique vérifiée jusqu&apos;à : <b>{version.logistics_verified_max_weight_g ? kgFromG(version.logistics_verified_max_weight_g) : 'non renseigné'}</b></li>
          <li>TVA : {version.prices_include_vat ? 'incluse dans les prix' : `ajoutée au taux du pays (${vatRate != null ? `${Math.round(vatRate * 100)} %` : 'taux manquant'})`}</li>
        </ul>
        <div className="flex flex-wrap gap-1.5">
          {version.zone_surcharges.map((z) => (
            <span key={z.zone_code} className="text-2xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">{z.zone_code} +{eurCents(z.amount_cents)} {z.mode === 'per_parcel' ? '/colis' : '/commande'}</span>
          ))}
          {version.non_deliverable_zones.map((z) => (
            <span key={z} className="text-2xs px-2 py-1 rounded-lg border border-red-200 text-red-700 dark:border-red-900 dark:text-red-300">{z} non livrable</span>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">Simulation d&apos;exemple</p>
        {parsed.ok ? <SampleTable tariff={parsed.tariff} vatRate={vatRate} /> : (
          <p className="text-xs text-red-600">Version incohérente, jamais utilisée pour un calcul : {parsed.errors.map((e) => TARIFF_ERROR_LABELS[e]).join(' ')}</p>
        )}
      </div>
    </div>
  );
}

export function ForfaitShadowClient({
  data,
  initialPeriod,
  initialReport,
}: {
  data: ForfaitShadowAdminData;
  initialPeriod: { from: string; to: string };
  initialReport: { report: ShadowReport; truncated: boolean } | null;
}) {
  const [versions, setVersions] = useState<ShippingTariffVersionRow[]>(data.versions);
  const [mode, setMode] = useState(data.pricingMode);
  const [fallback, setFallback] = useState(data.fallback);
  const [publicGrid, setPublicGrid] = useState(data.publicGridEnabled);
  const [activation, setActivation] = useState<ShippingTariffVersionRow | null>(null);
  const [ackPerOrder, setAckPerOrder] = useState(false);
  const [ackConfirm, setAckConfirm] = useState(false);
  const [retireCountry, setRetireCountry] = useState<string | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Formulaire « Créer une version shadow »
  const [draftId, setDraftId] = useState<string>(data.drafts[0]?.id ?? '');
  const [country, setCountry] = useState('IT');
  const [pricesIncludeVat, setPricesIncludeVat] = useState(true);
  const [maxParcelKg, setMaxParcelKg] = useState(15);
  const [blockEnabled, setBlockEnabled] = useState(true);
  const [blockKg, setBlockKg] = useState(30);
  const [blockPrice, setBlockPrice] = useState<number>(() => {
    const d = data.drafts[0];
    return d ? Math.max(...d.bands.map((b) => b.price)) : 0;
  });
  const [logisticsMaxKg, setLogisticsMaxKg] = useState<number | ''>(50);
  const [nonDeliverable, setNonDeliverable] = useState<string[]>(data.zoneCodes.filter((z) => z === 'IT_EXTRA_CUSTOMS'));
  const [notes, setNotes] = useState('');
  const [selectAfterCreate, setSelectAfterCreate] = useState(true);

  // Rapport
  const [period, setPeriod] = useState(initialPeriod);
  const [versionFilter, setVersionFilter] = useState('');
  const [report, setReport] = useState(initialReport);
  const [reportLoading, setReportLoading] = useState(false);

  const shadowVersions = versions.filter((v) => v.status === 'shadow');
  const draft = data.drafts.find((d) => d.id === draftId) ?? null;

  const preview = useMemo(() => {
    if (!draft) return null;
    return buildVersionFromDraft(draft, {
      country,
      pricesIncludeVat,
      maxParcelKg,
      blockKg: blockEnabled ? blockKg : null,
      blockPrice: blockEnabled ? blockPrice : null,
      nonDeliverableZones: nonDeliverable,
      logisticsVerifiedMaxKg: logisticsMaxKg === '' ? null : logisticsMaxKg,
    });
  }, [draft, country, pricesIncludeVat, maxParcelKg, blockEnabled, blockKg, blockPrice, nonDeliverable, logisticsMaxKg]);

  function selectDraft(id: string) {
    setDraftId(id);
    const d = data.drafts.find((x) => x.id === id);
    if (d && d.bands.length > 0) setBlockPrice(Math.max(...d.bands.map((b) => b.price)));
  }

  async function call(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Erreur');
    return json as Record<string, unknown>;
  }

  async function refreshVersions() {
    const list = await call('/api/admin/shipping-tariff-versions', { method: 'GET' });
    setVersions(list as unknown as ShippingTariffVersionRow[]);
  }

  async function handleCreate() {
    if (!draft || !preview?.ok) return;
    setBusy('create');
    setMessage(null);
    try {
      const res = await call('/api/admin/shipping-tariff-versions', {
        method: 'POST',
        body: JSON.stringify({
          draftId, country, pricesIncludeVat, maxParcelKg,
          blockKg: blockEnabled ? blockKg : null,
          blockPrice: blockEnabled ? blockPrice : null,
          logisticsVerifiedMaxKg: logisticsMaxKg === '' ? null : logisticsMaxKg,
          nonDeliverableZones: nonDeliverable,
          notes,
          select: selectAfterCreate,
        }),
      });
      await refreshVersions();
      const created = res.version as ShippingTariffVersionRow;
      setMessage({ kind: 'ok', text: `Version ${created.country} v${created.version} créée${res.selected ? ' et sélectionnée comme version shadow' : ''}.` });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Création impossible.' });
    } finally {
      setBusy(null);
    }
  }

  async function handleSelect(version: ShippingTariffVersionRow) {
    setBusy(`select-${version.id}`);
    setMessage(null);
    try {
      await call(`/api/admin/shipping-tariff-versions/${version.id}/select`, { method: 'POST' });
      await refreshVersions();
      setMessage({ kind: 'ok', text: `Version ${version.country} v${version.version} sélectionnée comme version shadow.` });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Sélection impossible.' });
    } finally {
      setBusy(null);
    }
  }

  async function handleMode(next: 'provider_cost' | 'shadow', confirm = false) {
    setBusy('mode');
    setMessage(null);
    try {
      const wasTariff = mode === 'tariff';
      const res = await call('/api/admin/shipping-pricing-mode', { method: 'PATCH', body: JSON.stringify({ mode: next, confirm }) });
      setMode(res.mode as typeof mode);
      if (wasTariff) await refreshVersions();
      setConfirmRollback(false);
      setMessage({
        kind: 'ok',
        text: wasTariff
          ? 'Tarification retirée : les nouveaux devis reviennent au calcul actuel. Les commandes passées gardent leur tarif.'
          : next === 'shadow' ? 'Collecte shadow activée. Les frais facturés aux clients ne changent pas.' : 'Collecte shadow désactivée.',
      });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Mise à jour impossible.' });
    } finally {
      setBusy(null);
    }
  }

  async function handleFallback(next: 'unavailable' | 'provider_cost') {
    setBusy('fallback');
    setMessage(null);
    try {
      await call('/api/admin/shipping-pricing-mode', { method: 'PATCH', body: JSON.stringify({ fallback: next }) });
      setFallback(next);
      setMessage({ kind: 'ok', text: 'Règle de repli enregistrée.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Mise à jour impossible.' });
    } finally {
      setBusy(null);
    }
  }

  async function handlePublicGrid(next: boolean) {
    setBusy('public-grid');
    setMessage(null);
    try {
      await call('/api/admin/shipping-pricing-mode', { method: 'PATCH', body: JSON.stringify({ publicGrid: next }) });
      setPublicGrid(next);
      setMessage({ kind: 'ok', text: next ? 'Page publique « Frais de livraison » affichée (si une tarification est active).' : 'Page publique masquée.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Mise à jour impossible.' });
    } finally {
      setBusy(null);
    }
  }

  function openActivation(version: ShippingTariffVersionRow) {
    setActivation(version);
    setAckPerOrder(false);
    setAckConfirm(false);
    setMessage(null);
  }

  async function handleActivate() {
    if (!activation) return;
    setBusy('activate');
    try {
      await call(`/api/admin/shipping-tariff-versions/${activation.id}/activate`, {
        method: 'POST',
        body: JSON.stringify({ confirm: ackConfirm, acknowledgePerOrderSurcharges: ackPerOrder }),
      });
      await refreshVersions();
      setMode('tariff');
      setMessage({ kind: 'ok', text: `Tarification ${activation.country} v${activation.version} active : les nouveaux devis et paiements utilisent ce tarif.` });
      setActivation(null);
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Activation impossible.' });
    } finally {
      setBusy(null);
    }
  }

  async function handleRetire(countryCode: string) {
    setBusy(`retire-${countryCode}`);
    setMessage(null);
    try {
      const res = await call('/api/admin/shipping-tariff-versions/retire', { method: 'POST', body: JSON.stringify({ country: countryCode, confirm: true }) });
      await refreshVersions();
      setMode(res.pricingMode as typeof mode);
      setRetireCountry(null);
      setMessage({ kind: 'ok', text: `Tarification ${countryCode} retirée. Les commandes passées gardent leur tarif.` });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Retrait impossible.' });
    } finally {
      setBusy(null);
    }
  }

  async function loadReport() {
    setReportLoading(true);
    try {
      const qs = new URLSearchParams({ from: period.from, to: period.to, ...(versionFilter ? { versionId: versionFilter } : {}) });
      const res = await call(`/api/admin/shipping-shadow-report?${qs}`, { method: 'GET' });
      setReport(res as unknown as { report: ShadowReport; truncated: boolean });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Rapport indisponible.' });
    } finally {
      setReportLoading(false);
    }
  }

  const collecting = mode === 'shadow';
  const tariffMode = mode === 'tariff';
  const activeVersions = versions.filter((v) => v.status === 'active');
  const retiredVersions = versions.filter((v) => v.status === 'retired');
  const r = report?.report ?? null;
  const maxBucket = r ? Math.max(1, ...r.gap.buckets.map((b) => b.count)) : 1;
  const who = (id: string | null | undefined) => (id ? data.adminEmails[id] ?? 'un administrateur' : 'un administrateur');
  const checklist = activation ? buildActivationChecklist({
    version: activation,
    migrationReady: data.activationReady,
    missingWeightProducts: data.missingWeightProducts.length,
    zoneCodes: data.zoneCodes,
    profiles: data.profiles,
    countryRule: resolveCountryRule(activation.country, data.countryRules),
    fallback,
  }) : [];
  const blocking = checklist.some((i) => i.status === 'blocking');
  const needsPerOrderAck = activation ? perOrderSurchargeZones(activation).length > 0 : false;

  function activateButton(v: ShippingTariffVersionRow) {
    return (
      <button onClick={() => openActivation(v)} disabled={busy !== null || !data.activationReady} className={BTN}
        title={!data.activationReady ? 'Migration 125 requise' : undefined}>
        Activer cette tarification pour les clients
      </button>
    );
  }

  return (
    <div className="space-y-6">
      {!data.migrationReady && (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <IconAlertTriangle size={18} stroke={1.5} className="shrink-0 mt-0.5" />
          <p>La migration <code>124_shipping_tariff_versions.sql</code> n&apos;est pas encore appliquée. Les versions et la collecte shadow sont indisponibles ; le checkout fonctionne comme avant.</p>
        </div>
      )}
      {data.migrationReady && !data.activationReady && (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <IconAlertTriangle size={18} stroke={1.5} className="shrink-0 mt-0.5" />
          <p>La migration <code>125_shipping_tariff_activation.sql</code> n&apos;est pas encore appliquée : l&apos;activation commerciale est indisponible. La collecte shadow fonctionne.</p>
        </div>
      )}

      {message && (
        <div role="status" className={`rounded-lg px-3 py-2 text-xs ${message.kind === 'ok' ? 'bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>{message.text}</div>
      )}

      {/* États : brouillon / version shadow / tarification active / retirée */}
      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-4">
          <p className="text-sm font-semibold">Brouillon</p>
          <p className="text-xs text-gray-500 mt-1">Modifiable, rétrotesté dans <Link href="/admin/livraison/analyse-tarifaire" className="underline">Analyse tarifaire</Link>. Jamais lu par le checkout.</p>
          <p className="text-2xs text-gray-400 mt-2">{data.drafts.length} brouillon(s)</p>
        </div>
        <div className="rounded-xl border border-[var(--color-primary)] bg-[var(--admin-primary-soft)] p-4">
          <p className="text-sm font-semibold text-[var(--admin-primary-fg)]">Version shadow</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">Figée. Calculée à côté du prix réel quand la collecte est active, jamais facturée.</p>
          <p className="text-2xs text-gray-500 mt-2">{shadowVersions.length ? shadowVersions.map((v) => `${v.country} v${v.version}`).join(' · ') : 'Aucune version sélectionnée'}</p>
        </div>
        <div className={`rounded-xl p-4 ${activeVersions.length ? 'border-2 border-green-600 bg-green-50 dark:bg-green-950/30' : 'border border-gray-200 dark:border-gray-800'}`}>
          <p className="text-sm font-semibold flex items-center gap-1.5">{activeVersions.length ? <IconCircleCheck size={15} stroke={1.8} className="text-green-700" /> : <IconLock size={14} stroke={1.5} />}Tarification active</p>
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">{activeVersions.length ? 'Facturée aux clients sur les nouveaux devis et paiements.' : 'Aucun tarif facturé : les frais de livraison suivent le calcul actuel.'}</p>
          <p className="text-2xs text-gray-500 mt-2">{activeVersions.length ? activeVersions.map((v) => `${v.country} v${v.version}`).join(' · ') : '—'}</p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-sm font-semibold">Version retirée</p>
          <p className="text-xs text-gray-500 mt-1">Historique immuable, conservé pour expliquer les commandes passées. Peut être réactivée.</p>
          <p className="text-2xs text-gray-400 mt-2">{retiredVersions.length} version(s)</p>
        </div>
      </section>

      {/* Mode de tarification */}
      <section className={CARD}>
        {tariffMode ? (
          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Tarification client : forfait actif</h2>
              <p className="text-xs text-gray-500 mt-1">Le prix de livraison est calculé par le serveur à partir de la version active du pays, puis vérifié à nouveau à chaque paiement. La collecte shadow est suspendue.</p>
            </div>
            {confirmRollback ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                <p className="mb-2">Tous les tarifs actifs seront retirés. Les nouveaux devis reviendront au calcul actuel (devis Packlink + emballage). Les commandes passées ne changent pas ; les paiements en cours au forfait devront être recalculés.</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => void handleMode('provider_cost', true)} disabled={busy !== null} className={`${BTN} bg-red-700`}>{busy === 'mode' ? 'Retrait…' : 'Confirmer le retour au calcul actuel'}</button>
                  <button onClick={() => setConfirmRollback(false)} className={BTN_GHOST}>Annuler</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmRollback(true)} disabled={busy !== null} className={`${BTN_GHOST} border-red-300 text-red-700 dark:border-red-900 dark:text-red-300`}>Revenir au calcul actuel (tous pays)</button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Collecte shadow : {collecting ? 'activée' : 'désactivée'}</h2>
              <p className="text-xs text-gray-500 mt-1">
                {collecting
                  ? 'Le forfait de la version shadow est calculé et enregistré sur chaque commande livrée. Le client paie toujours les frais actuels.'
                  : 'Aucun calcul de forfait au checkout. Les frais de livraison sont calculés comme aujourd’hui.'}
              </p>
            </div>
            {collecting ? (
              <button onClick={() => void handleMode('provider_cost')} disabled={busy !== null || !data.migrationReady} className={`${BTN_GHOST} border-red-300 text-red-700 dark:border-red-900 dark:text-red-300`}>
                {busy === 'mode' ? 'Mise à jour…' : 'Désactiver la collecte'}
              </button>
            ) : (
              <button onClick={() => void handleMode('shadow')} disabled={busy !== null || !data.migrationReady || shadowVersions.length === 0} className={BTN}
                title={shadowVersions.length === 0 ? 'Sélectionnez d’abord une version shadow' : undefined}>
                {busy === 'mode' ? 'Mise à jour…' : 'Activer la collecte shadow'}
              </button>
            )}
          </div>
        )}
        {data.activationReady && (
          <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-4">
            <label htmlFor="fs-fallback" className={LABEL_CLS}>Si le forfait ne s&apos;applique pas (pays sans tarif actif, code postal hors zones, produit sans poids)</label>
            <select id="fs-fallback" value={fallback} disabled={busy !== null} onChange={(e) => void handleFallback(e.target.value as 'unavailable' | 'provider_cost')} className={`${INPUT_CLS} sm:max-w-md`}>
              <option value="unavailable">Livraison indisponible, retrait proposé (recommandé)</option>
              <option value="provider_cost">Facturer le devis provider actuel (Packlink + emballage)</option>
            </select>
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input id="fs-public-grid" type="checkbox" className="mt-1" checked={publicGrid} disabled={busy !== null} onChange={(e) => void handlePublicGrid(e.target.checked)} />
              <span>
                Afficher la page publique « Frais de livraison » (<code>/livraison</code>)
                <span className="block text-xs text-gray-500">Grille générée depuis la tarification active, avec un lien dans le panier. Masquée par défaut ; sans tarification active, la page reste introuvable.</span>
              </span>
            </label>
          </div>
        )}
      </section>

      {/* Tarifs actifs */}
      {activeVersions.map((v) => (
        <section key={v.id} className={`${CARD} border-2 border-green-600`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h2 className="text-sm font-semibold">Tarification active {v.country} · v{v.version} — {v.name}</h2>
            <p className="text-2xs text-gray-500">active depuis le {v.activated_at ? new Date(v.activated_at).toLocaleString('fr-FR') : '—'} · par {who(v.activated_by)}</p>
          </div>
          <VersionDetails version={v} vatRate={vatRateFor(v.country, data.vatRates)} />
          <p className="text-xs text-gray-500 mt-3">{describeCountryRule(resolveCountryRule(v.country, data.countryRules))}</p>
          <div className="mt-4">
            {retireCountry === v.country ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                <p className="mb-2">Retirer le tarif {v.country} : les nouveaux devis vers ce pays suivront le calcul actuel, ou la règle de repli si d&apos;autres pays restent au forfait.</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => void handleRetire(v.country)} disabled={busy !== null} className={`${BTN} bg-red-700`}>{busy === `retire-${v.country}` ? 'Retrait…' : 'Confirmer le retrait'}</button>
                  <button onClick={() => setRetireCountry(null)} className={BTN_GHOST}>Annuler</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setRetireCountry(v.country)} disabled={busy !== null} className={`${BTN_GHOST} border-red-300 text-red-700 dark:border-red-900 dark:text-red-300`}>Retirer ce tarif</button>
            )}
          </div>
        </section>
      ))}

      {/* Versions shadow */}
      {shadowVersions.map((v) => (
        <section key={v.id} className={CARD}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h2 className="text-sm font-semibold">Version shadow {v.country} · v{v.version} — {v.name}</h2>
            <p className="text-2xs text-gray-400">créée le {new Date(v.created_at).toLocaleDateString('fr-FR')}{v.selected_at ? ` · sélectionnée le ${new Date(v.selected_at).toLocaleDateString('fr-FR')}` : ''}</p>
          </div>
          <VersionDetails version={v} vatRate={vatRateFor(v.country, data.vatRates)} />
          <div className="mt-4">{activateButton(v)}</div>
        </section>
      ))}

      {versions.some((v) => v.status === 'validated' || v.status === 'retired') && (
        <section className={CARD}>
          <h2 className="text-sm font-semibold mb-3">Autres versions</h2>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {versions.filter((v) => v.status === 'validated' || v.status === 'retired').map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {v.country} v{v.version} — {v.name}{' '}
                  <span className="text-2xs text-gray-400">
                    ({v.status === 'retired'
                      ? `retirée${v.retired_at ? ` le ${new Date(v.retired_at).toLocaleDateString('fr-FR')}` : ''}${v.activated_at ? `, active depuis le ${new Date(v.activated_at).toLocaleDateString('fr-FR')}` : ''}`
                      : 'non sélectionnée'})
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  <button onClick={() => void handleSelect(v)} disabled={busy !== null || tariffMode} className={BTN_GHOST}>
                    {busy === `select-${v.id}` ? 'Sélection…' : 'Sélectionner comme version shadow'}
                  </button>
                  {activateButton(v)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-2xs text-gray-400 mt-2">Réactiver une version précédente est le retour arrière : les commandes déjà passées gardent la version avec laquelle elles ont été payées.</p>
        </section>
      )}

      {/* Confirmation d'activation */}
      {activation && (
        <div role="dialog" aria-modal="true" aria-labelledby="fs-activation-title" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-900 p-5 shadow-xl">
            <h2 id="fs-activation-title" className="text-base font-semibold">Activer la tarification {activation.country} v{activation.version} pour les clients</h2>
            <p className="text-xs text-gray-500 mt-1 mb-4">
              Dès la confirmation, les nouveaux devis et paiements vers {activation.country} utilisent ce tarif (prix calculé et vérifié par le serveur).
              {activeVersions.find((v) => v.country === activation.country) ? ` La version active actuelle (v${activeVersions.find((v) => v.country === activation.country)!.version}) sera retirée.` : ''}
              {' '}Les commandes passées ne changent pas ; les paiements en cours sur un autre tarif devront être recalculés et reconfirmés par le client.
            </p>
            <VersionDetails version={activation} vatRate={vatRateFor(activation.country, data.vatRates)} />
            <ul className="mt-4 space-y-1.5">
              {checklist.map((item) => (
                <li key={item.key} className="flex gap-2 text-xs">
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-2xs font-semibold ${item.status === 'ok' ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300' : item.status === 'warning' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>
                    {item.status === 'ok' ? 'OK' : item.status === 'warning' ? 'À vérifier' : 'Bloquant'}
                  </span>
                  <span><b>{item.label}</b> — {item.detail}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-2">
              {needsPerOrderAck && (
                <label className="flex items-start gap-2 text-sm">
                  <input id="fs-ack-per-order" type="checkbox" className="mt-1" checked={ackPerOrder} onChange={(e) => setAckPerOrder(e.target.checked)} />
                  Je confirme que les suppléments de zone s&apos;appliquent une seule fois par commande, et non par colis.
                </label>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input id="fs-ack-confirm" type="checkbox" className="mt-1" checked={ackConfirm} onChange={(e) => setAckConfirm(e.target.checked)} />
                Je confirme que les clients paieront ce tarif sur leurs nouvelles commandes livrées en {activation.country}.
              </label>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button onClick={() => void handleActivate()} disabled={busy !== null || blocking || !ackConfirm || (needsPerOrderAck && !ackPerOrder)} className={BTN}>
                {busy === 'activate' ? 'Activation…' : 'Activer pour les clients'}
              </button>
              <button onClick={() => setActivation(null)} disabled={busy === 'activate'} className={BTN_GHOST}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {/* Création */}
      <section className={CARD}>
        <h2 className="text-sm font-semibold mb-1">Créer une version shadow depuis un brouillon</h2>
        <p className="text-xs text-gray-400 mb-4">La version créée est figée : une correction crée une nouvelle version. Seul le prix sur le poids total est pris en charge.</p>
        {data.drafts.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun brouillon. Créez-en un dans <Link href="/admin/livraison/analyse-tarifaire" className="underline">Analyse tarifaire</Link>.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="fs-draft" className={LABEL_CLS}>Brouillon</label>
              <select id="fs-draft" value={draftId} onChange={(e) => selectDraft(e.target.value)} className={INPUT_CLS}>
                {data.drafts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="fs-country" className={LABEL_CLS}>Pays</label>
                <input id="fs-country" value={country} maxLength={2} onChange={(e) => setCountry(e.target.value.toUpperCase())} className={INPUT_CLS} />
              </div>
              <div>
                <label htmlFor="fs-vat" className={LABEL_CLS}>Prix</label>
                <select id="fs-vat" value={pricesIncludeVat ? 'ttc' : 'ht'} onChange={(e) => setPricesIncludeVat(e.target.value === 'ttc')} className={INPUT_CLS}>
                  <option value="ttc">TTC (TVA incluse)</option>
                  <option value="ht">HT (TVA ajoutée)</option>
                </select>
              </div>
              <div>
                <label htmlFor="fs-parcel" className={LABEL_CLS}>Poids max par colis (kg)</label>
                <input id="fs-parcel" type="number" min="1" step="0.5" value={maxParcelKg} onChange={(e) => setMaxParcelKg(Number(e.target.value))} className={INPUT_CLS} />
              </div>
              <div>
                <label htmlFor="fs-logistics" className={LABEL_CLS}>Logistique vérifiée jusqu&apos;à (kg)</label>
                <input id="fs-logistics" type="number" min="1" step="1" value={logisticsMaxKg} onChange={(e) => setLogisticsMaxKg(e.target.value === '' ? '' : Number(e.target.value))} className={INPUT_CLS} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] items-end">
              <label className="flex items-center gap-2 text-sm min-h-11">
                <input id="fs-block-on" type="checkbox" checked={blockEnabled} onChange={(e) => setBlockEnabled(e.target.checked)} />
                Blocs au-delà du poids
              </label>
              <div>
                <label htmlFor="fs-block-kg" className={LABEL_CLS}>Poids d&apos;un bloc (kg)</label>
                <input id="fs-block-kg" type="number" min="1" step="1" value={blockKg} disabled={!blockEnabled} onChange={(e) => setBlockKg(Number(e.target.value))} className={INPUT_CLS} />
              </div>
              <div>
                <label htmlFor="fs-block-price" className={LABEL_CLS}>Prix d&apos;un bloc (€)</label>
                <input id="fs-block-price" type="number" min="0" step="0.01" value={blockPrice} disabled={!blockEnabled} onChange={(e) => setBlockPrice(Number(e.target.value))} className={INPUT_CLS} />
              </div>
            </div>
            {data.zoneCodes.length > 0 && (
              <fieldset>
                <legend className={LABEL_CLS}>Zones non livrables</legend>
                <div className="flex flex-wrap gap-2 mt-1">
                  {data.zoneCodes.map((z) => (
                    <label key={z} className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700">
                      <input type="checkbox" checked={nonDeliverable.includes(z)} onChange={(e) => setNonDeliverable((prev) => e.target.checked ? [...prev, z] : prev.filter((x) => x !== z))} />
                      {z}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div>
              <label htmlFor="fs-notes" className={LABEL_CLS}>Note (optionnelle)</label>
              <input id="fs-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={INPUT_CLS} />
            </div>

            {preview && !preview.ok && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{preview.errors.map((e) => TARIFF_ERROR_LABELS[e]).join(' ')}</p>
            )}
            {preview?.ok && (
              <div className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2">Aperçu de la version à créer</p>
                <VersionDetails
                  version={{ ...preview.payload, id: 'preview', tenant_id: '', version: 0, status: 'validated', notes: null, created_by: null, created_at: new Date().toISOString(), selected_at: null, retired_at: null, updated_at: '' }}
                  vatRate={vatRateFor(country, data.vatRates)}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input id="fs-select" type="checkbox" checked={selectAfterCreate} onChange={(e) => setSelectAfterCreate(e.target.checked)} />
                Sélectionner comme version shadow
              </label>
              <button onClick={() => void handleCreate()} disabled={busy !== null || !data.migrationReady || !preview?.ok} className={BTN}>
                {busy === 'create' ? 'Création…' : 'Créer la version'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Qualité des poids */}
      <section className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className="text-sm font-semibold">Qualité des poids produits</h2>
          <span className={`text-2xs font-semibold px-2 py-1 rounded ${data.missingWeightProducts.length ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'}`}>
            {data.missingWeightProducts.length} / {data.activeProducts} produit(s) actif(s) sans poids
          </span>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          {tariffMode
            ? fallback === 'provider_cost'
              ? 'Tarification active : un panier contenant ces produits est facturé au devis provider (repli configuré), jamais au forfait avec un poids supposé.'
              : 'Tarification active : un panier contenant ces produits ne peut pas être livré (retrait proposé) tant que le poids manque. Aucun poids par défaut n’est utilisé.'
            : 'Une commande contenant un produit sans poids reste payable normalement, mais sa simulation est « incomplète » et exclue des statistiques (aucun poids par défaut n’est utilisé).'}
        </p>
        {data.missingWeightProducts.length > 0 && (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 max-h-80 overflow-y-auto">
            {data.missingWeightProducts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>{p.name} <span className="text-2xs text-gray-400">· stock {p.stock ?? '—'}</span></span>
                <Link href={`/admin/catalogue/${p.id}`} className="text-xs font-semibold text-[var(--color-primary-dark)] min-h-11 inline-flex items-center">Renseigner le poids</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Rapport */}
      <section className={CARD}>
        <h2 className="text-sm font-semibold mb-1">Résultats sur commandes réelles</h2>
        <p className="text-xs text-gray-400 mb-4">Commandes livrées du tenant (hors commandes de test). Les scénarios synthétiques du laboratoire ne sont jamais mélangés ici.</p>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label htmlFor="fs-from" className={LABEL_CLS}>Du</label>
            <input id="fs-from" type="date" value={period.from} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} className={INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="fs-to" className={LABEL_CLS}>Au</label>
            <input id="fs-to" type="date" value={period.to} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} className={INPUT_CLS} />
          </div>
          <div>
            <label htmlFor="fs-version" className={LABEL_CLS}>Version</label>
            <select id="fs-version" value={versionFilter} onChange={(e) => setVersionFilter(e.target.value)} className={INPUT_CLS}>
              <option value="">Toutes</option>
              {versions.map((v) => <option key={v.id} value={v.id}>{v.country} v{v.version}</option>)}
            </select>
          </div>
          <button onClick={() => void loadReport()} disabled={reportLoading || !data.migrationReady} className={`${BTN_GHOST} inline-flex items-center gap-1.5`}>
            <IconRefresh size={14} stroke={1.5} />{reportLoading ? 'Chargement…' : 'Actualiser'}
          </button>
        </div>

        {!r ? (
          <p className="text-sm text-gray-400">{data.migrationReady ? 'Aucun rapport chargé.' : 'Disponible après application de la migration 124.'}</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-2xs font-semibold px-2 py-1 rounded ${RELIABILITY[r.reliability].cls}`}>{RELIABILITY[r.reliability].text}</span>
              {r.latestVersion && <span className="text-2xs text-gray-400">Dernier calcul : v{r.latestVersion.version}, {new Date(r.latestVersion.computedAt).toLocaleString('fr-FR')}</span>}
              {report?.truncated && <span className="text-2xs text-amber-700">Période tronquée au volume maximal lu.</span>}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                ['Commandes livrées', String(r.deliveryOrders), `${r.pickupOrders} retrait(s) exclu(s) · ${r.withoutShadow} sans calcul (collecte inactive)`],
                ['Simulations complètes', String(r.byStatus.complete), `sur ${r.recorded} enregistrée(s)`],
                ['Incomplètes / exclues', String(r.byStatus.incomplete + r.byStatus.unavailable + r.byStatus.error), `${r.byStatus.incomplete} incomplète(s) · ${r.byStatus.unavailable} indisponible(s) · ${r.byStatus.error} erreur(s)`],
                ['Forfait − facturé (moy.)', eurCents(r.gap.avgCents, true), `médiane ${eurCents(r.gap.medianCents, true)} · de ${eurCents(r.gap.minCents, true)} à ${eurCents(r.gap.maxCents, true)}`],
                ['Devis Packlink TTC (moy.)', eurCents(r.providerQuote.avgTtcCents), `${r.providerQuote.verified} devis vérifié(s) contre le total signé`],
                ['Écart avant emballage (moy.)', eurCents(r.marginBeforePackaging.avgCents, true), `${r.marginBeforePackaging.negative} commande(s) négative(s) sur ${r.marginBeforePackaging.count}`],
                ['Marge complète', '—', 'Coût réel des cartons non renseigné : jamais estimé'],
                ['Poids non vérifié logistiquement', String(r.logisticsWarnings), 'Prix théorique, faisabilité à confirmer'],
              ].map(([k, v, sub]) => (
                <div key={k} className="rounded-lg bg-gray-50 dark:bg-gray-800/40 p-3">
                  <p className="text-2xs uppercase tracking-wide text-gray-400">{k}</p>
                  <p className="text-lg font-bold tabular-nums">{v}</p>
                  <p className="text-2xs text-gray-400">{sub}</p>
                </div>
              ))}
            </div>
            {(r.commercial.orders > 0 || r.commercial.fallbackOrders > 0) && (
              <div className="rounded-lg border border-green-600/40 bg-green-50/60 dark:bg-green-950/20 p-3">
                <p className="text-xs font-semibold mb-2">Commandes facturées au forfait</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm tabular-nums">
                  <div><p className="text-2xs uppercase text-gray-400">Commandes</p><p className="font-bold">{r.commercial.orders}</p><p className="text-2xs text-gray-400">{r.commercial.byVersion.map((v) => `${v.country} v${v.version} : ${v.count}`).join(' · ') || '—'}</p></div>
                  <div><p className="text-2xs uppercase text-gray-400">Forfait payé (moy.)</p><p className="font-bold">{eurCents(r.commercial.avgChargedCents)}</p></div>
                  <div><p className="text-2xs uppercase text-gray-400">Devis Packlink TTC (moy.)</p><p className="font-bold">{eurCents(r.commercial.avgProviderQuoteCents)}</p><p className="text-2xs text-gray-400">{r.commercial.providerQuoteVerified} devis connu(s)</p></div>
                  <div><p className="text-2xs uppercase text-gray-400">Écart avant emballage</p><p className={`font-bold ${gapCls(r.commercial.avgGapBeforePackagingCents)}`}>{eurCents(r.commercial.avgGapBeforePackagingCents, true)}</p><p className="text-2xs text-gray-400">{r.commercial.negativeGap} commande(s) négative(s)</p></div>
                </div>
                <p className="mt-2 text-2xs text-gray-500">Devis au moment du paiement, pas la facture Packlink ; le coût réel des cartons n&apos;est pas inclus. {r.commercial.fallbackOrders > 0 ? `${r.commercial.fallbackOrders} commande(s) facturée(s) au devis provider (repli).` : ''}</p>
              </div>
            )}
            <p className="text-2xs text-gray-400">« Forfait − facturé » compare deux prix client : ce n&apos;est pas une marge. « Écart avant emballage » = forfait − devis Packlink TTC, seulement quand le devis reconstruit exactement le montant signé. Devis, pas des factures.</p>

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs font-semibold mb-2">Distribution forfait − facturé</p>
                <div className="space-y-1.5">
                  {r.gap.buckets.map((b) => (
                    <div key={b.label} className="text-xs">
                      <div className="flex justify-between text-gray-500"><span>{b.label}</span><span className="tabular-nums">{b.count}</span></div>
                      <div className="h-2 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-[var(--color-primary)]" style={{ width: `${(b.count / maxBucket) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
              {([['Par tranche', r.byBand], ['Par zone', r.byZone]] as const).map(([title, groups]) => (
                <div key={title}>
                  <p className="text-xs font-semibold mb-2">{title}</p>
                  {groups.length === 0 ? <p className="text-xs text-gray-400">Aucune simulation complète.</p> : (
                    <table className="w-full text-xs tabular-nums">
                      <thead><tr className="text-left text-2xs uppercase text-gray-400"><th className="py-1 pr-2"> </th><th className="py-1 pr-2 text-right">n</th><th className="py-1 pr-2 text-right">Forfait</th><th className="py-1 text-right">Facturé</th></tr></thead>
                      <tbody>
                        {groups.map((g) => (
                          <tr key={g.key} className="border-t border-gray-100 dark:border-gray-800"><td className="py-1 pr-2">{g.label}</td><td className="py-1 pr-2 text-right">{g.count}</td><td className="py-1 pr-2 text-right">{eurCents(g.avgShadowCents)}</td><td className="py-1 text-right">{eurCents(g.avgChargedCents)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>

            {r.reasons.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-2">Motifs d&apos;exclusion</p>
                <div className="flex flex-wrap gap-1.5">
                  {r.reasons.map((x) => <span key={x.reason} className="text-2xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700">{REASON_LABELS[x.reason] ?? x.reason} · {x.count}</span>)}
                </div>
              </div>
            )}

            {[['Commandes à écart négatif avant emballage', r.negativeMarginOrders], ['Simulations exclues des statistiques', r.excludedOrders]].map(([title, lines]) => (
              (lines as ShadowReport['excludedOrders']).length > 0 && (
                <div key={title as string}>
                  <p className="text-xs font-semibold mb-2">{title as string}</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs tabular-nums">
                      <thead><tr className="text-left text-2xs uppercase text-gray-400 border-b border-gray-100 dark:border-gray-800"><th className="py-1.5 pr-3">Commande</th><th className="py-1.5 pr-3">Date</th><th className="py-1.5 pr-3">Statut</th><th className="py-1.5 pr-3">Motif</th><th className="py-1.5 pr-3">Zone</th><th className="py-1.5 pr-3 text-right">Poids</th><th className="py-1.5 pr-3 text-right">Facturé</th><th className="py-1.5 pr-3 text-right">Forfait</th><th className="py-1.5 text-right">Écart av. emb.</th></tr></thead>
                      <tbody>
                        {(lines as ShadowReport['excludedOrders']).map((o) => (
                          <tr key={o.id} className="border-b border-gray-50 dark:border-gray-800/60">
                            <td className="py-1.5 pr-3"><Link href={`/admin/orders/${o.id}`} className="font-mono underline">#{o.id.slice(0, 8)}</Link></td>
                            <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(o.createdAt).toLocaleDateString('fr-FR')}</td>
                            <td className="py-1.5 pr-3"><span className={`text-2xs font-semibold px-1.5 py-0.5 rounded ${STATUS_LABELS[o.status]?.cls ?? ''}`}>{STATUS_LABELS[o.status]?.text ?? o.status}</span></td>
                            <td className="py-1.5 pr-3 text-gray-500">{o.reasons.map((x) => REASON_LABELS[x] ?? x).join(', ')}{o.missingWeightProducts > 0 ? ` (${o.missingWeightProducts})` : ''}</td>
                            <td className="py-1.5 pr-3">{o.zoneCode ?? '—'}</td>
                            <td className="py-1.5 pr-3 text-right">{kgFromG(o.weightG)}</td>
                            <td className="py-1.5 pr-3 text-right">{eurCents(o.chargedCents)}</td>
                            <td className="py-1.5 pr-3 text-right">{eurCents(o.shadowCents)}</td>
                            <td className={`py-1.5 text-right ${gapCls(o.marginBeforePackagingCents)}`}>{eurCents(o.marginBeforePackagingCents, true)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
