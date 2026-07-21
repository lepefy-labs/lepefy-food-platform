import type { ProductLabelData, LabelSections, LabelPaletteKey, LabelOriginStyleKey } from '@lepefy/types';
import { resolveBackground } from '../resolveBackground';
import { formatDateIT } from '../formatDate';
import { resolveOriginFlag, FlagSwatch } from '../originFlags';
import { renderBarcodeSVG } from '@/lib/barcode';

interface TenantLabelProps {
  primary_color: string;
  secondary_color: string;
  label_logo_url: string | null;
  legal_name: string | null;
  legal_address: string | null;
  legal_email: string | null;
  legal_website: string | null;
}

interface EtnicoLabelTemplateProps {
  product: ProductLabelData;
  tenant: TenantLabelProps;
  /** Non usata: questo template ha una palette fissa (blu royal / verde / crema), indipendente dalla scelta in editor. */
  palette: LabelPaletteKey;
  naturalBadge: boolean;
  /** Non usata: la bandiera d'origine è sempre mostrata come pillola in alto a destra, come nel design "Etnico". */
  originStyle: LabelOriginStyleKey;
  sections: LabelSections;
  labelWidthMm: number;
  labelHeightMm: number;
  lotNumber: string;
  productionDate: string | null;
  durabilityDate: string;
  durabilityLabel: string; // "da consumarsi preferibilmente entro" | "da consumarsi entro"
}

function formatWeight(grams: number | null): string {
  if (!grams) return '';
  return grams >= 1000 ? `${(grams / 1000).toLocaleString('it-IT')} kg` : `${grams} g`;
}

// Look fisso "Etnico" — hardcoded per decisione di prodotto, non in palettes.ts:
// questo template non espone un selettore palette.
const BLUE = '#1E3A8A';
const GREEN = '#2E7D46';
const CREAM = '#FAF7F1';
const TEXT = '#2B2A28';
const RULE = '#E0DCD3';
const SUB_TEXT = '#8A8478';
const INGREDIENTS_TEXT = '#665F54';
const LEGAL_TEXT = '#7A7468';
const CODE_BG = '#EFEAE0';
const CHIP_TEXT = '#40382F';

type NutritionKey = keyof NonNullable<ProductLabelData['nutrition']>;

const NUTRITION_ROWS: Array<{ key: NutritionKey; label: string; unit: 'g'; subKey?: NutritionKey; subLabel?: string }> = [
  { key: 'carbs_g', label: 'Carboidrati', unit: 'g', subKey: 'saturated_fat_g', subLabel: 'di cui grassi saturi' },
  { key: 'fat_g', label: 'Grassi', unit: 'g', subKey: 'sugars_g', subLabel: 'di cui zuccheri' },
  { key: 'fiber_g', label: 'Fibre', unit: 'g' },
  { key: 'protein_g', label: 'Proteine', unit: 'g' },
  { key: 'salt_g', label: 'Sale', unit: 'g' },
];

/**
 * "Etnico" — foto con scrim verso il crema, logo circolare, badge naturale ruotato,
 * pillola bandiera+paese, titolo FR/IT-EN, feature bar, nutrizione su 2 colonne, footer legale.
 * Layout derivato dal mock 100mm×75mm del design handoff, ma le due rotture strutturali
 * principali (altezza foto, inizio pannello dati) sono espresse come frazione di
 * labelHeightMm — non in mm fissi — per restare coerenti con formati foglio/etichetta
 * configurabili (calculateLayout.ts), come già fa banner.tsx con bandHeightMm.
 */
export function EtnicoLabelTemplate({
  product, tenant, naturalBadge, sections, labelWidthMm, labelHeightMm,
  lotNumber, productionDate, durabilityDate, durabilityLabel,
}: EtnicoLabelTemplateProps) {
  const bg = resolveBackground(product, CREAM);
  const netQty = product.net_quantity_display ?? formatWeight(product.weight_grams);
  const showOrigin = sections.origin && !!product.country_of_origin;
  const originFlag = showOrigin ? resolveOriginFlag(product.country_of_origin) : null;
  const barcodeSvg = sections.barcode && product.barcode_value
    ? renderBarcodeSVG(product.barcode_value, { widthMm: 17 })
    : null;

  const photoHeightMm = labelHeightMm * (44 / 75);
  const titleTopMm = labelHeightMm * (33.5 / 75);

  const energyParts: string[] = [];
  if (product.nutrition?.kcal != null) energyParts.push(`${product.nutrition.kcal} kcal`);
  if (product.nutrition?.kj != null) energyParts.push(`${product.nutrition.kj} kJ`);

  return (
    <div style={{
      width: `${labelWidthMm}mm`, height: `${labelHeightMm}mm`,
      fontFamily: '"Archivo", Arial, sans-serif', overflow: 'hidden', position: 'relative',
      border: '0.2mm solid #ddd', background: CREAM, color: TEXT,
    }}>
      {/* Foto prodotto + scrim verso il crema */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${photoHeightMm}mm`, overflow: 'hidden' }}>
        <div style={{
          width: '100%', height: '100%',
          background: bg.type === 'color' ? bg.value : undefined,
          backgroundImage: bg.type === 'image' ? `url(${bg.url})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
        }} />
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: `linear-gradient(to bottom, transparent 55%, ${CREAM} 84%)`,
        }} />
      </div>

      {/* Logo circolare tenant */}
      {tenant.label_logo_url && (
        <div style={{
          position: 'absolute', top: '2.5mm', left: '2.5mm', width: '8mm', height: '8mm', borderRadius: '50%',
          background: '#fff', padding: '0.5mm', boxShadow: '0 0.3mm 0.8mm rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tenant.label_logo_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
        </div>
      )}

      {/* Badge "100% Naturale" ruotato */}
      {naturalBadge && (
        <div style={{
          position: 'absolute', top: '11mm', left: '2.5mm', background: GREEN, color: '#fff',
          fontSize: '1.94mm', fontWeight: 800, letterSpacing: '0.02em', padding: '0.8mm 1.8mm', borderRadius: '0.8mm',
          transform: 'rotate(-3deg)', textAlign: 'center', lineHeight: 1.2, boxShadow: '0 0.3mm 0.8mm rgba(0,0,0,0.25)',
        }}>
          100%<br />NATURALE
        </div>
      )}

      {/* Pillola bandiera + paese d'origine */}
      {showOrigin && (
        <div style={{
          position: 'absolute', top: '2.8mm', right: '2.5mm', display: 'flex', alignItems: 'center', gap: '1.2mm',
          background: '#fff', borderRadius: '4mm', padding: '0.8mm 2mm 0.8mm 0.8mm', boxShadow: '0 0.3mm 0.8mm rgba(0,0,0,0.2)',
        }}>
          {originFlag && <FlagSwatch spec={originFlag} width="5mm" height="3.3mm" style={{ boxShadow: 'none' }} />}
          <span style={{ fontSize: '2.12mm', fontWeight: 700, color: CHIP_TEXT }}>{product.country_of_origin}</span>
        </div>
      )}

      {/* Blocco titolo: nome FR grande + sottotitolo IT/EN */}
      <div style={{ position: 'absolute', top: `${titleTopMm}mm`, left: '3mm', right: '3mm' }}>
        <div style={{
          fontWeight: 800, fontSize: `clamp(4.5mm, ${68 / product.name.length}mm, 6mm)`, color: BLUE, lineHeight: 1.02, letterSpacing: '-0.01em',
          textShadow: `0 0.3mm 0 ${CREAM}, 0 -0.3mm 0 ${CREAM}, 0.3mm 0 0 ${CREAM}, -0.3mm 0 0 ${CREAM}`,
        }}>
          {product.name}
        </div>
        {product.name_alt && (
          <div style={{ fontSize: '2.47mm', fontStyle: 'italic', fontWeight: 600, color: GREEN, marginTop: '0.4mm' }}>
            {product.name_alt}
          </div>
        )}
      </div>

      {/* Pannello dati sotto la foto */}
      <div style={{
        position: 'absolute', top: `${photoHeightMm}mm`, left: 0, right: 0, bottom: 0,
        padding: '1.8mm 3mm', display: 'flex', flexDirection: 'column', gap: '1.1mm',
      }}>
        <div style={{
          margin: '-1.8mm -3mm 0.7mm', background: BLUE, padding: '0.9mm 1.8mm',
          display: 'flex', justifyContent: 'space-between', gap: '1mm',
        }}>
          <span style={{ fontSize: '1.62mm', fontWeight: 700, color: '#fff', letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>SENZA CONSERVANTI</span>
          <span style={{ fontSize: '1.62mm', fontWeight: 700, color: '#fff', letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>AROMI NATURALI</span>
          <span style={{ fontSize: '1.62mm', fontWeight: 700, color: '#fff', letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>QUALITÀ SUPERIORE</span>
        </div>

        {sections.nutrition && product.nutrition && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.4mm' }}>
              <span style={{ fontSize: '1.94mm', fontWeight: 800, letterSpacing: '0.03em', color: BLUE, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                Valori medi / {product.nutrition_basis === '100ml' ? '100 ml' : '100 g'}
              </span>
              <div style={{ flex: 1, height: '0.2mm', background: RULE }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '2.5mm', rowGap: '0.4mm', fontSize: '2.19mm', color: TEXT }}>
              {energyParts.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Energia</span>
                  <strong>{energyParts.join(' / ')}</strong>
                </div>
              )}
              {NUTRITION_ROWS.filter((r) => product.nutrition?.[r.key] != null).map((r) => {
                const subValue = r.subKey ? product.nutrition?.[r.subKey] : null;
                return (
                  <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{r.label}</span>
                    <strong>{product.nutrition?.[r.key]} {r.unit}</strong>
                  </div>
                );
              })}
              {NUTRITION_ROWS.filter((r) => r.subKey && product.nutrition?.[r.subKey] != null).map((r) => (
                <div key={`${r.key}-sub`} style={{ display: 'flex', justifyContent: 'space-between', color: SUB_TEXT }}>
                  <span>{r.subLabel}</span>
                  <span>{product.nutrition?.[r.subKey!]} g</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ fontSize: '1.94mm', color: INGREDIENTS_TEXT, lineHeight: 1.5 }}>
          {product.ingredients_text && (
            <span><strong style={{ color: TEXT }}>Ingredienti:</strong> {product.ingredients_text}</span>
          )}
          {product.conservation_instructions && (
            <span> — <strong style={{ color: TEXT }}>Conservazione:</strong> {product.conservation_instructions}
              {product.conservation_after_opening && ` ${product.conservation_after_opening}`}
            </span>
          )}
          {sections.allergens && product.allergens_text && (
            <div style={{ marginTop: '0.4mm' }}><strong style={{ color: TEXT }}>Allergeni:</strong> {product.allergens_text}</div>
          )}
          {sections.usage && product.usage_instructions && (
            <div style={{ marginTop: '0.4mm' }}><strong style={{ color: TEXT }}>Consigli d&apos;uso:</strong> {product.usage_instructions}</div>
          )}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          borderTop: `0.2mm solid ${RULE}`, paddingTop: '1.3mm', marginTop: 'auto', gap: '2mm',
        }}>
          <div style={{ fontSize: '1.69mm', color: LEGAL_TEXT, lineHeight: 1.5, maxWidth: '62mm' }}>
            {/* DejaVu Sans first: Liberation Sans's ℮ (U+212E) glyph renders as a bare "e" with no ring on Gotenberg's Linux Chromium */}
            <span style={{ fontFamily: '"DejaVu Sans", Arial, "Liberation Sans", sans-serif' }}>
              {netQty && <>Peso Netto {netQty} {'℮'} · </>}
              Lotto {lotNumber}
              {productionDate && <> · Prod. {formatDateIT(productionDate)}</>}
              {' · '}{durabilityLabel} {formatDateIT(durabilityDate)}
            </span>
            <br />
            {product.importer && <>Importato da {product.importer.name}, {product.importer.legal_address} — </>}
            Per {tenant.legal_name}, {tenant.legal_address}
            {tenant.legal_email ? ` — ${tenant.legal_email}` : ''}
            {tenant.legal_website ? ` — ${tenant.legal_website}` : ''}
          </div>
          <div style={{ display: 'flex', gap: '1.5mm', alignItems: 'flex-end', flexShrink: 0 }}>
            {barcodeSvg && (
              <div style={{ background: CODE_BG, borderRadius: '0.4mm' }} dangerouslySetInnerHTML={{ __html: barcodeSvg }} />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${process.env.NEXT_PUBLIC_STOREFRONT_URL}/api/card/qr-code?format=png&size=200`}
              alt=""
              style={{ width: '8mm', height: '8mm', background: CODE_BG, borderRadius: '0.4mm' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
