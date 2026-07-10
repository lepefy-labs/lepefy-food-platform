import type { ProductLabelData, LabelSections } from '@lepefy/types';
import { resolveBackground, resolveAmbientColor } from '../resolveBackground';

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
        {/* Pannello sinistro — hero: foto prodotto o colore di fallback */}
        <div style={{
          background: bg.type === 'color' ? bg.value : undefined,
          backgroundImage: bg.type === 'image' ? `url(${bg.url})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3mm',
        }}>
          {tenant.label_logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={tenant.label_logo_url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          )}
        </div>

        {/* Colonna destra — sfondo trasparente: lascia vedere la tinta ambientale del contenitore */}
        <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', padding: '2mm 3mm' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2mm' }}>
            <div>
              <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: '5mm', color: tenant.primary_color }}>
                {product.name}
              </div>
              {sections.origin && product.country_of_origin && (
                <div style={{
                  display: 'inline-block', marginTop: '1.2mm',
                  border: `0.25mm solid ${tenant.secondary_color}`, borderRadius: '3mm',
                  padding: '0.5mm 2mm', fontSize: '2mm', fontWeight: 700, color: tenant.secondary_color,
                }}>
                  {product.country_of_origin}
                </div>
              )}
            </div>
            {sections.nutrition && product.nutrition && (
              <table style={{ borderCollapse: 'collapse', fontSize: '2mm', border: `0.2mm solid ${tenant.primary_color}` }}>
                <thead>
                  <tr>
                    <th colSpan={2} style={{ background: tenant.primary_color, color: '#fff', padding: '1mm', fontSize: '2.1mm' }}>
                      Valori Nutrizionali Medi ({product.nutrition_basis === '100ml' ? 'per 100 ml' : 'per 100 g'})
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {NUTRITION_ROWS.filter((r) => product.nutrition?.[r.key] != null).map((r) => (
                    <tr key={r.key}>
                      <td style={{ padding: '0.6mm 1.5mm', borderTop: '0.1mm solid #ddd' }}>{r.label}</td>
                      <td style={{ padding: '0.6mm 1.5mm', borderTop: '0.1mm solid #ddd', textAlign: 'right', fontWeight: 700 }}>
                        {product.nutrition?.[r.key]}{r.key === 'kcal' ? ' kcal' : r.key === 'kj' ? ' kJ' : ' g'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ fontSize: '2.2mm', lineHeight: 1.4, marginTop: '2mm' }}>
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

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: '2mm', marginTop: '2mm' }}>
            <div>
              {product.gluten_free_certified && (
                <div style={{ border: '0.2mm solid #666', borderRadius: '50%', width: '9mm', height: '9mm', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: '1.5mm', fontWeight: 700 }}>
                  GLUTEN FREE
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              {netQty && <div style={{ fontWeight: 700, fontSize: '2.6mm' }}>Peso Netto: {netQty} {'℮'}</div>}
              <div>Lotto: {lotNumber}</div>
              {productionDate && <div>Data di produzione: {productionDate}</div>}
              <div>{durabilityLabel}: {durabilityDate}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer legale — stessa tinta ambientale, separato da un filo colore secondario, ora nel flusso normale */}
      <div style={{
        background: ambient, borderTop: `0.3mm solid ${tenant.secondary_color}`,
        fontSize: '1.8mm', padding: '1.5mm 3mm', lineHeight: 1.5,
      }}>
        {product.producer && <div><b>Prodotto da:</b> {product.producer.name}, {product.producer.legal_address}</div>}
        {product.importer && <div><b>Importato da:</b> {product.importer.name}, {product.importer.legal_address}</div>}
        <div><b>Per:</b> {tenant.legal_name}, {tenant.legal_address} {tenant.legal_email ? `— ${tenant.legal_email}` : ''}</div>
        {product.packaging_material && (
          <div><b>Imballaggio:</b> {product.packaging_material}. {product.recycling_note ?? 'Verificare le disposizioni del proprio comune.'}</div>
        )}
      </div>
    </div>
  );
}
