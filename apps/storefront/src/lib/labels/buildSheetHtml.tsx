import { renderToStaticMarkup } from 'react-dom/server.edge';
import { DefaultLabelTemplate } from './templates/default';
import { calculateLayout } from './calculateLayout';
import type { ProductLabelData, LabelSections, LabelSettings } from '@lepefy/types';

interface BuildSheetParams {
  product: ProductLabelData;
  tenant: {
    primary_color: string; secondary_color: string; label_logo_url: string | null;
    legal_name: string | null; legal_address: string | null; legal_email: string | null; legal_website: string | null;
  };
  sections: LabelSections;
  settings: Pick<LabelSettings, 'sheet_width_mm' | 'sheet_height_mm' | 'label_width_mm' | 'label_height_mm' | 'margin_mm' | 'gutter_mm' | 'crop_marks'>;
  lotNumber: string;
  productionDate: string | null;
  durabilityDate: string;
  durabilityLabel: string;
  quantity: number;
}

export function buildSheetHtml(params: BuildSheetParams): { html: string; layout: ReturnType<typeof calculateLayout> } {
  const { product, tenant, sections, settings, lotNumber, productionDate, durabilityDate, durabilityLabel, quantity } = params;

  const layout = calculateLayout({
    sheetWidthMm: settings.sheet_width_mm,
    sheetHeightMm: settings.sheet_height_mm,
    labelWidthMm: settings.label_width_mm,
    labelHeightMm: settings.label_height_mm,
    marginMm: settings.margin_mm,
    gutterMm: settings.gutter_mm,
    quantity,
  });

  const labelMarkup = renderToStaticMarkup(
    <DefaultLabelTemplate
      product={product} tenant={tenant} sections={sections}
      labelWidthMm={settings.label_width_mm} labelHeightMm={settings.label_height_mm}
      lotNumber={lotNumber} productionDate={productionDate}
      durabilityDate={durabilityDate} durabilityLabel={durabilityLabel}
    />
  );

  const pagesHtml: string[] = [];
  for (let sheet = 0; sheet < layout.sheets; sheet++) {
    const cells = Array.from({ length: layout.perSheet })
      .map(() => `<div class="label-cell">${labelMarkup}</div>`)
      .join('');
    pagesHtml.push(`<div class="sheet">${cells}</div>`);
  }

  const cropMarksCss = settings.crop_marks
    ? `.label-cell { outline: 0.1mm dashed #999; outline-offset: 1mm; }`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
<style>
  @page { size: ${settings.sheet_width_mm}mm ${settings.sheet_height_mm}mm; margin: ${settings.margin_mm}mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; }
  .sheet {
    display: grid;
    grid-template-columns: repeat(${layout.cols}, ${settings.label_width_mm}mm);
    grid-template-rows: repeat(${layout.rows}, ${settings.label_height_mm}mm);
    gap: ${settings.gutter_mm}mm;
    page-break-after: always;
  }
  ${cropMarksCss}
</style></head><body>${pagesHtml.join('')}</body></html>`;

  return { html, layout };
}
