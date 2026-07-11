import type { ProductLabelData, LabelSections } from '@lepefy/types';
import { resolveBackground } from '../resolveBackground';
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

interface FullBleedLabelTemplateProps {
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

const PANEL_BG = 'rgba(255,255,255,0.92)';
const TEXT_COLOR = '#2A2118';

export function FullBleedLabelTemplate({
  product, tenant, sections, labelWidthMm, labelHeightMm,
  lotNumber, productionDate, durabilityDate, durabilityLabel,
}: FullBleedLabelTemplateProps) {
  const bg = resolveBackground(product);
  const netQty = product.net_quantity_display ?? formatWeight(product.weight_grams);

  return (
    <div style={{
      width: `${labelWidthMm}mm`, height: `${labelHeightMm}mm`,
      display: 'grid', gridTemplateRows: '1fr auto',
      fontFamily: 'Arial, sans-serif', overflow: 'hidden', position: 'relative',
      border: '0.2mm solid #ddd',
      background: bg.type === 'color' ? bg.value : undefined,
      backgroundImage: bg.type === 'image' ? `url(${bg.url})` : undefined,
      backgroundSize: 'cover', backgroundPosition: 'center',
    }}>
      {/* Zona superiore: logo a sinistra, pannello dati a destra — entrambi sopra lo sfondo intero */}
      <div style={{ position: 'relative' }}>
        {tenant.label_logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tenant.label_logo_url}
            alt=""
            style={{
              position: 'absolute', top: '3mm', left: '3mm',
              maxWidth: '32%', maxHeight: '16mm', objectFit: 'contain',
              filter: bg.type === 'image' ? 'drop-shadow(0 0 2mm rgba(255,255,255,0.85))' : undefined,
            }}
          />
        )}

        <div style={{
          position: 'absolute', top: '3mm', right: '3mm', bottom: '3mm', width: '58%',
          background: PANEL_BG, borderRadius: '1.5mm', padding: '2.5mm',
          display: 'grid', gridTemplateRows: 'auto auto 1fr auto', overflow: 'hidden',
          color: TEXT_COLOR,
        }}>
          <div>
            <div style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700, fontSize: '4.6mm', color: TEXT_COLOR }}>
              {product.name}
            </div>
            {sections.origin && product.country_of_origin && (
              <div style={{ fontSize: '2.2mm', color: '#666', marginTop: '0.5mm' }}>
                Origine: {product.country_of_origin}
              </div>
            )}
          </div>

          {sections.nutrition && product.nutrition && (
            <table style={{ borderCollapse: 'collapse', fontSize: '2mm', width: '100%', marginTop: '1.5mm' }}>
              <thead>
                <tr>
                  <th colSpan={2} style={{ background: tenant.primary_color, color: '#fff', padding: '1mm', fontSize: '2.1mm', textAlign: 'left' }}>
                    Valori Nutrizionali Medi ({product.nutrition_basis === '100ml' ? 'per 100 ml' : 'per 100 g'})
                  </th>
                </tr>
              </thead>
              <tbody>
                {NUTRITION_ROWS.filter((r) => product.nutrition?.[r.key] != null).map((r) => (
                  <tr key={r.key}>
                    <td style={{ padding: '0.6mm 1.5mm', borderBottom: '0.15mm solid rgba(0,0,0,0.15)' }}>{r.label}</td>
                    <td style={{ padding: '0.6mm 1.5mm', borderBottom: '0.15mm solid rgba(0,0,0,0.15)', textAlign: 'right', fontWeight: 700 }}>
                      {product.nutrition?.[r.key]}{r.key === 'kcal' ? ' kcal' : r.key === 'kj' ? ' kJ' : ' g'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ fontSize: '2.1mm', lineHeight: 1.35, marginTop: '1.5mm', overflow: 'hidden' }}>
            {product.ingredients_text && (
              <div><b>Ingredienti:</b> {product.ingredients_text}</div>
            )}
            {sections.allergens && product.allergens_text && (
              <div style={{ marginTop: '1mm' }}><b>Allergeni:</b> {product.allergens_text}</div>
            )}
            {sections.usage && product.usage_instructions && (
              <div style={{ marginTop: '1mm' }}><b>Consigli d&apos;uso:</b> {product.usage_instructions}</div>
            )}
            {sections.conservation && product.conservation_instructions && (
              <div style={{ marginTop: '1mm' }}>
                <b>Conservazione:</b> {product.conservation_instructions}
                {product.conservation_after_opening && ` ${product.conservation_after_opening}`}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: '2mm', marginTop: '1mm' }}>
            <div>
              {product.gluten_free_certified && (
                <div style={{ border: '0.2mm solid #666', borderRadius: '50%', width: '9mm', height: '9mm', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: '1.5mm', fontWeight: 700 }}>
                  GLUTEN FREE
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              {netQty && <div style={{ fontWeight: 700, fontSize: '2.4mm' }}>Peso Netto: {netQty} {'℮'}</div>}
              <div>Lotto: {lotNumber}</div>
              {productionDate && <div>Data di produzione: {formatDateIT(productionDate)}</div>}
              <div>{durabilityLabel}: {formatDateIT(durabilityDate)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Pannello legale, in basso, largo tutta l'etichetta */}
      <div style={{
        margin: '0 3mm 3mm', background: PANEL_BG, borderRadius: '1.5mm',
        fontSize: '1.8mm', padding: '1.5mm 3mm', lineHeight: 1.5, color: TEXT_COLOR,
      }}>
        {product.producer && <div>Prodotto da: {product.producer.name}, {product.producer.legal_address}</div>}
        {product.importer && <div>Importato da: {product.importer.name}, {product.importer.legal_address}</div>}
        <div>Per: {tenant.legal_name}, {tenant.legal_address} {tenant.legal_email ? `— ${tenant.legal_email}` : ''}</div>
        {product.packaging_material && (
          <div>Imballaggio: {product.packaging_material}. {product.recycling_note ?? 'Verificare le disposizioni del proprio comune.'}</div>
        )}
      </div>
    </div>
  );
}
