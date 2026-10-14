'use client';

import { IconAlertTriangle, IconFlame, IconSparkles } from '@tabler/icons-react';
import Badge from '../../../_components/ui/Badge';
import { controlClasses, labelClasses } from '@/app/admin/_components/ui/Form';
import { formatPrice } from '@/lib/utils/format';
import { PRODUCT_NOVELTY_META, PRODUCT_PROMOTION_META, statusMeta } from '@/lib/admin/statusRegistry';
import { promotionEndLabel } from '@/lib/catalog/promotions';
import { isSoldOutForPromotion, type PromotionState } from '@/lib/catalog/promotionSchedule';
import { DEFAULT_NOVELTY_DAYS, NOVELTY_DURATIONS_DAYS, noveltyUntil } from '@/lib/catalog/novelties';
import { formatShopDate, isoToShopLocal, shopLocalToIso } from '@/lib/time/shopTime';

export interface HighlightsValue {
  /** Prix normal (champ « Prix normal » de Tarification). */
  price: string;
  promo_enabled: boolean;
  promo_price: string;
  /** datetime-local, heure de la boutique. */
  promo_starts_at: string;
  promo_ends_at: string;
  promo_until_sold_out: boolean;
  new_enabled: boolean;
  new_until: string;
}

interface Props {
  value: HighlightsValue;
  onChange: (patch: Partial<HighlightsValue>) => void;
  /** État enregistré (pas celui du formulaire) : badge en tête de section. */
  savedPromotionState: PromotionState;
  savedNewUntil: string | null;
  stock: number;
  minimum: number;
  currency: string;
  disabled?: boolean;
}

const SECTION_CLS = 'bg-a-surface rounded-xl border border-a-border p-5';
const TITLE_CLS = 'flex flex-wrap items-center gap-2 text-sm font-semibold text-a-text-2 mb-4';
const HINT_CLS = 'mt-1 text-xs text-a-text-3';
const CHECK_ROW = 'flex min-h-11 items-center gap-2 text-sm font-medium text-a-text';

function money(raw: string): number {
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : NaN;
}

/**
 * Promotion programmée et nouveauté d'un produit (migration 156). Le prix
 * payé change tout seul au début et à la fin (tick n8n toutes les 5 minutes)
 * et, pour « jusqu'à épuisement des stocks », dès que le stock ne couvre plus
 * le minimum d'achat. Les heures sont celles de la boutique (Paris).
 */
export default function ProductHighlightsSection({
  value, onChange, savedPromotionState, savedNewUntil, stock, minimum, currency, disabled = false,
}: Props) {
  const regular = money(value.price);
  const promo = money(value.promo_price);
  const promoValid = value.promo_enabled && Number.isFinite(promo) && promo > 0 && Number.isFinite(regular) && promo < regular;
  const percent = promoValid ? Math.round((1 - promo / regular) * 100) : null;
  const startIso = shopLocalToIso(value.promo_starts_at);
  const endIso = shopLocalToIso(value.promo_ends_at);
  const now = Date.now();
  const startsLater = startIso != null && Date.parse(startIso) > now;
  const endBeforeStart = startIso != null && endIso != null && Date.parse(endIso) <= Date.parse(startIso);
  const endPassed = endIso != null && Date.parse(endIso) <= now;
  const soldOut = value.promo_until_sold_out && isSoldOutForPromotion(stock, minimum);
  const customerEnd = promoValid
    ? promotionEndLabel({ price: promo, compare_at_price: regular, promo_applied: true, promo_ends_at: endIso, promo_until_sold_out: value.promo_until_sold_out })
    : null;
  const promotionMeta = statusMeta(PRODUCT_PROMOTION_META, savedPromotionState);
  const noveltyMeta = statusMeta(PRODUCT_NOVELTY_META, savedNewUntil ? 'active' : 'none');
  const noveltyIso = shopLocalToIso(value.new_until);

  function setNoveltyDays(days: number) {
    onChange({ new_enabled: true, new_until: isoToShopLocal(noveltyUntil(days)) });
  }

  return (
    <>
      <section className={SECTION_CLS} aria-labelledby="product-promotion-title">
        <h2 id="product-promotion-title" className={TITLE_CLS}>
          <IconFlame size={16} aria-hidden="true" /> Promotion
          <Badge tone={promotionMeta.tone} dot>{promotionMeta.label}</Badge>
        </h2>
        <label className={CHECK_ROW}>
          <input
            type="checkbox"
            checked={value.promo_enabled}
            disabled={disabled}
            onChange={(e) => onChange({ promo_enabled: e.target.checked })}
            className="h-4 w-4 accent-a-brand"
          />
          Mettre ce produit en promotion
        </label>

        {value.promo_enabled && (
          <div className="mt-3 grid gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="promo-price" className={labelClasses}>Prix promo (€)</label>
                <input id="promo-price" type="number" step="0.01" min="0" inputMode="decimal" disabled={disabled}
                  value={value.promo_price} onChange={(e) => onChange({ promo_price: e.target.value })}
                  aria-describedby="promo-price-hint" className={controlClasses} />
                <p id="promo-price-hint" className={HINT_CLS}>
                  {promoValid
                    ? `−${percent} % · économie ${formatPrice(regular - promo, currency)} sur ${formatPrice(regular, currency)}`
                    : 'Inférieur au prix normal (section Tarification).'}
                </p>
              </div>
              <div className="flex items-end">
                <label className={CHECK_ROW}>
                  <input type="checkbox" checked={value.promo_until_sold_out} disabled={disabled}
                    onChange={(e) => onChange({ promo_until_sold_out: e.target.checked })} className="h-4 w-4 accent-a-brand" />
                  Jusqu’à épuisement des stocks
                </label>
              </div>
              <div>
                <label htmlFor="promo-starts" className={labelClasses}>Début</label>
                <input id="promo-starts" type="datetime-local" disabled={disabled}
                  value={value.promo_starts_at} onChange={(e) => onChange({ promo_starts_at: e.target.value })}
                  className={controlClasses} />
                <p className={HINT_CLS}>Vide = dès l’enregistrement.</p>
              </div>
              <div>
                <label htmlFor="promo-ends" className={labelClasses}>Fin</label>
                <input id="promo-ends" type="datetime-local" disabled={disabled}
                  value={value.promo_ends_at} onChange={(e) => onChange({ promo_ends_at: e.target.value })}
                  className={controlClasses} />
                <p className={HINT_CLS}>Vide = sans date de fin.</p>
              </div>
            </div>

            {value.promo_until_sold_out && (
              <p className="text-xs text-a-text-3">
                La promotion s’arrête dès que le stock ne permet plus d’acheter le minimum ({minimum}) ; un réassort revient au prix normal.
              </p>
            )}
            {(endBeforeStart || endPassed || soldOut) && (
              <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-tone-warning-border bg-tone-warning-bg px-3 py-2 text-xs font-semibold text-tone-warning-fg">
                <IconAlertTriangle size={14} aria-hidden="true" className="mt-px shrink-0" />
                {endBeforeStart ? 'La fin doit être après le début.'
                  : endPassed ? 'La date de fin est déjà passée.'
                  : 'Stock épuisé : une promotion « jusqu’à épuisement des stocks » ne peut pas commencer.'}
              </p>
            )}
            {promoValid && !endBeforeStart && !endPassed && (
              <div className="rounded-lg border border-a-border bg-a-surface-2 px-3 py-2 text-xs text-a-text-2">
                <p className="font-semibold text-a-text">Le client verra</p>
                <p className="mt-0.5">
                  {startsLater && startIso ? `À partir du ${formatShopDate(startIso, 'long')} : ` : 'Dès l’enregistrement : '}
                  {formatPrice(promo, currency)} au lieu de {formatPrice(regular, currency)}, badge « Promo −{percent} % »
                  {customerEnd ? ` · ${customerEnd}` : ''}.
                </p>
              </div>
            )}
            <p className="text-xs text-a-text-3">
              Heure de Paris. Au début et à la fin, le prix change automatiquement (vérification toutes les 5 minutes).
            </p>
          </div>
        )}
      </section>

      <section className={SECTION_CLS} aria-labelledby="product-novelty-title">
        <h2 id="product-novelty-title" className={TITLE_CLS}>
          <IconSparkles size={16} aria-hidden="true" /> Nouveauté
          <Badge tone={noveltyMeta.tone} dot>
            {savedNewUntil ? `Jusqu’au ${formatShopDate(savedNewUntil)}` : noveltyMeta.label}
          </Badge>
        </h2>
        <label className={CHECK_ROW}>
          <input
            type="checkbox"
            checked={value.new_enabled}
            disabled={disabled}
            onChange={(e) => (e.target.checked && !value.new_until
              ? setNoveltyDays(DEFAULT_NOVELTY_DAYS)
              : onChange({ new_enabled: e.target.checked }))}
            className="h-4 w-4 accent-a-brand"
          />
          Afficher comme nouveauté
        </label>
        {value.new_enabled && (
          <div className="mt-3 grid gap-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Durée">
              {NOVELTY_DURATIONS_DAYS.map((days) => (
                <button key={days} type="button" disabled={disabled} onClick={() => setNoveltyDays(days)}
                  className="min-h-11 rounded-lg border border-a-border bg-a-surface px-3 text-sm font-semibold text-a-text hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus disabled:opacity-60">
                  {days} jours
                </button>
              ))}
            </div>
            <div>
              <label htmlFor="new-until" className={labelClasses}>Jusqu’au</label>
              <input id="new-until" type="datetime-local" disabled={disabled}
                value={value.new_until} onChange={(e) => onChange({ new_until: e.target.value })}
                className={controlClasses} />
              <p className={HINT_CLS}>
                {noveltyIso
                  ? `Badge « Nouveau » jusqu’au ${formatShopDate(noveltyIso, 'long')}, puis retiré automatiquement.`
                  : 'Choisissez une durée ou une date.'}
              </p>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
