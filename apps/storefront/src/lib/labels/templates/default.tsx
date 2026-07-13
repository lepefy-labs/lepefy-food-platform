import { IconPackage } from '@tabler/icons-react';
import type { ProductLabelData, LabelSections, LabelPaletteKey, LabelOriginStyleKey } from '@lepefy/types';
import { resolveBackground, resolveAmbientColor } from '../resolveBackground';
import { formatDateIT } from '../formatDate';
import { LABEL_PALETTES, NATURAL_BADGE_COLOR, ambientWashBackground, footerWashBackground, kenteStripBackground } from '../palettes';
import { resolveOriginFlag, FlagSwatch } from '../originFlags';

interface TenantLabelProps {
  primary_color: string;
  secondary_color: string;
  label_logo_url: string | null;
  legal_name: string | null;
  legal_address: string | null;
  legal_email: string | null;
  legal_website: string | null;
}

interface DefaultLabelTemplateProps {
  product: ProductLabelData;
  tenant: TenantLabelProps;
  palette: LabelPaletteKey;
  naturalBadge: boolean;
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
  { key: 'kcal', label: 'Energia (Energy)', unit: 'kcal' },
  { key: 'kj', label: 'Valore energetico (kJ)', unit: 'kJ' },
  { key: 'fat_g', label: 'Grassi (Fat)', unit: 'g', subKey: 'saturated_fat_g', subLabel: 'di cui saturi' },
  { key: 'carbs_g', label: 'Carboidrati (Carbohydrate)', unit: 'g', subKey: 'sugars_g', subLabel: 'di cui zuccheri' },
  { key: 'fiber_g', label: 'Fibre (Fiber)', unit: 'g' },
  { key: 'protein_g', label: 'Proteine (Protein)', unit: 'g' },
  { key: 'salt_g', label: 'Sale (Salt)', unit: 'g' },
];

export function DefaultLabelTemplate({
  product, tenant, palette, naturalBadge, originStyle, sections, labelWidthMm, labelHeightMm,
  lotNumber, productionDate, durabilityDate, durabilityLabel,
}: DefaultLabelTemplateProps) {
  const colors = LABEL_PALETTES[palette];
  const bg = resolveBackground(product, colors.ambient);
  const ambient = resolveAmbientColor(product, colors.ambient);
  const netQty = product.net_quantity_display ?? formatWeight(product.weight_grams);
  const showOrigin = sections.origin && !!product.country_of_origin;
  const originFlag = showOrigin ? resolveOriginFlag(product.country_of_origin) : null;

  return (
    <div style={{
      width: `${labelWidthMm}mm`, height: `${labelHeightMm}mm`,
      display: 'grid', gridTemplateRows: '1fr auto auto',
      fontFamily: 'Arial, sans-serif', overflow: 'hidden', position: 'relative',
      border: '0.2mm solid #ddd', background: ambientWashBackground(ambient),
    }}>
      {/* Riga superiore: pannello foto + colonna dati */}
      <div style={{ display: 'grid', gridTemplateColumns: '40% 60%', minHeight: 0, overflow: 'hidden' }}>
        {/* Pannello sinistro — hero: foto prodotto o colore di fallback, logo come badge d'angolo */}
        <div style={{
          background: bg.type === 'color' ? bg.value : undefined,
          backgroundImage: bg.type === 'image' ? `url(${bg.url})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
          position: 'relative', overflow: 'hidden',
        }}>
          {tenant.label_logo_url && (
            <div style={{
              position: 'absolute', top: '2mm', left: '2mm',
              background: 'rgba(255,255,255,0.85)', borderRadius: '1.5mm',
              padding: '1mm', maxWidth: '20mm', maxHeight: '14mm',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tenant.label_logo_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            </div>
          )}

          {naturalBadge && (
            <div style={{
              position: 'absolute', top: '2mm', right: '2mm',
              width: '9mm', height: '9mm', borderRadius: '50%',
              background: NATURAL_BADGE_COLOR, border: '0.3mm solid rgba(255,255,255,0.9)',
              boxShadow: '0 0.3mm 0.8mm rgba(0,0,0,0.25)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              color: '#fff', textAlign: 'center', lineHeight: 1.05,
            }}>
              <span style={{ fontSize: '2.1mm', fontWeight: 800 }}>100%</span>
              <span style={{ fontSize: '1.3mm', fontWeight: 700, letterSpacing: '0.02em' }}>NATURALE</span>
            </div>
          )}

          {originStyle === 'medallion' && showOrigin && originFlag && (
            <div style={{
              position: 'absolute', top: '50%', right: '2mm', transform: 'translateY(-50%)',
              width: '9mm', height: '9mm', borderRadius: '50%',
              background: colors.primary, border: '0.3mm solid rgba(255,255,255,0.9)',
              boxShadow: '0 0.3mm 0.8mm rgba(0,0,0,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                <path id="originArcPath" d="M 15,55 A 35,35 0 1 1 85,55" fill="none" />
                <text fontSize="9" fontWeight={700} letterSpacing="0.3" fill="#fff">
                  <textPath href="#originArcPath" startOffset="50%" textAnchor="middle">
                    PRODOTTO IN {product.country_of_origin?.toUpperCase()}
                  </textPath>
                </text>
              </svg>
              <FlagSwatch spec={originFlag} width="4.2mm" height="2.8mm" style={{ boxShadow: '0 0 0 0.15mm rgba(255,255,255,.8)' }} />
            </div>
          )}

          {/* DejaVu Sans first: Liberation Sans's ℮ (U+212E) glyph renders as a bare "e" with no ring on Gotenberg's Linux Chromium */}
          <div style={{
            position: 'absolute', bottom: '2mm', left: '2mm', right: '2mm',
            background: 'rgba(255,255,255,0.9)', borderRadius: '1.5mm',
            border: `0.15mm solid ${colors.primary}30`, boxShadow: '0 0.3mm 0.8mm rgba(0,0,0,0.1)',
            padding: '1.2mm 2mm', fontSize: '1.9mm', lineHeight: 1.3, color: '#2A2118',
            fontFamily: '"DejaVu Sans", Arial, "Liberation Sans", sans-serif',
          }}>
            {netQty && <div style={{ fontWeight: 700 }}>Peso Netto: {netQty} {'℮'}</div>}
            <div>Lotto: {lotNumber}</div>
            {productionDate && <div>Produzione: {formatDateIT(productionDate)}</div>}
            <div>{durabilityLabel}: {formatDateIT(durabilityDate)}</div>
          </div>
        </div>

        {/* Colonna destra — sfondo trasparente: lascia vedere la tinta ambientale del contenitore */}
        <div style={{ display: 'grid', gridTemplateRows: 'auto auto 1fr', padding: '2mm 3mm' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2mm' }}>
            <div>
              <div style={{
                fontFamily: 'Georgia, serif', fontWeight: 700,
                fontSize: `clamp(3.5mm, ${78 / product.name.length}mm, ${product.name_alt ? 5.8 : 6.5}mm)`, lineHeight: 1.05,
                color: colors.primary,
              }}>
                {product.name}
              </div>
              {product.name_alt && (
                <div style={{
                  fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 400,
                  color: '#6b7280', fontSize: '2.4mm', lineHeight: 1.15, marginTop: '0.2mm',
                }}>
                  {product.name_alt}
                </div>
              )}
              <div style={{ width: '10mm', height: '0.5mm', background: colors.secondary, borderRadius: '0.25mm', marginTop: '0.6mm' }} />
              {showOrigin && originStyle === 'pill' && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.8mm', marginTop: '0.8mm',
                  border: `0.25mm solid ${colors.primary}`, borderRadius: '3mm',
                  padding: '0.3mm 2mm 0.3mm 1.4mm', fontSize: '2mm', fontWeight: 700, color: colors.primary,
                }}>
                  {originFlag && <FlagSwatch spec={originFlag} width="3.2mm" height="2.1mm" />}
                  {product.country_of_origin}
                </div>
              )}
              {showOrigin && originStyle === 'block' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.2mm', marginTop: '1mm' }}>
                  {originFlag && <FlagSwatch spec={originFlag} width="7.5mm" height="5mm" />}
                  <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 700, fontSize: '2.6mm', color: colors.primary }}>
                    Origine: {product.country_of_origin}
                  </span>
                </div>
              )}
            </div>
            {product.gluten_free_certified && (
              <div style={{
                border: '0.2mm solid #666', borderRadius: '50%', width: '8mm', height: '8mm',
                display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
                fontSize: '1.3mm', fontWeight: 700, marginLeft: 'auto',
              }}>
                GLUTEN FREE
              </div>
            )}
          </div>

          {sections.nutrition && product.nutrition && (
            <div style={{
              marginTop: '0.8mm', borderRadius: '1.5mm', overflow: 'hidden',
              border: `0.15mm solid ${colors.primary}30`, boxShadow: '0 0.3mm 0.8mm rgba(0,0,0,0.06)',
            }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '1.8mm', width: '100%' }}>
                <thead>
                  <tr>
                    <th colSpan={2} style={{ background: colors.primary, color: '#fff', padding: '0.7mm 2mm', fontSize: '1.9mm', textAlign: 'left' }}>
                      Valori Nutrizionali Medi ({product.nutrition_basis === '100ml' ? 'per 100 ml' : 'per 100 g'})
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {NUTRITION_ROWS.filter((r) => product.nutrition?.[r.key] != null).map((r, i) => {
                    const subValue = r.subKey ? product.nutrition?.[r.subKey] : null;
                    const zebra = i % 2 === 1;
                    return (
                      <tr key={r.key} style={{ background: zebra ? `${colors.secondary}22` : 'transparent' }}>
                        <td style={{ padding: '0.3mm 2mm' }}>
                          {r.label}
                          {subValue != null && (
                            <div style={{ fontSize: '1.5mm', fontStyle: 'italic', color: '#555' }}>{r.subLabel}</div>
                          )}
                        </td>
                        <td style={{ padding: '0.3mm 2mm', textAlign: 'right', fontWeight: 700 }}>
                          {product.nutrition?.[r.key]} {r.unit}
                          {subValue != null && (
                            <div style={{ fontSize: '1.5mm', fontStyle: 'italic', color: '#555', fontWeight: 400 }}>{subValue} g</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ fontSize: '2mm', lineHeight: 1.15, marginTop: '1mm' }}>
            {product.ingredients_text && (
              <div><b>Ingredienti:</b> {product.ingredients_text}</div>
            )}
            {sections.allergens && product.allergens_text && (
              <div style={{ marginTop: '0.4mm' }}><b>Allergeni:</b> {product.allergens_text}</div>
            )}
            {sections.usage && product.usage_instructions && (
              <div style={{ marginTop: '0.4mm' }}><b>Consigli d&apos;uso:</b> {product.usage_instructions}</div>
            )}
            {sections.conservation && product.conservation_instructions && (
              <div style={{ marginTop: '0.4mm' }}>
                <b>Conservazione:</b> {product.conservation_instructions}
                {product.conservation_after_opening && ` ${product.conservation_after_opening}`}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fascia decorativa a kente — divisore tra corpo e footer legale */}
      <div style={{ gridColumn: '1 / -1', height: '2mm', background: kenteStripBackground(colors) }} />

      {/* Footer legale — stessa tinta ambientale */}
      <div style={{
        gridColumn: '1 / -1', background: footerWashBackground(ambient),
        padding: '1.5mm 3mm', display: 'flex', alignItems: 'flex-end',
        justifyContent: 'space-between', gap: '3mm',
      }}>
        <div style={{ fontSize: '1.8mm', lineHeight: 1.5 }}>
          {product.importer && (
            <div style={{ color: '#555' }}>Importato da: {product.importer.name}, {product.importer.legal_address}</div>
          )}
          <div style={{ fontWeight: 700, color: '#2A2118', marginTop: '0.5mm' }}>
            Per: {tenant.legal_name}, {tenant.legal_address}
            {tenant.legal_email ? ` — ${tenant.legal_email}` : ''}
            {tenant.legal_website ? ` — ${tenant.legal_website}` : ''}
          </div>
          {product.packaging_material && (
            <div style={{ color: '#555', display: 'flex', alignItems: 'center', gap: '0.8mm' }}>
              <IconPackage size="2.6mm" style={{ color: NATURAL_BADGE_COLOR, flexShrink: 0 }} />
              {product.packaging_material}. {product.recycling_note ?? 'Verificare le disposizioni del proprio comune.'}
            </div>
          )}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${process.env.NEXT_PUBLIC_STOREFRONT_URL}/api/card/qr-code?format=png&size=200`}
          alt=""
          style={{ width: '12mm', height: '12mm', flexShrink: 0 }}
        />
      </div>
    </div>
  );
}
