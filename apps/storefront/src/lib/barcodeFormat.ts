/**
 * Formattazione barcode lato UI — modulo separato da barcode.ts perché
 * importabile dai Client Component senza trascinare bwip-js (build Node,
 * dipende da url/zlib/stream) nel bundle browser.
 */

/** Formattazione leggibile per UI admin: "2000 0000001 2" a gruppi. */
export function formatBarcodeDisplay(barcodeValue: string): string {
  if (barcodeValue.length !== 13) return barcodeValue;
  return `${barcodeValue.slice(0, 4)} ${barcodeValue.slice(4, 11)} ${barcodeValue.slice(11)}`;
}
