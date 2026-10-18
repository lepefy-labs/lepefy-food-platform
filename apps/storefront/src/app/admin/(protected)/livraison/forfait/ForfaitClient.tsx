'use client';

import Link from 'next/link';
import { useState } from 'react';
import { IconChevronDown, IconFlask, IconLock, IconPencil } from '@tabler/icons-react';
import type { ShippingPricingMode, ShippingTariffFallback, ShippingTariffVersionRow } from '@lepefy/types';
import Badge from '@/app/admin/_components/ui/Badge';
import Button, { ButtonLink } from '@/app/admin/_components/ui/Button';
import InlineAlert from '@/app/admin/_components/ui/InlineAlert';
import { Panel } from '@/app/admin/_components/ui/Panel';
import { controlClasses, labelClasses, hintClasses } from '@/app/admin/_components/ui/Form';
import { useConfirm } from '@/app/admin/_components/ui/ConfirmDialog';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';
import { formatDate } from '@/lib/admin/format';
import {
  bandLabel, blockLabel, formatEuroCents, surchargeLabel,
  type CountryTariffView, type TariffHistoryEntry,
} from '@/lib/shipping/tariff/tariffEdit';
import { TariffEditorDrawer } from './TariffEditorDrawer';

export interface ForfaitCountryCard extends CountryTariffView {
  label: string;
  flag: string;
  /** Règle pays qui modifie le prix (remise, gratuité, forfait fixe) ; null sinon. */
  ruleNote: string | null;
}

export interface ForfaitHistoryItem extends TariffHistoryEntry {
  label: string;
  flag: string;
  activatedByEmail: string | null;
}

interface ForfaitClientProps {
  countries: ForfaitCountryCard[];
  history: ForfaitHistoryItem[];
  canManage: boolean;
  isPlatformOwner: boolean;
  migrationReady: boolean;
  activationReady: boolean;
  pricingMode: ShippingPricingMode | null;
  fallback: ShippingTariffFallback;
  publicGridEnabled: boolean;
  missingWeightProducts: Array<{ id: string; name: string }>;
}

const HISTORY_PREVIEW = 3;

export function ForfaitClient(props: ForfaitClientProps) {
  const { countries, history, canManage, isPlatformOwner, migrationReady, activationReady, pricingMode, fallback, publicGridEnabled, missingWeightProducts } = props;
  const [editing, setEditing] = useState<ForfaitCountryCard | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [ask, confirmDialog] = useConfirm();
  const mutation = useAdminMutation();
  const tariffMode = pricingMode === 'tariff';
  const activeCountries = countries.filter((c) => c.status === 'active');

  async function restore(entry: ForfaitHistoryItem) {
    const v = entry.version;
    const ok = await ask({
      title: `Rétablir la version ${v.version} pour ${entry.label} ?`,
      description: `Les nouvelles livraisons en ${entry.label} seront facturées avec les prix de cette version dès la confirmation. Les commandes déjà payées gardent leur prix ; un paiement en cours sera recalculé.`,
      confirmLabel: 'Rétablir cette version',
    });
    if (!ok) return;
    await mutation.run(`/api/admin/shipping-tariff-versions/${v.id}/activate`, {
      body: { confirm: true, acknowledgePerOrderSurcharges: true },
      successMessage: `Version ${v.version} rétablie pour ${entry.label}.`,
      errorToast: true,
    });
  }

  async function retire(card: ForfaitCountryCard) {
    const ok = await ask({
      title: `Retirer le forfait pour ${card.label} ?`,
      description: fallback === 'provider_cost'
        ? `Les nouvelles livraisons en ${card.label} seront facturées au devis transporteur. Les commandes déjà payées gardent leur prix.`
        : `Si d'autres pays restent au forfait, la livraison vers ${card.label} ne sera plus proposée (retrait en magasin). Les commandes déjà payées gardent leur prix.`,
      confirmLabel: 'Retirer le forfait',
      destructive: true,
    });
    if (!ok) return;
    await mutation.run('/api/admin/shipping-tariff-versions/retire', {
      body: { country: card.country, confirm: true },
      successMessage: `Forfait retiré pour ${card.label}.`,
      errorToast: true,
    });
  }

  async function rollbackAll() {
    const ok = await ask({
      title: 'Revenir au devis transporteur pour tous les pays ?',
      description: 'Tous les forfaits actifs seront retirés. Les nouveaux devis suivront le calcul transporteur (Packlink + emballage). Les commandes déjà payées gardent leur prix ; les paiements en cours seront recalculés.',
      confirmLabel: 'Revenir au devis transporteur',
      destructive: true,
    });
    if (!ok) return;
    await mutation.run('/api/admin/shipping-pricing-mode', {
      method: 'PATCH',
      body: { mode: 'provider_cost', confirm: true },
      successMessage: 'Forfaits retirés : les nouveaux devis suivent le calcul transporteur.',
      errorToast: true,
    });
  }

  async function saveFallback(next: ShippingTariffFallback) {
    await mutation.run('/api/admin/shipping-pricing-mode', { method: 'PATCH', body: { fallback: next }, successMessage: 'Règle enregistrée.', errorToast: true });
  }

  async function savePublicGrid(next: boolean) {
    await mutation.run('/api/admin/shipping-pricing-mode', {
      method: 'PATCH',
      body: { publicGrid: next },
      successMessage: next ? 'Page « Frais de livraison » affichée.' : 'Page « Frais de livraison » masquée.',
      errorToast: true,
    });
  }

  const visibleHistory = historyOpen ? history : history.slice(0, HISTORY_PREVIEW);

  return (
    <div className="space-y-6">
      {confirmDialog}

      {!migrationReady && (
        <InlineAlert tone="warning" title="Forfait indisponible">
          La migration 124 n&apos;est pas appliquée : les frais de livraison suivent le calcul transporteur.
        </InlineAlert>
      )}
      {migrationReady && !activationReady && (
        <InlineAlert tone="warning" title="Mise à jour des tarifs indisponible">
          La migration 125 n&apos;est pas appliquée : les tarifs ne peuvent pas être publiés.
        </InlineAlert>
      )}

      {/* 1. Tarifs actuels */}
      <section aria-labelledby="forfait-current-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 id="forfait-current-title" className="text-base font-semibold text-a-text">Tarifs de livraison actuels</h2>
            <p className="text-sm text-a-text-2">Prix payés par le client pour une livraison à domicile, selon le poids de la commande.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!canManage && <Badge tone="neutral" icon={<IconLock size={13} aria-hidden="true" />}>Lecture seule</Badge>}
            {isPlatformOwner && (
              <ButtonLink href="/admin/platform/livraison/forfait-laboratoire" variant="secondary" size="sm">
                <IconFlask size={15} aria-hidden="true" />Laboratoire forfait
              </ButtonLink>
            )}
          </div>
        </div>

        {countries.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-a-border-strong bg-a-surface p-6 text-sm text-a-text-2">
            Aucun forfait de livraison configuré : les frais sont calculés au devis transporteur pour chaque commande. Contactez l&apos;équipe Lepefy pour mettre en place une grille.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {countries.map((card) => (
              <CountryTariffCard
                key={card.country}
                card={card}
                canEdit={canManage && activationReady && card.status === 'active'}
                tariffMode={tariffMode}
                fallback={fallback}
                isPlatformOwner={isPlatformOwner}
                onEdit={() => setEditing(card)}
              />
            ))}
          </div>
        )}
      </section>

      {/* 2. Alertes opérationnelles */}
      {missingWeightProducts.length > 0 && (
        <InlineAlert tone="warning" title={`${missingWeightProducts.length} produit${missingWeightProducts.length > 1 ? 's' : ''} actif${missingWeightProducts.length > 1 ? 's' : ''} sans poids`}>
          <p>
            {tariffMode && fallback === 'provider_cost'
              ? 'Un panier qui en contient est facturé au devis transporteur, jamais au forfait avec un poids supposé.'
              : tariffMode
                ? 'Un panier qui en contient ne peut pas être livré tant que le poids manque (retrait proposé).'
                : 'Renseignez leur poids avant toute mise en place d’un forfait.'}
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer font-semibold">Compléter les poids</summary>
            <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
              {missingWeightProducts.map((p) => (
                <li key={p.id}><Link href={`/admin/catalogue/${p.id}`} className="underline">{p.name}</Link></li>
              ))}
            </ul>
          </details>
        </InlineAlert>
      )}

      {/* 3. Historique */}
      <Panel
        id="forfait-history"
        title="Historique des modifications"
        description={history.length ? 'Chaque mise à jour crée une nouvelle version ; les précédentes restent consultables et peuvent être rétablies.' : undefined}
        actions={history.length > HISTORY_PREVIEW ? (
          <Button variant="ghost" size="sm" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}>
            {historyOpen ? 'Réduire' : `Voir l'historique (${history.length})`}
          </Button>
        ) : undefined}
        flush
      >
        {history.length === 0 ? (
          <p className="px-4 py-4 text-sm text-a-text-3">Aucun tarif n&apos;a encore été facturé.</p>
        ) : (
          <ul className="divide-y divide-a-border">
            {visibleHistory.map((entry) => (
              <HistoryRow key={entry.version.id} entry={entry} canRestore={canManage && activationReady && !entry.current} busy={mutation.pending} onRestore={() => void restore(entry)} />
            ))}
          </ul>
        )}
      </Panel>

      {/* 4. Paramètres avancés */}
      {migrationReady && (
        <details className="group overflow-hidden rounded-[10px] border border-a-border bg-a-surface">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-base font-semibold text-a-text">
            Paramètres avancés
            <IconChevronDown size={18} aria-hidden="true" className="text-a-text-3 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-5 border-t border-a-border px-4 py-4">
            <div>
              <label htmlFor="forfait-fallback" className={labelClasses}>Quand le forfait ne s&apos;applique pas</label>
              <select
                id="forfait-fallback"
                value={fallback}
                disabled={!canManage || !activationReady || mutation.pending}
                onChange={(e) => void saveFallback(e.target.value as ShippingTariffFallback)}
                className={`${controlClasses} sm:max-w-md`}
              >
                <option value="unavailable">Livraison indisponible, retrait proposé</option>
                <option value="provider_cost">Facturer le devis transporteur (Packlink + emballage)</option>
              </select>
              <p className={hintClasses}>Pays sans forfait, code postal hors des zones livrées, produit sans poids.</p>
            </div>

            <div className="flex items-start gap-2">
              <input
                id="forfait-public-grid"
                type="checkbox"
                className="mt-1"
                checked={publicGridEnabled}
                disabled={!canManage || !activationReady || mutation.pending}
                onChange={(e) => void savePublicGrid(e.target.checked)}
              />
              <label htmlFor="forfait-public-grid" className="text-sm text-a-text">
                Afficher la page publique « Frais de livraison »
                <span className="block text-xs text-a-text-3">Grille générée automatiquement depuis les tarifs actuels, avec un lien dans le panier. Sans forfait actif, la page reste introuvable.</span>
              </label>
            </div>

            {canManage && tariffMode && activeCountries.length > 0 && (
              <div className="space-y-2">
                <p className={labelClasses}>Retirer un forfait</p>
                <div className="flex flex-wrap gap-2">
                  {activeCountries.map((card) => (
                    <Button key={card.country} variant="secondary" size="sm" disabled={mutation.pending} onClick={() => void retire(card)}>
                      Retirer le forfait · {card.label}
                    </Button>
                  ))}
                </div>
                <Button variant="danger" size="sm" disabled={mutation.pending} onClick={() => void rollbackAll()}>
                  Revenir au devis transporteur (tous pays)
                </Button>
              </div>
            )}
          </div>
        </details>
      )}

      {editing?.version && (
        <TariffEditorDrawer
          key={editing.version.id}
          base={editing.version}
          countryLabel={editing.label}
          flag={editing.flag}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CountryTariffCard({ card, canEdit, tariffMode, fallback, isPlatformOwner, onEdit }: {
  card: ForfaitCountryCard;
  canEdit: boolean;
  tariffMode: boolean;
  fallback: ShippingTariffFallback;
  isPlatformOwner: boolean;
  onEdit: () => void;
}) {
  const v = card.version;
  const simulated = card.status === 'simulation';
  return (
    <article className={`flex min-w-0 flex-col gap-3 rounded-[10px] border bg-a-surface p-4 ${card.status === 'active' ? 'border-a-border' : 'border-dashed border-a-border-strong'}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {card.flag && <span aria-hidden="true" className="text-2xl leading-none">{card.flag}</span>}
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-a-text">{card.label}</h3>
            <p className="text-xs text-a-text-3">
              {card.status === 'active' && v && `Version ${v.version} · en vigueur depuis le ${formatDate(v.activated_at, 'date')}`}
              {simulated && 'Grille en simulation : jamais facturée'}
              {card.status === 'not_configured' && 'Aucune grille forfaitaire'}
            </p>
          </div>
        </div>
        {card.status === 'active' && <Badge tone="success" dot>Actif</Badge>}
        {simulated && <Badge tone="info" dot>Simulation</Badge>}
        {card.status === 'not_configured' && <Badge tone="neutral">Non configuré</Badge>}
      </header>

      {v && (
        <>
          <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {v.bands.map((band) => (
              <div key={band.min_g_exclusive} className="rounded-lg bg-a-surface-2 px-3 py-2">
                <dt className="text-xs text-a-text-3">{bandLabel(band)}</dt>
                <dd className={`tabular-nums ${simulated ? 'text-base font-semibold text-a-text-2' : 'text-lg font-bold text-a-text'}`}>{formatEuroCents(band.price_cents)}</dd>
              </div>
            ))}
            {v.block_weight_g != null && v.block_price_cents != null && (
              <div className="rounded-lg bg-a-surface-2 px-3 py-2">
                <dt className="text-xs text-a-text-3">{blockLabel(v.block_weight_g)}</dt>
                <dd className={`tabular-nums ${simulated ? 'text-base font-semibold text-a-text-2' : 'text-lg font-bold text-a-text'}`}>{formatEuroCents(v.block_price_cents)}</dd>
              </div>
            )}
          </dl>

          <ul className="flex flex-wrap gap-1.5" aria-label="Suppléments et zones">
            {v.zone_surcharges.filter((z) => z.amount_cents > 0).map((z) => (
              <li key={z.zone_code} className="rounded-full border border-a-border px-2.5 py-0.5 text-xs text-a-text-2">
                {surchargeLabel(z.zone_code)} +{formatEuroCents(z.amount_cents)} {z.mode === 'per_parcel' ? '/ colis' : '/ commande'}
              </li>
            ))}
            {v.zone_surcharges.every((z) => z.amount_cents === 0) && (
              <li className="rounded-full border border-a-border px-2.5 py-0.5 text-xs text-a-text-3">Aucun supplément de zone</li>
            )}
            {v.non_deliverable_zones.map((z) => (
              <li key={z} className="rounded-full border border-tone-danger-border px-2.5 py-0.5 text-xs text-tone-danger-fg">{surchargeLabel(z)} : non livré</li>
            ))}
          </ul>
          {card.ruleNote && card.status === 'active' && <p className="text-xs text-a-text-3">{card.ruleNote}</p>}
        </>
      )}

      {card.status === 'not_configured' && (
        <p className="text-sm text-a-text-2">
          {!tariffMode || fallback === 'provider_cost'
            ? 'Frais calculés au devis transporteur pour chaque commande.'
            : 'Livraison à domicile non proposée vers ce pays (retrait proposé).'}
        </p>
      )}
      {simulated && (
        <p className="text-sm text-a-text-2">
          {tariffMode && fallback === 'unavailable' ? 'Livraison non proposée vers ce pays tant que la grille n’est pas mise en service.' : 'Les clients paient aujourd’hui le devis transporteur.'} Mise en service par l&apos;équipe Lepefy.
        </p>
      )}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2">
        {v ? <span className="text-xs text-a-text-3">{v.prices_include_vat ? 'Prix TTC · TVA incluse' : 'Prix HT · TVA du pays ajoutée'}</span> : <span />}
        {card.status === 'active' && canEdit && (
          <Button onClick={onEdit} className="max-sm:w-full"><IconPencil size={16} aria-hidden="true" />Modifier les tarifs</Button>
        )}
        {card.status !== 'active' && isPlatformOwner && (
          <ButtonLink href="/admin/platform/livraison/forfait-laboratoire" variant="secondary" size="sm">Ouvrir le laboratoire</ButtonLink>
        )}
      </footer>
    </article>
  );
}

function HistoryRow({ entry, canRestore, busy, onRestore }: {
  entry: ForfaitHistoryItem;
  canRestore: boolean;
  busy: boolean;
  onRestore: () => void;
}) {
  const v: ShippingTariffVersionRow = entry.version;
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="text-sm text-a-text">
          <span aria-hidden="true">{entry.flag} </span>
          <span className="font-semibold">{entry.label} · version {v.version}</span>
          {entry.current && <Badge tone="success" dot className="ml-2 align-middle">En vigueur</Badge>}
        </p>
        {entry.isFirst && <p className="text-sm text-a-text-2">Première grille mise en service.</p>}
        {!entry.isFirst && entry.changes === null && <p className="text-sm text-a-text-2">Nouvelle grille (tranches ou zones différentes).</p>}
        {entry.changes && entry.changes.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-a-text-2">
            {entry.changes.map((c) => (
              <li key={c.key} className="tabular-nums">{c.label}{c.hint ? ` (${c.hint})` : ''} : {formatEuroCents(c.beforeCents)} → <span className="font-semibold text-a-text">{formatEuroCents(c.afterCents)}</span></li>
            ))}
          </ul>
        )}
        {entry.changes && entry.changes.length === 0 && !entry.isFirst && <p className="text-sm text-a-text-2">Prix identiques à la version précédente (version rétablie).</p>}
        <p className="text-xs text-a-text-3">
          {formatDate(v.activated_at, 'datetime')}{entry.activatedByEmail ? ` · ${entry.activatedByEmail}` : ''}
          {!entry.current && v.retired_at ? ` · remplacée le ${formatDate(v.retired_at, 'date')}` : ''}
        </p>
      </div>
      {canRestore && (
        <Button variant="secondary" size="sm" disabled={busy} onClick={onRestore} className="shrink-0">Rétablir cette version</Button>
      )}
    </li>
  );
}
