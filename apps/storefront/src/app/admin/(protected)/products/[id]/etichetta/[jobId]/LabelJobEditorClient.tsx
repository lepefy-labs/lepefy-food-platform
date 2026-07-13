'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconCheck, IconX, IconUpload, IconPrinter, IconAlertTriangle, IconArrowLeft } from '@tabler/icons-react';
import { calculateLayout } from '@/lib/labels/calculateLayout';
import { LABEL_PALETTES } from '@/lib/labels/palettes';
import type { ProductLabelData, LabelSections, LabelPrintJob, LabelLayout, LabelTemplateKey, LabelPaletteKey, LabelOriginStyleKey } from '@lepefy/types';

interface LabelJobEditorProps {
  job: LabelPrintJob;
  product: ProductLabelData;
  tenantId: string;
  tenantHasLogo: boolean;
  tenantLabelLogoUrl: string | null;
}

const TEMPLATE_OPTIONS: { key: LabelTemplateKey; label: string; description: string }[] = [
  { key: 'default', label: 'Classico (due colonne)', description: 'Logo e testo su colonne separate, secondo la maquette approvata.' },
  { key: 'fullbleed', label: 'Full-bleed (sfondo intero)', description: "Lo sfondo copre l'intera etichetta, i testi poggiano su pannelli traslucidi." },
];

const PALETTE_OPTIONS: { key: LabelPaletteKey }[] = [
  { key: 'blu_epices' },
  { key: 'verde_palma' },
  { key: 'terra_piccante' },
];

const ORIGIN_STYLE_OPTIONS: { key: LabelOriginStyleKey; label: string; description: string }[] = [
  { key: 'pill', label: 'Nell’asola', description: 'Bandierina piccola davanti al nome del paese, nell’asola già esistente.' },
  { key: 'block', label: 'Blocco grafico', description: 'Bandiera più grande, con "Origine: ..." in corsivo a fianco.' },
  { key: 'medallion', label: 'Bollino speculare', description: 'Cerchio nel pannello foto con testo curvo "Prodotto in ...". Solo template Classico.' },
];

const INPUT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

const SECTION_LABELS: { key: keyof LabelSections; label: string }[] = [
  { key: 'image', label: 'Immagine' },
  { key: 'nutrition', label: 'Valori nutrizionali' },
  { key: 'allergens', label: 'Allergeni' },
  { key: 'usage', label: "Consigli d'uso" },
  { key: 'conservation', label: 'Conservazione' },
  { key: 'origin', label: 'Origine' },
];

// Champs autosauvegardés — miroir de PATCHABLE_FIELDS côté API
interface DraftFields {
  template_key: LabelTemplateKey;
  palette: LabelPaletteKey;
  natural_badge: boolean;
  origin_style: LabelOriginStyleKey;
  included_sections: LabelSections;
  lot_number: string | null;
  production_date: string | null;
  durability_date: string | null;
  quantity: number | null;
  sheet_width_mm: number;
  sheet_height_mm: number;
  label_width_mm: number;
  label_height_mm: number;
}

function toDraftFields(state: {
  templateKey: LabelTemplateKey; palette: LabelPaletteKey; naturalBadge: boolean; originStyle: LabelOriginStyleKey; sections: LabelSections; lotNumber: string; productionDate: string; durabilityDate: string; quantity: number;
  sheetWidthMm: number; sheetHeightMm: number; labelWidthMm: number; labelHeightMm: number;
}): DraftFields {
  return {
    template_key: state.templateKey,
    palette: state.palette,
    natural_badge: state.naturalBadge,
    origin_style: state.originStyle,
    included_sections: state.sections,
    lot_number: state.lotNumber || null,
    production_date: state.productionDate || null,
    durability_date: state.durabilityDate || null,
    quantity: state.quantity,
    sheet_width_mm: state.sheetWidthMm, sheet_height_mm: state.sheetHeightMm,
    label_width_mm: state.labelWidthMm, label_height_mm: state.labelHeightMm,
  };
}

export default function LabelJobEditorClient({ job, product, tenantId, tenantHasLogo, tenantLabelLogoUrl }: LabelJobEditorProps) {
  const router = useRouter();
  const [hasLogo, setHasLogo] = useState(tenantHasLogo);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [layout, setLayout] = useState<LabelLayout | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const lastSavedRef = useRef<DraftFields>(toDraftFields({
    templateKey: job.template_key, palette: job.palette, naturalBadge: job.natural_badge, originStyle: job.origin_style,
    sections: job.included_sections,
    lotNumber: job.lot_number ?? '', productionDate: job.production_date ?? '',
    durabilityDate: job.durability_date ?? '', quantity: job.quantity ?? 1,
    sheetWidthMm: job.sheet_width_mm, sheetHeightMm: job.sheet_height_mm,
    labelWidthMm: job.label_width_mm, labelHeightMm: job.label_height_mm,
  }));

  const [templateKey, setTemplateKey] = useState<LabelTemplateKey>(job.template_key);
  const [palette, setPalette] = useState<LabelPaletteKey>(job.palette);
  const [naturalBadge, setNaturalBadge] = useState(job.natural_badge);
  const [originStyle, setOriginStyle] = useState<LabelOriginStyleKey>(job.origin_style);
  const [sections, setSections] = useState<LabelSections>(job.included_sections);
  const [lotNumber, setLotNumber] = useState(job.lot_number ?? '');
  const [productionDate, setProductionDate] = useState(job.production_date ?? '');
  const [durabilityDate, setDurabilityDate] = useState(job.durability_date ?? '');
  const [quantity, setQuantity] = useState(job.quantity ?? 1);
  const [sheetWidthMm, setSheetWidthMm] = useState(job.sheet_width_mm);
  const [sheetHeightMm, setSheetHeightMm] = useState(job.sheet_height_mm);
  const [labelWidthMm, setLabelWidthMm] = useState(job.label_width_mm);
  const [labelHeightMm, setLabelHeightMm] = useState(job.label_height_mm);

  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
  }

  const durabilityLabel = product.durability_type === 'use_by'
    ? 'Da consumarsi entro'
    : 'Da consumarsi preferibilmente entro';

  // Riepilogo impaginazione istantaneo (calcolo locale, nessuna chiamata di rete)
  useEffect(() => {
    try {
      const result = calculateLayout({
        sheetWidthMm, sheetHeightMm, labelWidthMm, labelHeightMm,
        marginMm: 5, gutterMm: 2, quantity,
      });
      setLayout(result);
      setPreviewError(null);
    } catch (err) {
      setLayout(null);
      setPreviewError(err instanceof Error ? err.message : 'Errore di impaginazione');
    }
  }, [sheetWidthMm, sheetHeightMm, labelWidthMm, labelHeightMm, quantity]);

  // Anteprima reale via Gotenberg-ready HTML, con debounce
  useEffect(() => {
    if (!hasLogo || !layout) return;

    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/admin/labels/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productId: product.id,
            templateKey,
            palette,
            naturalBadge,
            originStyle,
            sections,
            lotNumber: lotNumber || '—',
            productionDate: productionDate || null,
            durabilityDate: durabilityDate || '—',
            quantity,
            sheetWidthMm, sheetHeightMm, labelWidthMm, labelHeightMm,
          }),
        });
        const data = await res.json() as { html?: string; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Erreur de prévisualisation");
        setPreviewHtml(data.html ?? null);
        setPreviewError(null);
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : "Erreur de prévisualisation");
      }
    }, 400);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLogo, templateKey, palette, naturalBadge, originStyle, sections, lotNumber, productionDate, durabilityDate, quantity, sheetWidthMm, sheetHeightMm, labelWidthMm, labelHeightMm]);

  // Autosave — n'envoie que les champs modifiés depuis le dernier enregistrement
  useEffect(() => {
    const t = setTimeout(async () => {
      const current = toDraftFields({
        templateKey, palette, naturalBadge, originStyle, sections, lotNumber, productionDate, durabilityDate, quantity,
        sheetWidthMm, sheetHeightMm, labelWidthMm, labelHeightMm,
      });

      const changed: Partial<DraftFields> = {};
      for (const key of Object.keys(current) as (keyof DraftFields)[]) {
        if (JSON.stringify(current[key]) !== JSON.stringify(lastSavedRef.current[key])) {
          (changed as Record<string, unknown>)[key] = current[key];
        }
      }
      if (Object.keys(changed).length === 0) return;

      setSaveState('saving');
      try {
        const res = await fetch(`/api/admin/labels/jobs/${job.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changed),
        });
        if (!res.ok) throw new Error();

        lastSavedRef.current = current;
        setSavedAt(new Date());
        setSaveState('saved');
      } catch {
        setSaveState('idle');
        showToast('Échec de l’enregistrement automatique', 'error');
      }
    }, 800);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey, palette, naturalBadge, originStyle, sections, lotNumber, productionDate, durabilityDate, quantity, sheetWidthMm, sheetHeightMm, labelWidthMm, labelHeightMm]);

  async function handleLogoUpload(file: File) {
    setIsUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('target', 'tenant-logo');
      formData.append('entityId', tenantId);

      const res = await fetch('/api/admin/upload-label-asset', { method: 'POST', body: formData });
      const data = await res.json() as { assetUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Échec du téléversement');

      setHasLogo(true);
      showToast('Logo étiquette téléversé', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Échec du téléversement', 'error');
    } finally {
      setIsUploadingLogo(false);
    }
  }

  async function handleGeneratePdf() {
    if (!lotNumber || !durabilityDate || quantity < 1) {
      showToast('Lot, date de durabilité et quantité sont obligatoires', 'error');
      return;
    }

    setIsGenerating(true);
    try {
      const res = await fetch('/api/admin/labels/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json() as { pdfUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Échec de la génération');

      showToast('PDF généré', 'success');
      router.push(`/admin/products/${product.id}/etichetta`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Échec de la génération', 'error');
    } finally {
      setIsGenerating(false);
    }
  }

  const saveIndicator = saveState === 'saving'
    ? 'Enregistrement...'
    : saveState === 'saved' && savedAt
      ? `Enregistré à ${savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
      : null;

  return (
    <div>
      <div className="mb-6 flex items-baseline gap-3">
        <div>
          <Link
            href={`/admin/products/${product.id}/etichetta`}
            className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1 mb-1"
          >
            <IconArrowLeft size={14} />
            Retour aux étiquettes
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Étiquette — {product.name}</h1>
          <p className="text-sm text-gray-400 mt-0.5">Génération PDF prêt pour l&apos;impression</p>
        </div>
        {saveIndicator && (
          <span className="text-xs text-gray-400">{saveIndicator}</span>
        )}
      </div>

      {!hasLogo && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-3">
            <IconAlertTriangle size={20} className="text-amber-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">Aucun logo étiquette n&apos;est configuré pour ce tenant.</p>
              <p className="text-xs text-amber-700 mt-0.5">Téléversez-le pour débloquer la génération.</p>
            </div>
          </div>
          <button
            onClick={() => logoInputRef.current?.click()}
            disabled={isUploadingLogo}
            className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-amber-500 text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <IconUpload size={14} />
            {isUploadingLogo ? 'Envoi...' : 'Téléverser le logo'}
          </button>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/svg+xml,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleLogoUpload(file);
            }}
          />
        </div>
      )}

      {hasLogo && tenantLabelLogoUrl?.toLowerCase().endsWith('.jpg') && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <IconAlertTriangle size={20} className="text-amber-500 shrink-0" />
          <p className="text-sm text-amber-800">
            Il logo è un JPG: se ha uno sfondo bianco, apparirà come un riquadro sull&apos;etichetta.
            Consigliato PNG con trasparenza o SVG.
          </p>
        </div>
      )}

      <fieldset disabled={!hasLogo} className={!hasLogo ? 'opacity-50 pointer-events-none' : ''}>
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">

          {/* ── Formulaire ─────────────────────────────────────────────── */}
          <div className="space-y-5">
            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Template</h2>
              <div className="grid grid-cols-2 gap-3">
                {TEMPLATE_OPTIONS.map((opt) => (
                  <label
                    key={opt.key}
                    className={`cursor-pointer rounded-lg border p-3 text-sm transition-colors ${
                      templateKey === opt.key ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="templateKey"
                      value={opt.key}
                      checked={templateKey === opt.key}
                      onChange={() => setTemplateKey(opt.key)}
                      className="sr-only"
                    />
                    {opt.key === 'default' ? (
                      <div className="mb-2 flex h-10 w-full overflow-hidden rounded border border-gray-200">
                        <div className="w-[32%] bg-gray-300" />
                        <div className="flex-1 bg-gray-100" />
                      </div>
                    ) : (
                      <div className="relative mb-2 h-10 w-full overflow-hidden rounded border border-gray-200 bg-gray-300">
                        <div className="absolute right-1 top-1 h-6 w-[55%] rounded-sm bg-white/80" />
                      </div>
                    )}
                    <div className="font-medium text-gray-800">{opt.label}</div>
                    <div className="mt-0.5 text-xs text-gray-400">{opt.description}</div>
                  </label>
                ))}
              </div>
            </section>

            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Palette colori</h2>
              <div className="grid grid-cols-1 gap-2">
                {PALETTE_OPTIONS.map(({ key }) => {
                  const p = LABEL_PALETTES[key];
                  return (
                    <label
                      key={key}
                      className={`cursor-pointer rounded-lg border p-3 text-sm transition-colors flex items-center gap-3 ${
                        palette === key ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="palette"
                        value={key}
                        checked={palette === key}
                        onChange={() => setPalette(key)}
                        className="sr-only"
                      />
                      <span className="flex shrink-0 overflow-hidden rounded-md border border-gray-200" style={{ width: 32, height: 32 }}>
                        <span style={{ background: p.primary, width: '50%' }} />
                        <span style={{ background: p.secondary, width: '25%' }} />
                        <span style={{ background: p.accent, width: '25%' }} />
                      </span>
                      <span>
                        <div className="font-medium text-gray-800">{p.label}</div>
                        <div className="mt-0.5 text-xs text-gray-400">{p.description}</div>
                      </span>
                    </label>
                  );
                })}
              </div>

              <label className="mt-4 flex items-center gap-2 text-sm text-gray-700 border-t border-gray-100 pt-4">
                <input
                  type="checkbox"
                  checked={naturalBadge}
                  onChange={(e) => setNaturalBadge(e.target.checked)}
                  className="accent-[var(--color-primary)]"
                />
                Bollino « 100% Naturale »
              </label>
            </section>

            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Sections incluses</h2>
              <div className="grid grid-cols-2 gap-3">
                {SECTION_LABELS.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={sections[key]}
                      onChange={(e) => setSections((s) => ({ ...s, [key]: e.target.checked }))}
                      className="accent-[var(--color-primary)]"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </section>

            <section className={`bg-white rounded-xl border border-gray-200 p-5 ${!sections.origin ? 'opacity-50 pointer-events-none' : ''}`}>
              <h2 className="text-sm font-semibold text-gray-700 mb-1">Bandiera origine</h2>
              <p className="text-xs text-gray-400 mb-4">
                {sections.origin ? 'Come mostrare il paese d’origine sull’etichetta.' : 'Attiva "Origine" tra le sections incluse per usarla.'}
              </p>
              <div className="grid grid-cols-1 gap-2">
                {ORIGIN_STYLE_OPTIONS.map((opt) => (
                  <label
                    key={opt.key}
                    className={`cursor-pointer rounded-lg border p-3 text-sm transition-colors ${
                      originStyle === opt.key ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="originStyle"
                      value={opt.key}
                      checked={originStyle === opt.key}
                      onChange={() => setOriginStyle(opt.key)}
                      className="sr-only"
                    />
                    <div className="font-medium text-gray-800">{opt.label}</div>
                    <div className="mt-0.5 text-xs text-gray-400">{opt.description}</div>
                  </label>
                ))}
              </div>
              {originStyle === 'medallion' && naturalBadge && templateKey === 'default' && (
                <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Con il bollino « 100% Naturale » attivo, il pannello foto avrà due bollini circolari
                  (in alto e in basso a destra) — verifica che il risultato ti piaccia nell&apos;anteprima.
                </p>
              )}
            </section>

            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Lot &amp; dates</h2>
              <div className="space-y-4">
                <div>
                  <label className={LABEL_CLS}>Numéro de lot</label>
                  <input
                    type="text"
                    value={lotNumber}
                    onChange={(e) => setLotNumber(e.target.value)}
                    placeholder="ex: L20260708"
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Date de production</label>
                  <input
                    type="date"
                    value={productionDate}
                    onChange={(e) => setProductionDate(e.target.value)}
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>{durabilityLabel}</label>
                  <input
                    type="date"
                    value={durabilityDate}
                    onChange={(e) => setDurabilityDate(e.target.value)}
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Quantité d&apos;étiquettes</label>
                  <input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                    className={INPUT_CLS}
                  />
                </div>
              </div>
            </section>

            <section className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Format feuille &amp; étiquette</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLS}>Feuille — largeur (mm)</label>
                  <input type="number" min={1} value={sheetWidthMm} onChange={(e) => setSheetWidthMm(Number(e.target.value))} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Feuille — hauteur (mm)</label>
                  <input type="number" min={1} value={sheetHeightMm} onChange={(e) => setSheetHeightMm(Number(e.target.value))} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Étiquette — largeur (mm)</label>
                  <input type="number" min={1} value={labelWidthMm} onChange={(e) => setLabelWidthMm(Number(e.target.value))} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Étiquette — hauteur (mm)</label>
                  <input type="number" min={1} value={labelHeightMm} onChange={(e) => setLabelHeightMm(Number(e.target.value))} className={INPUT_CLS} />
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm text-gray-600">
                {layout
                  ? `${layout.cols}×${layout.rows} = ${layout.perSheet} étiquettes / feuille, ${layout.sheets} feuille(s) au total`
                  : previewError ?? 'Calcul en cours...'}
              </div>
            </section>

            <button
              onClick={handleGeneratePdf}
              disabled={isGenerating || !layout}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <IconPrinter size={16} />
              {isGenerating ? 'Génération...' : 'Générer le PDF'}
            </button>
          </div>

          {/* ── Aperçu ─────────────────────────────────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Aperçu</h2>
            {previewError && !layout && (
              <p className="text-sm text-red-500 mb-3">{previewError}</p>
            )}
            {previewHtml ? (
              <iframe
                title="Aperçu étiquette"
                srcDoc={previewHtml}
                className="w-full border border-gray-100 rounded-lg"
                style={{ height: '75vh' }}
              />
            ) : (
              <div className="w-full h-[75vh] flex items-center justify-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg">
                Aperçu en cours de chargement...
              </div>
            )}
          </div>
        </div>
      </fieldset>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all ${
            toast.type === 'success' ? 'bg-[var(--color-primary)]' : 'bg-red-500'
          }`}
        >
          {toast.type === 'success' ? <IconCheck size={16} /> : <IconX size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
