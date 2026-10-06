import { documentShell, escapeAttr, escapeHtml } from './documentHtml';
import type { OrderDocumentFormat } from './formats';
import type { CustomerOrderDocumentViewModel } from './viewModels';

/**
 * Bon de colis (récapitulatif client glissé dans le colis). Renderer distinct
 * de la liste de préparation : il ne reçoit que le view-model client assaini.
 * Couleur de marque avec parcimonie (bandeau + titre lisible), mise en page
 * neutre sans logo ni couleur.
 */

const CSS = `
.ps { position: relative; padding-top: 4mm; }
.ps-band { height: 2mm; margin-bottom: 4mm; }
.ps-head { display: flex; justify-content: space-between; align-items: center; gap: 4mm; }
.ps-brand { display: flex; align-items: center; gap: 2.5mm; font-weight: 800; }
.ps-logo { max-height: 14mm; max-width: 45mm; object-fit: contain; }
.ps-kicker { font-weight: 700; letter-spacing: 0.1em; color: #333; text-align: right; }
.ps-merci { font-weight: 800; margin: 5mm 0 1mm; }
.ps-meta { color: #222; }
.ps-section { font-weight: 800; letter-spacing: 0.1em; margin: 5mm 0 1.5mm; }
table.ps-items { width: 100%; border-collapse: collapse; }
.ps-items td { border-bottom: 0.2mm solid #ccc; padding: 1.6mm 1.5mm 1.6mm 0; vertical-align: top; }
.ps-items tr { break-inside: avoid; page-break-inside: avoid; }
.ps-qty { font-weight: 700; white-space: nowrap; width: 12mm; }
.ps-alt { display: block; color: #444; }
.ps-price { text-align: right; white-space: nowrap; }
.ps-totals { margin-top: 2mm; margin-left: auto; width: 60%; border-collapse: collapse; }
.ps-totals td { padding: 0.8mm 0; }
.ps-totals td:last-child { text-align: right; white-space: nowrap; }
.ps-totals .ps-total td { border-top: 0.3mm solid #111; font-weight: 800; padding-top: 1.5mm; }
.ps-qr { display: flex; gap: 4mm; align-items: center; border: 0.4mm solid #111; border-radius: 2mm; padding: 3mm; margin-top: 5mm; }
.ps-qr-code { flex: none; background: #fff; }
.ps-qr-code svg { width: 100%; height: 100%; display: block; }
.ps-qr-text b { display: block; }
.ps-url { font-family: 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace; overflow-wrap: anywhere; margin-top: 1.5mm; color: #222; }
.ps-url-token { white-space: nowrap; }
.ps-address { line-height: 1.4; }
.ps-thanks { margin-top: 5mm; color: #222; line-height: 1.45; }
.ps-contact { margin-top: 5mm; border-top: 0.2mm solid #999; padding-top: 2mm; display: flex; flex-wrap: wrap; gap: 1mm 6mm; color: #333; }

.format-a5 { font-size: 10.5pt; }
.format-a5 .ps-brand { font-size: 13pt; }
.format-a5 .ps-kicker, .format-a5 .ps-section { font-size: 10pt; }
.format-a5 .ps-merci { font-size: 19pt; }
.format-a5 .ps-qr-code { width: 32mm; height: 32mm; }
.format-a5 .ps-qr-text b { font-size: 11pt; }
.format-a5 .ps-url, .format-a5 .ps-contact, .format-a5 .ps-alt { font-size: 10pt; }

.format-a4 { font-size: 11.5pt; }
.format-a4 .ps-brand { font-size: 16pt; }
.format-a4 .ps-kicker, .format-a4 .ps-section { font-size: 10.5pt; }
.format-a4 .ps-merci { font-size: 24pt; }
.format-a4 .ps-items td { padding-top: 2.4mm; padding-bottom: 2.4mm; }
.format-a4 .ps-qr-code { width: 38mm; height: 38mm; }
.format-a4 .ps-qr-text b { font-size: 12.5pt; }
.format-a4 .ps-url, .format-a4 .ps-contact, .format-a4 .ps-alt { font-size: 10.5pt; }
.format-a4 .ps-logo { max-height: 18mm; max-width: 60mm; }
`;

function brand(vm: CustomerOrderDocumentViewModel): string {
  const name = `<span style="color:${escapeAttr(vm.tenant.textColor)}">${escapeHtml(vm.tenant.name)}</span>`;
  return vm.tenant.logoUrl
    ? `<span class="ps-brand"><img class="ps-logo" src="${escapeAttr(vm.tenant.logoUrl)}" alt="${escapeAttr(vm.tenant.name)}"></span>`
    : `<span class="ps-brand">${name}</span>`;
}

function itemsTable(vm: CustomerOrderDocumentViewModel): string {
  const rows = vm.items.map((item) => `<tr>
<td class="ps-qty">${item.quantity} ×</td>
<td>${escapeHtml(item.name)}${item.nameAlt ? `<span class="ps-alt">${escapeHtml(item.nameAlt)}</span>` : ''}</td>
${vm.prices ? `<td class="ps-price">${escapeHtml(item.lineTotal ?? '')}</td>` : ''}
</tr>`).join('');
  return `<table class="ps-items"><tbody>${rows}</tbody></table>`;
}

function totals(vm: CustomerOrderDocumentViewModel): string {
  if (!vm.prices) return `<div class="ps-meta" style="margin-top:1.5mm">${vm.totalUnits} article${vm.totalUnits > 1 ? 's' : ''}</div>`;
  const lines = vm.prices.lines.map((line) => `<tr><td>${escapeHtml(line.label)}</td><td>${escapeHtml(line.value)}</td></tr>`).join('');
  return `<div class="ps-meta" style="margin-top:1.5mm">${vm.totalUnits} article${vm.totalUnits > 1 ? 's' : ''}</div>
<table class="ps-totals avoid"><tbody>${lines}<tr class="ps-total"><td>Total</td><td>${escapeHtml(vm.prices.total)}</td></tr></tbody></table>`;
}

/**
 * URL imprimée sous le QR : le retour à la ligne éventuel se fait après « /o/ »,
 * jamais à l'intérieur du jeton (recopie manuelle sans erreur).
 */
export function displayUrlHtml(displayUrl: string): string {
  const cut = displayUrl.lastIndexOf('/o/');
  if (cut < 0) return escapeHtml(displayUrl);
  const prefix = displayUrl.slice(0, cut + 3);
  const token = displayUrl.slice(cut + 3);
  return `${escapeHtml(prefix)}<wbr><span class="ps-url-token">${escapeHtml(token)}</span>`;
}

function qrBlock(vm: CustomerOrderDocumentViewModel): string {
  if (!vm.qr) return '';
  return `<div class="ps-qr avoid">
<div class="ps-qr-code" role="img" aria-label="QR code de suivi de commande">${vm.qr.svg}</div>
<div class="ps-qr-text"><b>Scannez pour suivre votre commande, obtenir de l’aide ou commander à nouveau.</b>
<div class="ps-url">${displayUrlHtml(vm.qr.displayUrl)}</div></div>
</div>`;
}

function contactBlock(vm: CustomerOrderDocumentViewModel): string {
  const parts = [
    vm.contact?.website ?? null,
    vm.contact?.whatsapp ? `WhatsApp ${vm.contact.whatsapp}` : null,
    vm.contact?.email ?? null,
    vm.appNotice,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? `<div class="ps-contact avoid">${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join('')}</div>` : '';
}

export function packingSlipSectionHtml(vm: CustomerOrderDocumentViewModel): string {
  return `<section class="doc ps">
<div class="ps-band" style="background:${escapeAttr(vm.tenant.bandColor)}"></div>
<div class="ps-head">${brand(vm)}<span class="ps-kicker">RÉCAPITULATIF DE COMMANDE</span></div>
<div class="ps-merci">${escapeHtml(vm.greeting)}</div>
<div class="ps-meta">Commande <b>#${escapeHtml(vm.ref)}</b> du ${escapeHtml(vm.date)}</div>
<div class="ps-section keep-next">VOTRE COLIS CONTIENT</div>
${itemsTable(vm)}
${totals(vm)}
${vm.deliveryAddress ? `<div class="avoid"><div class="ps-section keep-next">LIVRAISON</div><div class="ps-address">${vm.deliveryAddress.map(escapeHtml).join('<br>')}</div></div>` : ''}
${qrBlock(vm)}
${vm.thankYou ? `<p class="ps-thanks avoid">${escapeHtml(vm.thankYou)}</p>` : ''}
${contactBlock(vm)}
</section>`;
}

export function packingSlipHtml(vms: CustomerOrderDocumentViewModel[], format: OrderDocumentFormat): string {
  const title = vms.length === 1 ? `Récapitulatif de commande #${vms[0]!.ref}` : `Bons de colis (${vms.length})`;
  return documentShell({ format, title, css: CSS, body: vms.map(packingSlipSectionHtml).join('\n') });
}
