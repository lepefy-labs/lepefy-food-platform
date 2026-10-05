import { documentShell, escapeHtml } from './documentHtml';
import type { OrderDocumentFormat } from './formats';
import type { InternalOrderDocumentViewModel, PickingItemVM } from './viewModels';

/**
 * Liste de préparation (document interne équipe), A5 et A4 conçus séparément.
 * Une commande = une `<section class="doc">` (saut de page entre commandes).
 * Le `thead` du tableau se répète sur les pages suivantes : il porte la
 * référence de la commande et sert d'en-tête réduit de continuation.
 * Aucun texte informatif sous 10 pt ; cases dessinées de 6/7 mm.
 */

const STORAGE_LABEL: Record<NonNullable<PickingItemVM['storage']>, string> = {
  fresh: 'FRAIS',
  frozen: 'SURGELÉ',
};

const CSS = `
.pl-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 4mm; border-bottom: 0.6mm solid #111; padding-bottom: 2.5mm; margin-bottom: 2.5mm; }
.pl-title { font-weight: 900; letter-spacing: 0.08em; margin: 0; }
.pl-ref { font-family: 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace; font-weight: 700; letter-spacing: 0.02em; }
.pl-badge { display: inline-block; border: 0.4mm solid #111; font-weight: 700; letter-spacing: 0.06em; padding: 0.6mm 2mm; }
.pl-meta { line-height: 1.4; }
.pl-right { text-align: right; }
.pl-section { font-weight: 800; letter-spacing: 0.1em; margin: 3.5mm 0 1.5mm; }
table.pl-items { width: 100%; border-collapse: collapse; }
.pl-items thead th { text-align: left; font-weight: 700; letter-spacing: 0.06em; border-bottom: 0.4mm solid #111; padding: 1mm 1mm 1mm 0; }
.pl-items thead .pl-cont { font-weight: 400; letter-spacing: 0; }
.pl-items tbody tr { break-inside: avoid; page-break-inside: avoid; }
.pl-items td { border-bottom: 0.2mm solid #bbb; vertical-align: top; padding-right: 1.5mm; }
.pl-box { display: inline-block; border: 0.45mm solid #111; background: #fff; }
.pl-qty { font-weight: 800; white-space: nowrap; }
.pl-name { font-weight: 700; line-height: 1.25; }
.pl-alt { display: block; color: #333; }
.pl-chip { display: inline-block; border: 0.3mm solid #111; font-weight: 700; letter-spacing: 0.05em; padding: 0 1.2mm; margin-top: 0.8mm; }
.pl-loc { font-family: 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace; font-weight: 700; white-space: nowrap; }
.pl-loc-empty { color: #555; }
.pl-carton { border: 0.4mm dashed #111; padding: 2mm 2.5mm; line-height: 1.45; }
.pl-warn { font-weight: 700; }
.pl-summary { display: flex; flex-wrap: wrap; gap: 2mm 6mm; }
.pl-sign { display: flex; gap: 5mm; margin-top: 5mm; }
.pl-sign span { flex: 1; border-bottom: 0.3mm solid #111; padding-bottom: 6mm; }
.pl-notes { height: 24mm; background: repeating-linear-gradient(transparent 0 7.7mm, #999 7.7mm 8mm); }
.pl-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }

/* A5 : compact, une colonne d'information par ligne */
.format-a5 { font-size: 10.5pt; }
.format-a5 .pl-title { font-size: 12pt; }
.format-a5 .pl-ref { font-size: 18pt; }
.format-a5 .pl-badge { font-size: 10pt; }
.format-a5 .pl-section, .format-a5 .pl-items thead th { font-size: 10pt; }
.format-a5 .pl-items td { padding-top: 1.6mm; padding-bottom: 1.6mm; }
.format-a5 .pl-box { width: 6mm; height: 6mm; }
.format-a5 .pl-qty { font-size: 16pt; }
.format-a5 .pl-name { font-size: 11pt; }
.format-a5 .pl-alt, .format-a5 .pl-chip, .format-a5 .pl-meta, .format-a5 .pl-carton, .format-a5 .pl-sign { font-size: 10pt; }
.format-a5 .pl-loc { font-size: 11pt; }

/* A4 : lignes aérées, colonnes conservation/emplacement, notes */
.format-a4 { font-size: 11pt; }
.format-a4 .pl-title { font-size: 14pt; }
.format-a4 .pl-ref { font-size: 24pt; }
.format-a4 .pl-badge { font-size: 11pt; }
.format-a4 .pl-section, .format-a4 .pl-items thead th { font-size: 10pt; }
.format-a4 .pl-items td { padding-top: 2.6mm; padding-bottom: 2.6mm; vertical-align: middle; }
.format-a4 .pl-box { width: 7mm; height: 7mm; }
.format-a4 .pl-qty { font-size: 17pt; }
.format-a4 .pl-name { font-size: 12pt; }
.format-a4 .pl-alt, .format-a4 .pl-chip, .format-a4 .pl-meta, .format-a4 .pl-carton, .format-a4 .pl-sign { font-size: 10.5pt; }
.format-a4 .pl-loc { font-size: 12pt; }
`;

function storageChip(item: PickingItemVM): string {
  return item.storage ? `<span class="pl-chip">${STORAGE_LABEL[item.storage]}</span>` : '';
}

function location(item: PickingItemVM): string {
  return item.location ? `<span class="pl-loc">${escapeHtml(item.location)}</span>` : '<span class="pl-loc pl-loc-empty">—</span>';
}

function itemsTableA5(vm: InternalOrderDocumentViewModel): string {
  const rows = vm.items.map((item) => `<tr>
<td style="width:8mm"><span class="pl-box"></span></td>
<td style="width:14mm" class="pl-qty">×${item.quantity}</td>
<td><span class="pl-name">${escapeHtml(item.name)}</span>${item.nameAlt ? `<span class="pl-alt">↳ ${escapeHtml(item.nameAlt)}</span>` : ''}${item.storage ? `<div>${storageChip(item)}</div>` : ''}</td>
<td style="width:22mm;text-align:right">${location(item)}</td>
</tr>`).join('');
  return `<table class="pl-items"><thead><tr><th colspan="3">ARTICLES <span class="pl-cont">· #${escapeHtml(vm.ref)}</span></th><th style="text-align:right">EMPL.</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function itemsTableA4(vm: InternalOrderDocumentViewModel): string {
  const rows = vm.items.map((item) => `<tr>
<td style="width:10mm"><span class="pl-box"></span></td>
<td style="width:17mm" class="pl-qty">×${item.quantity}</td>
<td><span class="pl-name">${escapeHtml(item.name)}</span>${item.nameAlt ? `<span class="pl-alt">↳ ${escapeHtml(item.nameAlt)}</span>` : ''}</td>
<td style="width:26mm">${item.storage ? storageChip(item) : '<span class="pl-meta">Sec</span>'}</td>
<td style="width:26mm">${location(item)}</td>
</tr>`).join('');
  return `<table class="pl-items"><thead><tr><th>✓</th><th>QTÉ</th><th>ARTICLE <span class="pl-cont">· #${escapeHtml(vm.ref)}</span></th><th>CONSERV.</th><th>EMPL.</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function cartonBlock(vm: InternalOrderDocumentViewModel, format: OrderDocumentFormat): string {
  if (vm.fulfillment !== 'delivery' || !vm.cartons) return '';
  const c = vm.cartons;
  const detail = format === 'a4'
    ? c.parcels.map((p) => `<div><b>Colis ${p.index}</b> — ${escapeHtml(p.weight)} → ${p.carton ? `<b>${escapeHtml(p.carton)}</b> ${escapeHtml(p.dimensions ?? '')}` : 'aucun carton configuré pour ce poids'}</div>`).join('')
    : c.lines.map((l) => `<div><span class="pl-box" style="width:3.5mm;height:3.5mm;vertical-align:-0.5mm"></span> ${l.name
      ? `<b>${l.count} × ${escapeHtml(l.name)}</b> ${escapeHtml(l.dimensions ?? '')} · ${escapeHtml(l.weights)}`
      : `${l.count} colis (${escapeHtml(l.weights)}) : aucun carton configuré pour ce poids`}</div>`).join('');
  const alternatives = c.alternatives.length ? `<div>Si volumineux : ${escapeHtml(c.alternatives.join(', '))}</div>` : '';
  const footer = [`Poids total ${c.totalWeight}`, `${c.parcels.length} colis`, format === 'a4' ? c.maxParcelNote : null].filter(Boolean).join(' · ');
  const warning = vm.missingWeightLines > 0
    ? `<div class="pl-warn">${vm.missingWeightLines} ligne${vm.missingWeightLines > 1 ? 's' : ''} sans poids : vérifier</div>` : '';
  return `<div class="avoid"><div class="pl-section keep-next">EMBALLAGE SUGGÉRÉ</div><div class="pl-carton">${detail}${alternatives}<div>${escapeHtml(footer)}</div>${warning}</div></div>`;
}

function header(vm: InternalOrderDocumentViewModel): string {
  return `<div class="pl-head">
<div><p class="pl-title">LISTE DE PRÉPARATION</p><div class="pl-ref">#${escapeHtml(vm.ref)}</div></div>
<div class="pl-right"><span class="pl-badge">${vm.fulfillmentLabel}</span><div class="pl-meta" style="margin-top:1.5mm">${escapeHtml(vm.createdAt)}<br>${escapeHtml(vm.tenantName)}</div></div>
</div>`;
}

function summaryParts(vm: InternalOrderDocumentViewModel): string[] {
  return [
    `${vm.totalUnits} unité${vm.totalUnits > 1 ? 's' : ''}`,
    `${vm.referenceCount} réf.`,
    vm.weight,
    vm.parcelCount != null ? `${vm.parcelCount} colis` : null,
  ].filter((part): part is string => Boolean(part));
}

function customerLine(vm: InternalOrderDocumentViewModel): string {
  return `<b>${escapeHtml(vm.customerName)}</b> · ${vm.destination ? escapeHtml(vm.destination) : vm.fulfillment === 'pickup' ? 'Retrait en boutique' : 'Destination non renseignée'}`;
}

export function pickingListSectionHtml(vm: InternalOrderDocumentViewModel, format: OrderDocumentFormat): string {
  if (format === 'a4') {
    return `<section class="doc">
${header(vm)}
<div class="pl-grid2 pl-meta"><div><b>Client</b><br>${customerLine(vm)}</div><div><b>Résumé</b><br>${escapeHtml(summaryParts(vm).join(' · '))}</div></div>
<div class="pl-section keep-next">ARTICLES</div>
${itemsTableA4(vm)}
<div class="pl-grid2 avoid" style="margin-top:4mm">
<div>${cartonBlock(vm, format)}</div>
<div><div class="pl-section keep-next">NOTES DE PRÉPARATION</div><div class="pl-notes"></div></div>
</div>
<div class="pl-sign avoid"><span>Préparé par</span><span>Contrôlé par</span><span>Heure</span></div>
</section>`;
  }
  return `<section class="doc">
${header(vm)}
<div class="pl-meta">${customerLine(vm)}</div>
<div class="pl-section keep-next">${escapeHtml(summaryParts(vm).join(' · ').toUpperCase())}</div>
${itemsTableA5(vm)}
${cartonBlock(vm, format)}
<div class="pl-sign avoid"><span>Préparé par</span><span>Contrôlé par</span></div>
</section>`;
}

export function pickingListHtml(vms: InternalOrderDocumentViewModel[], format: OrderDocumentFormat): string {
  const title = vms.length === 1 ? `Liste de préparation #${vms[0]!.ref}` : `Listes de préparation (${vms.length})`;
  return documentShell({ format, title, css: CSS, body: vms.map((vm) => pickingListSectionHtml(vm, format)).join('\n') });
}
