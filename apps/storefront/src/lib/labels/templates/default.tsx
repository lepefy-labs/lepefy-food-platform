import type { ProductLabelData, LabelSections } from '@lepefy/types';
import { resolveBackground, resolveAmbientColor } from '../resolveBackground';
import { formatDateIT } from '../formatDate';

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

const NUTRITION_ROWS: Array<{ key: keyof NonNullable<ProductLabelData['nutrition']>; label: string }> = [
  { key: 'kcal', label: 'Energia (Energy)' },
  { key: 'kj', label: 'Valore energetico (kJ)' },
  { key: 'fat_g', label: 'Grassi (Fat)' },
  { key: 'saturated_fat_g', label: 'di cui saturi' },
  { key: 'carbs_g', label: 'Carboidrati (Carbohydrate)' },
  { key: 'sugars_g', label: 'di cui zuccheri' },
  { key: 'fiber_g', label: 'Fibre (Fiber)' },
  { key: 'protein_g', label: 'Proteine (Protein)' },
  { key: 'salt_g', label: 'Sale (Salt)' },
];

export function DefaultLabelTemplate({
  product, tenant, sections, labelWidthMm, labelHeightMm,
  lotNumber, productionDate, durabilityDate, durabilityLabel,
}: DefaultLabelTemplateProps) {
  const bg = resolveBackground(product);
  const ambient = resolveAmbientColor(product);
  const netQty = product.net_quantity_display ?? formatWeight(product.weight_grams);

  return (
    <div style={{
      width: `${labelWidthMm}mm`, height: `${labelHeightMm}mm`,
      display: 'grid', gridTemplateRows: '1fr auto',
      fontFamily: 'Arial, sans-serif', overflow: 'hidden', position: 'relative',
      border: '0.2mm solid #ddd', background: ambient,
    }}>
      {/* Riga superiore: pannello foto + colonna dati */}
      <div style={{ display: 'grid', gridTemplateColumns: '32% 68%', minHeight: 0, overflow: 'hidden' }}>
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

          {/* DejaVu Sans first: Liberation Sans's ℮ (U+212E) glyph renders as a bare "e" with no ring on Gotenberg's Linux Chromium */}
          <div style={{
            position: 'absolute', bottom: '2mm', left: '2mm', right: '2mm',
            background: 'rgba(255,255,255,0.88)', borderRadius: '1.5mm',
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
                fontSize: `clamp(3mm, ${65 / product.name.length}mm, 5.5mm)`, lineHeight: 1.05,
                color: tenant.primary_color,
              }}>
                {product.name}
              </div>
              {sections.origin && product.country_of_origin && (
                <div style={{
                  display: 'inline-block', marginTop: '1.2mm',
                  border: `0.25mm solid ${tenant.primary_color}`, borderRadius: '3mm',
                  padding: '0.5mm 2mm', fontSize: '2mm', fontWeight: 700, color: tenant.primary_color,
                }}>
                  {product.country_of_origin}
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
            <table style={{ borderCollapse: 'collapse', fontSize: '2mm', border: `0.2mm solid ${tenant.primary_color}`, width: '100%', marginTop: '1.5mm' }}>
              <thead>
                <tr>
                  <th colSpan={2} style={{ background: tenant.primary_color, color: '#fff', padding: '1mm', fontSize: '2.1mm' }}>
                    Valori Nutrizionali Medi ({product.nutrition_basis === '100ml' ? 'per 100 ml' : 'per 100 g'})
                  </th>
                </tr>
              </thead>
              <tbody>
                {NUTRITION_ROWS.filter((r) => product.nutrition?.[r.key] != null).map((r) => {
                  const isSubRow = r.key === 'saturated_fat_g' || r.key === 'sugars_g';
                  return (
                    <tr key={r.key}>
                      <td style={{
                        padding: '0.4mm 1.5mm',
                        paddingLeft: isSubRow ? '4mm' : '1.5mm',
                        fontStyle: isSubRow ? 'italic' : 'normal',
                        color: isSubRow ? '#555' : undefined,
                        borderTop: '0.1mm solid #ddd',
                      }}>{r.label}</td>
                      <td style={{
                        padding: '0.4mm 1.5mm',
                        fontStyle: isSubRow ? 'italic' : 'normal',
                        color: isSubRow ? '#555' : undefined,
                        borderTop: '0.1mm solid #ddd', textAlign: 'right', fontWeight: 700,
                      }}>
                        {product.nutrition?.[r.key]}{r.key === 'kcal' ? ' kcal' : r.key === 'kj' ? ' kJ' : ' g'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div style={{ fontSize: '2.2mm', lineHeight: 1.25, marginTop: '2mm' }}>
            {product.ingredients_text && (
              <div><b>Ingredienti:</b> {product.ingredients_text}</div>
            )}
            {sections.allergens && product.allergens_text && (
              <div style={{ marginTop: '0.7mm' }}><b>Allergeni:</b> {product.allergens_text}</div>
            )}
            {sections.usage && product.usage_instructions && (
              <div style={{ marginTop: '0.7mm' }}><b>Consigli d&apos;uso:</b> {product.usage_instructions}</div>
            )}
            {sections.conservation && product.conservation_instructions && (
              <div style={{ marginTop: '0.7mm' }}>
                <b>Conservazione:</b> {product.conservation_instructions}
                {product.conservation_after_opening && ` ${product.conservation_after_opening}`}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer legale — stessa tinta ambientale, separato da un filo colore primario, ora nel flusso normale */}
      <div style={{
        gridColumn: '1 / -1', background: ambient,
        borderTop: `0.3mm solid ${tenant.primary_color}`,
        padding: '1.5mm 3mm', display: 'flex', alignItems: 'flex-end',
        justifyContent: 'space-between', gap: '3mm',
      }}>
        <div style={{ fontSize: '1.8mm', lineHeight: 1.5 }}>
          {product.importer && (
            <div style={{ color: '#555' }}>Importato da: {product.importer.name}, {product.importer.legal_address}</div>
          )}
          <div style={{ fontWeight: 700, color: '#2A2118', marginTop: '0.5mm' }}>
            Per: {tenant.legal_name}, {tenant.legal_address} {tenant.legal_email ? `— ${tenant.legal_email}` : ''}
          </div>
          {product.packaging_material && (
            <div style={{ color: '#555' }}>Imballaggio: {product.packaging_material}. {product.recycling_note ?? 'Verificare le disposizioni del proprio comune.'}</div>
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
