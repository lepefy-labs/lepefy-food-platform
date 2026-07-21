import { Fragment } from 'react';
import { IconPackage, IconRecycle } from '@tabler/icons-react';
import type { ProductLabelData, LabelSections, LabelPaletteKey, LabelOriginStyleKey } from '@lepefy/types';
import { resolveBackground } from '../resolveBackground';
import { formatDateIT } from '../formatDate';
import { LABEL_PALETTES, NATURAL_BADGE_COLOR, kenteStripBackground } from '../palettes';
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

interface BannerLabelTemplateProps {
  product: ProductLabelData;
  tenant: TenantLabelProps;
  palette: LabelPaletteKey;
  naturalBadge: boolean;
  /** 'medallion' non è supportato da questo template (pensato per il pannello foto a piena larghezza del Classico) — ricade sullo stile 'pill'. */
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

type NutritionKey = keyof NonNullable<ProductLabelData['nutrition']>;

const NUTRITION_ROWS: Array<{ key: NutritionKey; label: string; unit: 'kcal' | 'kJ' | 'g'; subKey?: NutritionKey; subLabel?: string }> = [
  { key: 'kj', label: 'Valore energetico', unit: 'kJ' },
  { key: 'fat_g', label: 'Grassi', unit: 'g', subKey: 'saturated_fat_g', subLabel: 'di cui saturi' },
  { key: 'carbs_g', label: 'Carboidrati', unit: 'g', subKey: 'sugars_g', subLabel: 'di cui zuccheri' },
  { key: 'fiber_g', label: 'Fibre', unit: 'g' },
  { key: 'protein_g', label: 'Proteine', unit: 'g' },
  { key: 'salt_g', label: 'Sale', unit: 'g' },
];

const TEXT_DARK = '#3B2416';

/**
 * "Fascia Dorata" — fascia superiore a tutta larghezza (logo tenant), poi tre colonne:
 * riquadro nutrizionale, nome prodotto impilato al centro, foto con striscia decorativa a destra.
 * Le colonne sono in percentuale e le righe della griglia sono calcolate in mm a partire da
 * labelWidthMm/labelHeightMm, così l'etichetta resta proporzionata quando queste dimensioni
 * vengono allargate o ristrette dalla dashboard.
 */
export function BannerLabelTemplate({
  product, tenant, palette, naturalBadge, originStyle, sections, labelWidthMm, labelHeightMm,
  lotNumber, productionDate, durabilityDate, durabilityLabel,
}: BannerLabelTemplateProps) {
  const colors = LABEL_PALETTES[palette];
  const bg = resolveBackground(product, colors.ambient);
  const netQty = product.net_quantity_display ?? formatWeight(product.weight_grams);
  const showOrigin = sections.origin && !!product.country_of_origin;
  const originFlag = showOrigin ? resolveOriginFlag(product.country_of_origin) : null;
  const hasClaims = (sections.usage && !!product.usage_instructions) || (sections.conservation && !!product.conservation_instructions);
  const barcodeSvg = sections.barcode && product.barcode_value
    ? renderBarcodeSVG(product.barcode_value, { widthMm: 22 })
    : null;

  const bandHeightMm = labelHeightMm * 0.26;
  // Il riquadro nutrizionale invade parzialmente la fascia del logo, come nell'esempio allegato
  // (2.5mm compensa il padding superiore del corpo, il resto è la vera e propria invasione).
  const nutriOverlapMm = 2.5 + Math.min(bandHeightMm * 0.35, 5);

  return (
    <div style={{
      width: `${labelWidthMm}mm`, height: `${labelHeightMm}mm`,
      display: 'grid', gridTemplateRows: `${bandHeightMm}mm 1fr`,
      fontFamily: 'Arial, sans-serif', overflow: 'hidden', position: 'relative',
      border: '0.2mm solid #ddd', background: colors.ambient,
    }}>
      {/* Fascia superiore — logo tenant centrato */}
      <div style={{ background: colors.secondary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {tenant.label_logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tenant.label_logo_url} alt="" style={{ maxWidth: '55%', maxHeight: '78%', objectFit: 'contain' }} />
        )}
      </div>

      {/* Corpo — nutrizione | titolo | foto, con una riga finale per le rivendicazioni uso/conservazione */}
      <div style={{
        display: 'grid', gridTemplateColumns: '27% 33% 40%', gridTemplateRows: '1fr auto',
        padding: '2.5mm 2.5mm 1.5mm', minHeight: 0,
      }}>
        {/* Colonna sinistra — riquadro nutrizionale (sconfina nella fascia logo) + dati legali */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, paddingRight: '2mm' }}>
          {sections.nutrition && product.nutrition && (
            <div style={{
              border: `0.3mm solid ${colors.primary}`, borderRadius: '1mm', overflow: 'hidden', background: '#FFFDF8',
              flexShrink: 0, position: 'relative', zIndex: 2, marginTop: `-${nutriOverlapMm}mm`,
              boxShadow: '0 0.4mm 1mm rgba(0,0,0,0.15)',
            }}>
              <div style={{ padding: '0.8mm 1.6mm', borderBottom: `0.3mm solid ${colors.primary}` }}>
                <div style={{ fontWeight: 800, fontSize: '1.9mm', color: TEXT_DARK }}>Valori Nutrizionali Medi</div>
                <div style={{ fontSize: '1.3mm', color: TEXT_DARK, marginTop: '0.2mm' }}>
                  per {product.nutrition_basis === '100ml' ? '100 ml' : '100 g'} di prodotto
                </div>
              </div>
              {product.nutrition.kcal != null && (
                <div style={{ padding: '0.8mm 1.6mm', borderBottom: `0.3mm solid ${colors.primary}` }}>
                  <div style={{ fontSize: '1.4mm', fontWeight: 600, color: TEXT_DARK }}>Energia</div>
                  <span style={{ fontFamily: 'Georgia, serif', fontWeight: 800, fontSize: '3.8mm', color: colors.primary, lineHeight: 1 }}>
                    {product.nutrition.kcal}
                  </span>{' '}
                  <span style={{ fontSize: '1.4mm', color: TEXT_DARK }}>kcal</span>
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.4mm', color: TEXT_DARK }}>
                <tbody>
                  {NUTRITION_ROWS.filter((r) => product.nutrition?.[r.key] != null).map((r, i) => {
                    const subValue = r.subKey ? product.nutrition?.[r.subKey] : null;
                    const zebra = i % 2 === 1;
                    return (
                      <Fragment key={r.key}>
                        <tr style={{ background: zebra ? `${colors.secondary}22` : 'transparent' }}>
                          <td style={{ padding: '0.45mm 1.6mm' }}>{r.label}</td>
                          <td style={{ padding: '0.45mm 1.6mm', textAlign: 'right', fontWeight: 700 }}>{product.nutrition?.[r.key]} {r.unit}</td>
                        </tr>
                        {subValue != null && (
                          <tr style={{ background: zebra ? `${colors.secondary}22` : 'transparent' }}>
                            <td style={{ padding: '0 1.6mm 0.45mm 3mm', fontStyle: 'italic', opacity: 0.85 }}>{r.subLabel}</td>
                            <td style={{ padding: '0 1.6mm 0.45mm 1.6mm', textAlign: 'right' }}>{subValue} g</td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {/* Breve descrizione (ingredienti) — sotto la tabella, dentro lo stesso riquadro, come nell'esempio */}
              {product.ingredients_text && (
                <div style={{
                  borderTop: `0.25mm solid ${colors.primary}40`, background: `${colors.secondary}1a`,
                  padding: '1.1mm 1.6mm', fontSize: '1.4mm', lineHeight: 1.35, color: TEXT_DARK,
                }}>
                  <b>Ingredienti:</b> {product.ingredients_text}
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 'auto', paddingTop: '1.2mm', fontSize: '1.35mm', textAlign: 'center', color: '#555', lineHeight: 1.35 }}>
            {sections.allergens && product.allergens_text && (
              <div style={{ marginBottom: '0.5mm' }}><b>Allergeni:</b> {product.allergens_text}</div>
            )}
            {product.importer && (
              <div>Importato da: {product.importer.name}, {product.importer.legal_address}</div>
            )}
            <div style={{ fontWeight: 700, color: TEXT_DARK }}>
              Prodotto per: {tenant.legal_name}, {tenant.legal_address}
              {tenant.legal_email ? ` — ${tenant.legal_email}` : ''}
              {tenant.legal_website ? ` — ${tenant.legal_website}` : ''}
            </div>
            {barcodeSvg && (
              <div
                style={{ marginTop: '1mm', display: 'flex', justifyContent: 'center' }}
                dangerouslySetInnerHTML={{ __html: barcodeSvg }}
              />
            )}
            {product.packaging_material && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6mm', marginTop: '0.5mm' }}>
                <IconPackage size="2.2mm" style={{ color: NATURAL_BADGE_COLOR, flexShrink: 0 }} />
                {product.packaging_material}.{' '}
                <IconRecycle size="2.2mm" style={{ color: NATURAL_BADGE_COLOR, flexShrink: 0 }} />{' '}
                {product.recycling_note ?? 'Verificare le disposizioni del proprio comune.'}
              </div>
            )}
          </div>
        </div>

        {/* Colonna centrale — nome prodotto impilato */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', minWidth: 0, overflow: 'hidden' }}>
          {naturalBadge && (
            <div style={{ fontWeight: 800, letterSpacing: '0.04em', fontSize: '2.2mm', color: colors.primary }}>
              100% NATURALE
            </div>
          )}
          <div style={{
            fontFamily: 'Georgia, serif', fontWeight: 800, color: TEXT_DARK, marginTop: '1mm',
            fontSize: `clamp(3.2mm, ${48 / product.name.length}mm, 6mm)`, lineHeight: 1.02,
          }}>
            {product.name}
          </div>
          {product.name_alt && (
            <div style={{ fontWeight: 800, letterSpacing: '0.03em', color: colors.primary, fontSize: '2.6mm', marginTop: '1mm' }}>
              {product.name_alt.toUpperCase()}
            </div>
          )}
          <div style={{ width: '14%', height: '0.4mm', background: colors.primary, opacity: 0.4, margin: '1.5mm 0' }} />

          {showOrigin && originStyle === 'block' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1mm' }}>
              {originFlag && <FlagSwatch spec={originFlag} width="6mm" height="4mm" />}
              <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 700, fontSize: '2.2mm', color: colors.primary }}>
                Origine: {product.country_of_origin}
              </span>
            </div>
          )}
          {showOrigin && originStyle !== 'block' && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.8mm',
              border: `0.25mm solid ${colors.primary}`, borderRadius: '3mm',
              padding: '0.3mm 2mm 0.3mm 1.4mm', fontSize: '1.8mm', fontWeight: 700, color: colors.primary,
            }}>
              {originFlag && <FlagSwatch spec={originFlag} width="3mm" height="2mm" />}
              {product.country_of_origin}
            </div>
          )}

          <div style={{ flex: 1 }} />
          {netQty && (
            <div style={{
              fontWeight: 700, letterSpacing: '0.02em', color: TEXT_DARK, fontSize: '2.4mm', marginBottom: '1mm',
              fontFamily: '"DejaVu Sans", Arial, "Liberation Sans", sans-serif',
            }}>
              Peso Netto: {netQty} {'℮'}
            </div>
          )}
        </div>

        {/* Colonna destra — foto prodotto, striscia decorativa e QR */}
        <div style={{ position: 'relative', borderRadius: '1mm', overflow: 'hidden', minWidth: 0 }}>
          <div style={{
            position: 'absolute', inset: '0 6% 0 0',
            background: bg.type === 'color' ? bg.value : undefined,
            backgroundImage: bg.type === 'image' ? `url(${bg.url})` : undefined,
            backgroundSize: 'cover', backgroundPosition: 'center', borderRadius: '1mm',
          }} />

          {product.gluten_free_certified && (
            <div style={{
              position: 'absolute', top: '3%', left: '2%',
              background: 'rgba(255,255,255,0.92)', border: '0.2mm solid #666', borderRadius: '50%',
              width: '9mm', height: '9mm', display: 'flex', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', fontSize: '1.2mm', fontWeight: 700, color: TEXT_DARK,
            }}>
              SENZA GLUTINE
            </div>
          )}

          <div style={{
            position: 'absolute', left: '2%', right: '8%', bottom: '3mm',
            background: 'rgba(255,255,255,0.9)', borderRadius: '1mm',
            padding: '1mm 1.6mm', fontSize: '1.6mm', lineHeight: 1.35, color: '#2A2118',
            fontFamily: '"DejaVu Sans", Arial, "Liberation Sans", sans-serif',
          }}>
            <div>Lotto: {lotNumber}</div>
            {productionDate && <div>Produzione: {formatDateIT(productionDate)}</div>}
            <div>{durabilityLabel}: {formatDateIT(durabilityDate)}</div>
          </div>

          <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: '6%', background: kenteStripBackground(colors) }} />

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${process.env.NEXT_PUBLIC_STOREFRONT_URL}/api/card/qr-code?format=png&size=200`}
            alt=""
            style={{
              position: 'absolute', right: '1%', bottom: '3mm', width: '10mm', height: '10mm', zIndex: 3,
              background: '#fff', borderRadius: '0.6mm', padding: '0.6mm',
            }}
          />
        </div>

        {/* Rivendicazioni in basso a destra — uso e conservazione, sotto titolo e foto */}
        {hasClaims && (
          <div style={{ gridColumn: '2 / 4', textAlign: 'right', paddingTop: '1mm', paddingRight: '8%' }}>
            {sections.usage && product.usage_instructions && (
              <div style={{ fontWeight: 700, color: TEXT_DARK, fontSize: '2mm' }}>{product.usage_instructions}</div>
            )}
            {sections.conservation && product.conservation_instructions && (
              <div style={{ fontWeight: 800, color: TEXT_DARK, fontSize: '2mm', marginTop: '0.4mm' }}>
                {product.conservation_instructions.toUpperCase()}
                {product.conservation_after_opening && ` ${product.conservation_after_opening}`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
