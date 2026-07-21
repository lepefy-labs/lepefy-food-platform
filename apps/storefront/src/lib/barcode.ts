import bwipjs from 'bwip-js/node';
import type { SupabaseClient } from '@supabase/supabase-js';

export { formatBarcodeDisplay } from './barcodeFormat';

/**
 * Genera e salva un nuovo barcode EAN-13 per un prodotto, chiamando la
 * funzione atomica lato DB (garantisce univocità anche con richieste concorrenti).
 */
export async function assignBarcodeToProduct(
  supabase: SupabaseClient,
  tenantId: string,
  productId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('next_product_barcode', {
    p_tenant_id: tenantId,
  });
  if (error || !data) {
    throw new Error(error?.message ?? 'Génération du code-barres échouée');
  }

  const code = data as string;

  const { error: updateError } = await supabase
    .from('products')
    .update({ barcode_value: code, barcode_generated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('tenant_id', tenantId);

  if (updateError) throw new Error(updateError.message);

  return code;
}

/**
 * Renderizza un EAN-13 come stringa SVG, pronta per essere iniettata nel
 * template etichetta (Gotenberg converte l'HTML in PDF, l'SVG resta vettoriale).
 *
 * bwip-js si aspetta il corpo a 12 cifre e calcola/aggiunge da solo il check
 * digit finale — per questo passiamo solo i primi 12 caratteri, anche se in
 * DB il valore salvato è già a 13 cifre (serve per display/ricerca).
 */
export function renderBarcodeSVG(
  barcodeValue: string,
  opts?: { widthMm?: number },
): string {
  const body12 = barcodeValue.slice(0, 12);
  const svg = bwipjs.toSVG({
    bcid: 'ean13',
    text: body12,
    scale: 2,
    height: 11,
    includetext: true,
    textxalign: 'center',
  });

  // bwip-js emette solo il viewBox (senza width/height): iniettiamo una taglia
  // fisica in mm, altrimenti l'SVG si espande al 100% del contenitore etichetta.
  const widthMm = opts?.widthMm ?? 30;
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const vbWidth = parseFloat(viewBox?.[1] ?? '0');
  const vbHeight = parseFloat(viewBox?.[2] ?? '0');
  if (!vbWidth || !vbHeight) return svg;

  const heightMm = (vbHeight / vbWidth) * widthMm;
  return svg.replace('<svg ', `<svg width="${widthMm}mm" height="${heightMm.toFixed(2)}mm" `);
}
