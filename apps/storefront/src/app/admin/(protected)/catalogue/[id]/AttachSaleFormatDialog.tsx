'use client';

import { useEffect, useId, useState } from 'react';
import { IconSearch } from '@tabler/icons-react';
import Dialog from '../../../_components/ui/Dialog';
import Button from '../../../_components/ui/Button';
import Badge from '../../../_components/ui/Badge';
import { ErrorText } from '../../../_components/ui/InlineAlert';
import { controlClasses, hintClasses, labelClasses } from '@/app/admin/_components/ui/Form';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';
import { formatPrice } from '@/lib/utils/format';
import { attachBlocker, attachConsequences, type AttachCandidate } from '@/lib/catalog/saleFormatsAdmin';
import type { AdminSaleFormatsResponse } from '@/app/api/admin/catalogue/[id]/formats/route';

interface Props {
  open: boolean;
  productId: string;
  currency: string;
  base: AdminSaleFormatsResponse['base'];
  onClose: () => void;
  onAttached: (result: AdminSaleFormatsResponse) => void;
}

/**
 * « Rattacher un produit existant » (migration 188) : un produit déjà en vente
 * (ex. un carton avec son stock, sa promotion, ses paniers) devient un format
 * de cette fiche sans changer d'identifiant. Tout ce que ça change est listé
 * avant de confirmer ; rien n'est écrit avant « Rattacher ».
 */
export default function AttachSaleFormatDialog({ open, productId, currency, base, onClose, onAttached }: Props) {
  const ids = useId();
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<AttachCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AttachCandidate | null>(null);
  const [label, setLabel] = useState('');
  const [units, setUnits] = useState('10');
  const [stockMode, setStockMode] = useState<'own' | 'shared'>('own');
  const [baseLabel, setBaseLabel] = useState(base.format_label ?? '');
  const { run, pending, error } = useAdminMutation();

  useEffect(() => {
    if (!open) {
      setQuery(''); setCandidates([]); setSelected(null); setLabel(''); setUnits('10'); setStockMode('own'); setSearchError(null);
      setBaseLabel(base.format_label ?? '');
    }
  }, [open, base.format_label]);

  useEffect(() => {
    if (!open || selected) return;
    const q = query.trim();
    if (q.length < 2) { setCandidates([]); setSearching(false); return; }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/catalogue/${productId}/formats/candidates?q=${encodeURIComponent(q)}`, { cache: 'no-store', signal: controller.signal });
        const json = await response.json().catch(() => ({})) as { candidates?: AttachCandidate[]; error?: string };
        if (!response.ok) { setSearchError(json.error ?? 'Recherche impossible.'); setCandidates([]); }
        else { setSearchError(null); setCandidates(json.candidates ?? []); }
      } catch (caught) {
        if ((caught as { name?: string })?.name !== 'AbortError') setSearchError('Connexion impossible. Vérifiez le réseau puis réessayez.');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, query, selected, productId]);

  const unitsValue = Number.parseInt(units, 10);
  const unitsValid = Number.isInteger(unitsValue) && unitsValue >= 2 && unitsValue <= 999;
  const needsBaseLabel = !base.format_label;
  const sharedAllowed = selected ? selected.stock <= 0 : false;
  const effectiveMode = stockMode === 'shared' && !sharedAllowed ? 'own' : stockMode;
  const ready = Boolean(selected) && label.trim().length > 0 && unitsValid && (!needsBaseLabel || baseLabel.trim().length > 0);
  const consequences = selected && unitsValid && label.trim()
    ? attachConsequences({ candidate: selected, parent: { name: base.name, stock: base.stock }, label: label.trim(), units: unitsValue, stockMode: effectiveMode })
    : [];

  function choose(candidate: AttachCandidate) {
    setSelected(candidate);
    setStockMode('own');
  }

  async function attach() {
    if (!selected || !ready) return;
    const result = await run<AdminSaleFormatsResponse>(`/api/admin/catalogue/${productId}/formats/attach`, {
      method: 'POST',
      body: { productId: selected.id, label: label.trim(), units_per_sale: unitsValue, stock_mode: effectiveMode, baseLabel: baseLabel.trim() },
      successMessage: 'Produit rattaché comme format',
    });
    if (result && 'base' in result) onAttached(result);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!pending}
      size="lg"
      title="Rattacher un produit existant"
      description="Le produit garde son identifiant, son prix, sa promotion, les paniers et l’historique des commandes. Il se vend ensuite comme un format de cette fiche."
      footer={(
        <>
          <Button variant="secondary" onClick={selected ? () => setSelected(null) : onClose} disabled={pending}>
            {selected ? 'Choisir un autre produit' : 'Annuler'}
          </Button>
          {selected && <Button onClick={() => void attach()} loading={pending} disabled={!ready}>Rattacher</Button>}
        </>
      )}
    >
      {!selected ? (
        <div className="grid gap-3">
          <div>
            <label htmlFor={`${ids}-q`} className={labelClasses}>Produit à rattacher</label>
            <div className="relative">
              <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" aria-hidden="true" />
              <input id={`${ids}-q`} type="search" className={`${controlClasses} pl-9`} value={query} autoFocus
                placeholder="Ex. carton" onChange={(event) => setQuery(event.target.value)} />
            </div>
            <p className={hintClasses}>Tapez au moins 2 lettres du nom.</p>
          </div>
          {searching && <p className="text-sm text-a-text-3" role="status">Recherche…</p>}
          <ErrorText message={searchError} />
          {!searching && query.trim().length >= 2 && candidates.length === 0 && !searchError && (
            <p className="text-sm text-a-text-3">Aucun produit trouvé.</p>
          )}
          {candidates.length > 0 && (
            <ul className="grid gap-2" aria-label="Résultats">
              {candidates.map((candidate) => {
                const blocker = attachBlocker(candidate, productId);
                return (
                  <li key={candidate.id}>
                    <button type="button" disabled={Boolean(blocker)} onClick={() => choose(candidate)}
                      className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-a-border px-3 py-2 text-left hover:bg-a-surface-2 disabled:cursor-not-allowed disabled:opacity-60">
                      {candidate.image_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={candidate.image_url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                        : <span className="h-10 w-10 shrink-0 rounded bg-a-surface-2" aria-hidden="true" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-a-text">{candidate.name}</span>
                        <span className="block text-xs text-a-text-3">
                          {formatPrice(candidate.price, currency)} · stock {candidate.stock}{blocker ? ` · ${blocker}` : ''}
                        </span>
                      </span>
                      {!candidate.active && <Badge tone="neutral">Hors vente</Badge>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="rounded-lg border border-a-border p-3 text-sm">
            <span className="block font-semibold text-a-text">{selected.name}</span>
            <span className="block text-a-text-3">{formatPrice(selected.price, currency)} · stock {selected.stock}</span>
          </div>
          {needsBaseLabel && (
            <div>
              <label htmlFor={`${ids}-base`} className={labelClasses}>Nom du format de base</label>
              <input id={`${ids}-base`} className={controlClasses} value={baseLabel} maxLength={60} placeholder="1 paquet"
                onChange={(event) => setBaseLabel(event.target.value)} />
              <p className={hintClasses}>Le format de la fiche « {base.name} » elle-même.</p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${ids}-label`} className={labelClasses}>Nom du format</label>
              <input id={`${ids}-label`} className={controlClasses} value={label} maxLength={60} placeholder="Carton de 10 paquets"
                onChange={(event) => setLabel(event.target.value)} />
            </div>
            <div>
              <label htmlFor={`${ids}-units`} className={labelClasses}>Unités de base par vente</label>
              <input id={`${ids}-units`} className={controlClasses} type="number" min={2} max={999} inputMode="numeric"
                value={units} onChange={(event) => setUnits(event.target.value)} />
              <p className={hintClasses}>{unitsValid ? `Combien de « ${base.format_label || baseLabel || 'unités'} » contient ce format.` : 'De 2 à 999.'}</p>
            </div>
          </div>
          <div>
            <label htmlFor={`${ids}-stock`} className={labelClasses}>Stock</label>
            <select id={`${ids}-stock`} className={`${controlClasses} sm:w-auto`} value={effectiveMode}
              onChange={(event) => setStockMode(event.target.value === 'shared' ? 'shared' : 'own')}>
              <option value="own">Stock propre (cartons séparés)</option>
              <option value="shared" disabled={!sharedAllowed}>Partagé avec la fiche</option>
            </select>
            {!sharedAllowed && <p className={hintClasses}>Ce produit a du stock : il le garde. Pour partager le stock de la fiche, mettez d’abord son stock à 0.</p>}
          </div>
          {consequences.length > 0 && (
            <div className="rounded-lg border border-dashed border-a-border p-3">
              <p className="mb-2 text-sm font-semibold text-a-text-2">Ce qui va changer</p>
              <ul className="list-disc space-y-1 pl-4 text-sm text-a-text-2">
                {consequences.map((line) => <li key={line}>{line}</li>)}
              </ul>
              <p className={hintClasses}>
                {effectiveMode === 'own'
                  ? 'Réversible : « Détacher » le remet en produit autonome (son nom sera à renommer).'
                  : 'Un format à stock partagé ne se détache pas : il se met hors vente.'}
              </p>
            </div>
          )}
          <ErrorText message={error} />
        </div>
      )}
    </Dialog>
  );
}
