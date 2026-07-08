import type { LabelLayout } from '@lepefy/types';

export function calculateLayout(params: {
  sheetWidthMm: number;
  sheetHeightMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  marginMm: number;
  gutterMm: number;
  quantity: number;
}): LabelLayout {
  const { sheetWidthMm, sheetHeightMm, labelWidthMm, labelHeightMm, marginMm, gutterMm, quantity } = params;

  const usableW = sheetWidthMm - 2 * marginMm;
  const usableH = sheetHeightMm - 2 * marginMm;

  const cols = Math.max(0, Math.floor((usableW + gutterMm) / (labelWidthMm + gutterMm)));
  const rows = Math.max(0, Math.floor((usableH + gutterMm) / (labelHeightMm + gutterMm)));
  const perSheet = cols * rows;

  if (perSheet === 0) {
    throw new Error(
      `Etichetta ${labelWidthMm}×${labelHeightMm}mm non entra nel foglio ${sheetWidthMm}×${sheetHeightMm}mm con margine ${marginMm}mm.`
    );
  }

  const sheets = Math.ceil(quantity / perSheet);

  return { cols, rows, perSheet, sheets };
}
