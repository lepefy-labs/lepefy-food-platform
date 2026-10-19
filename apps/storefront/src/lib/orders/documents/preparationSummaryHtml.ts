import { documentShell, escapeHtml } from './documentHtml';
import type { OrderDocumentFormat } from './formats';
import type { PreparationSummaryVM, SummaryLineVM } from '@/lib/orders/preparation/preparationSummary';

/**
 * Liste groupée (document interne, en plus des listes individuelles) : une
 * ligne par article avec la quantité totale et sa répartition par commande,
 * secs → frais → surgelés, puis l'index des commandes de la session.
 * Mêmes règles typographiques que la liste de préparation (≥ 10 pt, cases).
 */

const CSS = `
.ps-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 4mm; border-bottom: 0.6mm solid #111; padding-bottom: 2mm; margin-bottom: 2mm; }
.ps-title { font-weight: 900; letter-spacing: 0.08em; margin: 0; }
.ps-meta { line-height: 1.4; }
.ps-right { text-align: right; }
.ps-section { font-weight: 800; letter-spacing: 0.1em; margin: 3mm 0 1mm; border-bottom: 0.3mm solid #111; padding-bottom: 0.6mm; }
.ps-hint { font-weight: 400; letter-spacing: 0; }
table.ps-items { width: 100%; border-collapse: collapse; }
.ps-items tbody tr { break-inside: avoid; page-break-inside: avoid; }
.ps-items td { border-bottom: 0.2mm solid #bbb; vertical-align: top; padding: 1.2mm 1.5mm 1.2mm 0; }
.ps-box { display: inline-block; border: 0.45mm solid #111; background: #fff; width: 6mm; height: 6mm; }
.ps-qty { font-weight: 800; white-space: nowrap; }
.ps-name { font-weight: 700; line-height: 1.25; }
.ps-alt { display: block; color: #333; }
.ps-split { display: block; font-family: 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace; }
.ps-loc { font-family: 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace; font-weight: 700; white-space: nowrap; }
.ps-check { display: inline-block; border: 0.3mm solid #111; font-weight: 700; padding: 0 1.2mm; margin-top: 0.6mm; }
.ps-orders td { border-bottom: 0.2mm solid #bbb; padding: 1mm 1.5mm 1mm 0; vertical-align: top; }
.ps-ref { font-family: 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace; font-weight: 700; }
.format-a5 { font-size: 10.5pt; }
.format-a5 .ps-title { font-size: 12pt; }
.format-a5 .ps-qty { font-size: 15pt; }
.format-a5 .ps-name { font-size: 11pt; }
.format-a5 .ps-alt, .format-a5 .ps-split, .format-a5 .ps-meta, .format-a5 .ps-section, .format-a5 .ps-check, .format-a5 .ps-orders { font-size: 10pt; }
.format-a4 { font-size: 11pt; }
.format-a4 .ps-title { font-size: 14pt; }
.format-a4 .ps-qty { font-size: 17pt; }
.format-a4 .ps-name { font-size: 12pt; }
.format-a4 .ps-box { width: 7mm; height: 7mm; }
.format-a4 .ps-items td { padding-top: 2mm; padding-bottom: 2mm; }
.format-a4 .ps-alt, .format-a4 .ps-split, .format-a4 .ps-meta, .format-a4 .ps-section, .format-a4 .ps-check, .format-a4 .ps-orders { font-size: 10.5pt; }
`;

function lineRow(line: SummaryLineVM): string {
  const split = line.perOrder.map((entry) => `${escapeHtml(entry.ref)} ×${entry.quantity}`).join(' · ');
  return `<tr>
<td style="width:8mm"><span class="ps-box"></span></td>
<td style="width:14mm" class="ps-qty">×${line.total}</td>
<td><span class="ps-name">${escapeHtml(line.name)}</span>${line.nameAlt ? `<span class="ps-alt">↳ ${escapeHtml(line.nameAlt)}</span>` : ''}${line.catalogueWeight ? `<span class="ps-alt">Poids catalogue : ${escapeHtml(line.catalogueWeight)}</span>` : ''}<span class="ps-split">${split}</span>${line.check ? `<span class="ps-check">À VÉRIFIER : ${escapeHtml(line.check)}</span>` : ''}</td>
<td style="width:20mm;text-align:right">${line.location ? `<span class="ps-loc">${escapeHtml(line.location)}</span>` : '<span class="ps-loc">—</span>'}</td>
</tr>`;
}

export function preparationSummaryHtml(vm: PreparationSummaryVM, format: OrderDocumentFormat, meta: { tenantName: string; generatedAt: string }): string {
  const groups = vm.groups.map((group) => `<div class="ps-section keep-next">${escapeHtml(group.label.toUpperCase())}${group.hint ? ` <span class="ps-hint">— ${escapeHtml(group.hint)}</span>` : ''}</div>
<table class="ps-items"><tbody>${group.lines.map(lineRow).join('')}</tbody></table>`).join('\n');
  const orders = vm.orders.map((order) => `<tr><td class="ps-ref">${escapeHtml(order.ref)}</td><td>${escapeHtml(order.customerName)}</td><td>${escapeHtml(order.fulfillmentLabel)}${order.destination ? ` · ${escapeHtml(order.destination)}` : ''}</td><td style="text-align:right">${order.units} u.${order.cold ? ' · froid' : ''}</td></tr>`).join('');
  const body = `<section class="doc">
<div class="ps-head">
<div><p class="ps-title">LISTE GROUPÉE · ${vm.orderCount} COMMANDE${vm.orderCount > 1 ? 'S' : ''}</p><div class="ps-meta">${vm.totalUnits} unités · ${vm.referenceCount} réf.</div></div>
<div class="ps-right ps-meta">${escapeHtml(meta.generatedAt)}<br>${escapeHtml(meta.tenantName)}</div>
</div>
${groups}
<div class="ps-section keep-next">COMMANDES DE LA SESSION</div>
<table class="ps-orders" style="width:100%;border-collapse:collapse"><tbody>${orders}</tbody></table>
</section>`;
  return documentShell({ format, title: `Liste groupée (${vm.orderCount} commandes)`, css: CSS, body });
}
