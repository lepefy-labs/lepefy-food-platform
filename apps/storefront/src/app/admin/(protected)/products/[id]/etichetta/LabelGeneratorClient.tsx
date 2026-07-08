'use client';

import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconX, IconUpload, IconPrinter, IconAlertTriangle } from '@tabler/icons-react';
import { calculateLayout } from '@/lib/labels/calculateLayout';
import type { ProductLabelData, LabelSections, LabelSettings, LabelLayout } from '@lepefy/types';

interface LabelGeneratorProps {
  product: ProductLabelData;
  tenantId: string;
  tenantHasLogo: boolean;
  settings: Pick<LabelSettings, 'sheet_width_mm' | 'sheet_height_mm' | 'label_width_mm' | 'label_height_mm' | 'margin_mm' | 'gutter_mm' | 'crop_marks'>;
}

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

export default function LabelGeneratorClient({ product, tenantId, tenantHasLogo, settings }: LabelGeneratorProps) {
  const [hasLogo, setHasLogo] = useState(tenantHasLogo);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [layout, setLayout] = useState<LabelLayout | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const [sections, setSections] = useState<LabelSections>({
    image: true, nutrition: true, allergens: true, usage: true, conservation: true, origin: true,
  });
  const [lotNumber, setLotNumber] = useState('');
  const [productionDate, setProductionDate] = useState('');
  const [durabilityDate, setDurabilityDate] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [sheetWidthMm, setSheetWidthMm] = useState(settings.sheet_width_mm);
  const [sheetHeightMm, setSheetHeightMm] = useState(settings.sheet_height_mm);
  const [labelWidthMm, setLabelWidthMm] = useState(settings.label_width_mm);
  const [labelHeightMm, setLabelHeightMm] = useState(settings.label_height_mm);

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
        marginMm: settings.margin_mm, gutterMm: settings.gutter_mm, quantity,
      });
      setLayout(result);
      setPreviewError(null);
    } catch (err) {
      setLayout(null);
      setPreviewError(err instanceof Error ? err.message : 'Errore di impaginazione');
    }
  }, [sheetWidthMm, sheetHeightMm, labelWidthMm, labelHeightMm, settings.margin_mm, settings.gutter_mm, quantity]);

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
            templateKey: 'default',
            sections,
            lotNumber: lotNumber || '—',
            productionDate: productionDate || null,
            durabilityDate: durabilityDate || '—',
            quantity,
            sheetWidthMm, sheetHeightMm, labelWidthMm, labelHeightMm,
          }),
        });
        const data = await res.json() as { html?: string; error?: string };
        if (!res.ok) throw new Error(data.error ?? 'Erreur de prévisualisation');
        setPreviewHtml(data.html ?? null);
        setPreviewError(null);
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : 'Erreur de prévisualisation');
      }
    }, 400);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLogo, sections, lotNumber, productionDate, durabilityDate, quantity, sheetWidthMm, sheetHeightMm, labelWidthMm, labelHeightMm]);

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
        body: JSON.stringify({
          productId: product.id,
          templateKey: 'default',
          sections,
          lotNumber,
          productionDate: productionDate || null,
          durabilityDate,
          quantity,
          sheetWidthMm, sheetHeightMm, labelWidthMm, labelHeightMm,
        }),
      });
      const data = await res.json() as { pdfUrl?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Échec de la génération');

      window.open(data.pdfUrl, '_blank');
      showToast('PDF généré', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Échec de la génération', 'error');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Étiquette — {product.name}</h1>
        <p className="text-sm text-gray-400 mt-0.5">Génération PDF prêt pour l&apos;impression</p>
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

      <fieldset disabled={!hasLogo} className={!hasLogo ? 'opacity-50 pointer-events-none' : ''}>
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">

          {/* ── Formulaire ─────────────────────────────────────────────── */}
          <div className="space-y-5">
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
