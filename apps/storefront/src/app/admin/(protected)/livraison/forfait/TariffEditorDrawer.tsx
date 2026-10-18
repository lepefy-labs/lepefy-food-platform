'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconArrowBackUp, IconArrowLeft } from '@tabler/icons-react';
import type { ShippingTariffVersionRow } from '@lepefy/types';
import Button, { IconButton } from '@/app/admin/_components/ui/Button';
import { Drawer } from '@/app/admin/_components/ui/Dialog';
import InlineAlert from '@/app/admin/_components/ui/InlineAlert';
import { inputClasses } from '@/app/admin/_components/ui/Form';
import { useConfirm, useUnsavedChangesGuard } from '@/app/admin/_components/ui/ConfirmDialog';
import { useAdminToast } from '@/app/admin/_components/ui/Toaster';
import { cn } from '@/lib/utils/cn';
import {
  bandLabel, blockLabel, diffTariffPrices, formatEuroCents, formatEuroInput, parseEuroAmount, surchargeLabel,
  type TariffPriceEdits,
} from '@/lib/shipping/tariff/tariffEdit';

interface PriceField {
  key: string;
  label: string;
  hint: string | null;
  initialCents: number;
}

/** Montants éditables de la version, dans l'ordre d'affichage. Rien d'autre n'est modifiable. */
function priceFields(base: ShippingTariffVersionRow): { bands: PriceField[]; surcharges: PriceField[] } {
  const bands: PriceField[] = base.bands.map((b, i) => ({ key: `band-${i}`, label: bandLabel(b), hint: null, initialCents: b.price_cents }));
  if (base.block_weight_g != null && base.block_price_cents != null) {
    bands.push({ key: 'block', label: blockLabel(base.block_weight_g), hint: 'au-delà de la dernière tranche', initialCents: base.block_price_cents });
  }
  const surcharges = base.zone_surcharges.map((z) => ({
    key: `zone-${z.zone_code}`, label: surchargeLabel(z.zone_code), hint: z.mode === 'per_parcel' ? 'par colis' : 'par commande', initialCents: z.amount_cents,
  }));
  return { bands, surcharges };
}

type PublishOutcome = { kind: 'error' | 'conflict'; message: string } | null;

/**
 * « Modifier les tarifs » : drawer (plein écran sur téléphone) en deux étapes,
 * saisie puis « Vérifier et publier ». Seuls les montants changent ; la
 * publication crée une nouvelle version immuable côté serveur.
 */
export function TariffEditorDrawer({ base, countryLabel, flag, onClose }: {
  base: ShippingTariffVersionRow;
  countryLabel: string;
  flag: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const fields = useMemo(() => priceFields(base), [base]);
  const allFields = useMemo(() => [...fields.bands, ...fields.surcharges], [fields]);
  const initialValues = useMemo(() => Object.fromEntries(allFields.map((f) => [f.key, formatEuroInput(f.initialCents)])), [allFields]);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [confirmed, setConfirmed] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [outcome, setOutcome] = useState<PublishOutcome>(null);
  const [ask, confirmDialog] = useConfirm();

  const parsed = useMemo(() => Object.fromEntries(allFields.map((f) => [f.key, parseEuroAmount(values[f.key] ?? '')])), [allFields, values]);
  const invalidKeys = allFields.filter((f) => parsed[f.key] === null).map((f) => f.key);
  const changedKeys = allFields.filter((f) => (values[f.key] ?? '') !== initialValues[f.key] && parsed[f.key] !== f.initialCents).map((f) => f.key);
  const dirty = changedKeys.length > 0 || invalidKeys.length > 0;

  const edits: TariffPriceEdits | null = invalidKeys.length > 0 ? null : {
    bandPricesCents: base.bands.map((_, i) => parsed[`band-${i}`]!),
    blockPriceCents: base.block_weight_g != null ? parsed.block ?? null : null,
    surchargesCents: Object.fromEntries(base.zone_surcharges.map((z) => [z.zone_code, parsed[`zone-${z.zone_code}`]!])),
  };
  const changes = edits ? diffTariffPrices(base, edits) : [];
  const unsavedGuard = useUnsavedChangesGuard(dirty && !publishing, 'Les nouveaux prix ne sont pas publiés et seront perdus.');

  async function requestClose() {
    if (publishing) return;
    if (dirty && !(await ask({
      title: 'Abandonner les modifications ?',
      description: 'Les nouveaux prix ne sont pas publiés : les tarifs actuels restent en vigueur.',
      confirmLabel: 'Abandonner',
      cancelLabel: 'Continuer la saisie',
      destructive: true,
    }))) return;
    onClose();
  }

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setOutcome(null);
  }

  function resetAll() {
    setValues(initialValues);
    setOutcome(null);
  }

  async function publish() {
    if (!edits || changes.length === 0 || !confirmed) return;
    setPublishing(true);
    setOutcome(null);
    try {
      const response = await fetch('/api/admin/shipping-tariff-versions/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseVersionId: base.id, ...edits, confirm: true }),
      });
      const json = await response.json().catch(() => ({})) as { error?: string; code?: string; version?: { version: number } };
      if (!response.ok) {
        setOutcome({
          kind: json.code === 'TARIFF_BASE_CHANGED' || json.code === 'STRUCTURE_CHANGED' ? 'conflict' : 'error',
          message: json.error ?? 'Publication impossible. Aucun tarif n’a changé : réessayez.',
        });
        return;
      }
      toast.success(`Tarifs mis à jour · ${countryLabel}${json.version ? `, version ${json.version.version}` : ''}.`);
      router.refresh();
      onClose();
    } catch {
      setOutcome({ kind: 'error', message: 'Connexion impossible. Aucun tarif n’a changé : vérifiez le réseau puis réessayez.' });
    } finally {
      setPublishing(false);
    }
  }

  function reloadAfterConflict() {
    router.refresh();
    onClose();
  }

  const footer = step === 'edit' ? (
    <>
      <span className="text-sm text-a-text-3 sm:mr-auto sm:self-center" aria-live="polite">
        {invalidKeys.length > 0
          ? `${invalidKeys.length} montant${invalidKeys.length > 1 ? 's' : ''} à corriger`
          : changes.length === 0 ? 'Aucune modification' : `${changes.length} modification${changes.length > 1 ? 's' : ''} non publiée${changes.length > 1 ? 's' : ''}`}
      </span>
      {dirty && <Button variant="ghost" onClick={resetAll}>Tout rétablir</Button>}
      <Button onClick={() => { setConfirmed(false); setStep('review'); }} disabled={changes.length === 0 || invalidKeys.length > 0}>Vérifier et publier</Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={() => { setStep('edit'); setOutcome(null); }} disabled={publishing}>
        <IconArrowLeft size={16} aria-hidden="true" />Modifier
      </Button>
      <Button onClick={() => void publish()} loading={publishing} disabled={!confirmed || changes.length === 0 || outcome?.kind === 'conflict'}>
        Publier les nouveaux tarifs
      </Button>
    </>
  );

  return (
    <>
      {confirmDialog}
      {unsavedGuard}
      <Drawer
        open
        onClose={() => void requestClose()}
        dismissible={!publishing}
        title={step === 'edit' ? `Modifier les tarifs · ${countryLabel}` : `Vérifier et publier · ${countryLabel}`}
        description={step === 'edit'
          ? `${flag ? `${flag} ` : ''}À partir de la version ${base.version} en vigueur · prix ${base.prices_include_vat ? 'TTC' : 'HT'} en euros`
          : `${changes.length} prix modifié${changes.length > 1 ? 's' : ''}`}
        footer={footer}
      >
        {step === 'edit' ? (
          <div className="space-y-6">
            <PriceFieldset legend="Tranches de poids" fields={fields.bands} values={values} parsed={parsed} changedKeys={changedKeys} onChange={setValue} disabled={publishing} />
            {fields.surcharges.length > 0 && (
              <PriceFieldset legend="Suppléments par zone" fields={fields.surcharges} values={values} parsed={parsed} changedKeys={changedKeys} onChange={setValue} disabled={publishing} />
            )}
            <p className="rounded-lg bg-a-surface-2 px-3 py-2.5 text-xs leading-5 text-a-text-3">
              Inchangés : tranches de poids, colis de {(base.max_parcel_weight_g / 1000).toLocaleString('fr-FR')} kg, zones livrées, TVA {base.prices_include_vat ? 'incluse' : 'ajoutée'}, limite logistique. Ces réglages restent gérés par l&apos;équipe Lepefy.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-a-border text-left text-xs font-semibold text-a-text-3">
                    <th scope="col" className="py-2 pr-3">Tranche</th>
                    <th scope="col" className="py-2 pr-3 text-right">Ancien prix</th>
                    <th scope="col" className="py-2 text-right">Nouveau prix</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c) => (
                    <tr key={c.key} className="border-b border-a-border">
                      <td className="py-2.5 pr-3 text-a-text">{c.label}{c.hint && <span className="block text-xs text-a-text-3">{c.hint}</span>}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-a-text-3 line-through">{formatEuroCents(c.beforeCents)}</td>
                      <td className="py-2.5 text-right tabular-nums">
                        <span className="font-semibold text-a-text">{formatEuroCents(c.afterCents)}</span>
                        <span className="block text-xs text-a-text-3">{c.afterCents > c.beforeCents ? '+' : '−'}{formatEuroCents(Math.abs(c.afterCents - c.beforeCents))}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-a-text-2">
              <li>S&apos;applique aux nouvelles livraisons en <span className="font-semibold text-a-text">{countryLabel}</span> dès la publication.</li>
              <li>Les commandes déjà payées gardent leur prix.</li>
              <li>Un paiement en cours sera recalculé et le client confirmera le nouveau montant.</li>
              <li>La version {base.version} reste dans l&apos;historique et peut être rétablie.</li>
            </ul>
            {outcome && (
              <InlineAlert
                tone="danger"
                title={outcome.kind === 'conflict' ? 'Tarifs modifiés entre-temps' : 'Publication impossible'}
                action={outcome.kind === 'conflict' ? <Button size="sm" variant="secondary" onClick={reloadAfterConflict}>Recharger les tarifs</Button> : undefined}
              >
                {outcome.message}
              </InlineAlert>
            )}
            <div className="flex items-start gap-2">
              <input id="tariff-publish-confirm" type="checkbox" className="mt-1" checked={confirmed} disabled={publishing} onChange={(e) => setConfirmed(e.target.checked)} />
              <label htmlFor="tariff-publish-confirm" className="text-sm text-a-text">Je confirme que les clients paieront ces nouveaux prix.</label>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}

function PriceFieldset({ legend, fields, values, parsed, changedKeys, onChange, disabled }: {
  legend: string;
  fields: PriceField[];
  values: Record<string, string>;
  parsed: Record<string, number | null>;
  changedKeys: string[];
  onChange: (key: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1.5 text-sm font-semibold text-a-text">{legend}</legend>
      {fields.map((field) => {
        const id = `tariff-${field.key}`;
        const invalid = parsed[field.key] === null;
        const changed = changedKeys.includes(field.key);
        return (
          <div key={field.key} className={cn('rounded-lg px-2 py-1.5', changed && 'bg-tone-warning-bg')}>
            <div className="grid grid-cols-[minmax(0,1fr)_8.5rem_2.25rem] items-center gap-2">
              <label htmlFor={id} className="min-w-0 text-sm font-semibold text-a-text">
                {field.label}
                {(field.hint || changed) && (
                  <span className="block text-xs font-normal text-a-text-3">
                    {[field.hint, changed ? `avant ${formatEuroCents(field.initialCents)}` : null].filter(Boolean).join(' · ')}
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  id={id}
                  inputMode="decimal"
                  autoComplete="off"
                  value={values[field.key] ?? ''}
                  disabled={disabled}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? `${id}-error` : undefined}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  onBlur={() => { const cents = parsed[field.key]; if (cents != null) onChange(field.key, formatEuroInput(cents)); }}
                  className={cn(inputClasses, 'min-h-10 py-2 pr-7 text-right font-semibold tabular-nums')}
                />
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-a-text-3">€</span>
              </div>
              {changed ? (
                <IconButton label={`Rétablir ${field.label} à ${formatEuroCents(field.initialCents)}`} icon={<IconArrowBackUp size={17} />} onClick={() => onChange(field.key, formatEuroInput(field.initialCents))} disabled={disabled} />
              ) : <span />}
            </div>
            {invalid && (
              <p id={`${id}-error`} className="mt-1 text-xs text-tone-danger-fg">Montant invalide : saisissez un prix positif, par exemple 8,90.</p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
