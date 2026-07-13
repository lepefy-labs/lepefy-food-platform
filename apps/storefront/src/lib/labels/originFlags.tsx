import type { CSSProperties } from 'react';

export interface FlagSpec {
  orientation: 'vertical' | 'horizontal';
  bands: string[];
  star?: { color: string };
}

/**
 * Bandiere semplici (bande + eventuale stella centrale) per i paesi d'origine più comuni nel catalogo.
 * Disegnate come geometria, non emoji: le bandiere-emoji richiedono un font a colori che i container
 * headless-Chromium di Gotenberg spesso non hanno, con rischio di non renderizzare in PDF.
 * Paesi non presenti qui restano senza bandiera — l'origine resta comunque leggibile come testo.
 */
const ORIGIN_FLAGS: Record<string, FlagSpec> = {
  camerun: { orientation: 'vertical', bands: ['#007A5E', '#CE1126', '#FCD116'], star: { color: '#FCD116' } },
  senegal: { orientation: 'vertical', bands: ['#00853F', '#FDEF42', '#E31B23'], star: { color: '#00853F' } },
  ghana: { orientation: 'horizontal', bands: ['#CE1126', '#FCD116', '#006B3F'], star: { color: '#000000' } },
  nigeria: { orientation: 'vertical', bands: ['#008751', '#FFFFFF', '#008751'] },
  costa_avorio: { orientation: 'vertical', bands: ['#F77F00', '#FFFFFF', '#009E60'] },
  mali: { orientation: 'vertical', bands: ['#14B53A', '#FCD116', '#CE1126'] },
  guinea: { orientation: 'vertical', bands: ['#CE1126', '#FCD116', '#009460'] },
  ciad: { orientation: 'vertical', bands: ['#002664', '#FECB00', '#C60C30'] },
  etiopia: { orientation: 'horizontal', bands: ['#009A44', '#FCDD09', '#DA121A'] },
};

// Le chiavi sono già "normalizzate" (minuscolo, senza accenti) perché normalize() viene sempre
// applicata all'input prima del lookup.
const ALIASES: Record<string, keyof typeof ORIGIN_FLAGS> = {
  camerun: 'camerun', cameroun: 'camerun', cameroon: 'camerun',
  senegal: 'senegal',
  ghana: 'ghana',
  nigeria: 'nigeria',
  "costa d'avorio": 'costa_avorio', "cote d'ivoire": 'costa_avorio', 'ivory coast': 'costa_avorio',
  mali: 'mali',
  guinea: 'guinea', guinee: 'guinea',
  ciad: 'ciad', tchad: 'ciad', chad: 'ciad',
  etiopia: 'etiopia', ethiopia: 'etiopia',
};

function normalize(text: string): string {
  const diacritics = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(diacritics, '')
    .trim();
}

export function resolveOriginFlag(countryText: string | null): FlagSpec | null {
  if (!countryText) return null;
  const key = ALIASES[normalize(countryText)];
  return key ? (ORIGIN_FLAGS[key] ?? null) : null;
}

function starPoints(cx: number, cy: number, outerR: number, innerR: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const angle = (-90 + k * 36) * (Math.PI / 180);
    const r = k % 2 === 0 ? outerR : innerR;
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

interface FlagSwatchProps {
  spec: FlagSpec;
  width: string;
  height: string;
  style?: CSSProperties;
}

/** Bandiera rettangolare (bande piene + stella opzionale), sempre centrata nel riquadro 3:2. */
export function FlagSwatch({ spec, width, height, style }: FlagSwatchProps) {
  const n = spec.bands.length;
  const isVertical = spec.orientation === 'vertical';
  return (
    <svg
      viewBox="0 0 3 2" width={width} height={height} preserveAspectRatio="xMidYMid slice"
      style={{ display: 'block', borderRadius: '0.3mm', boxShadow: '0 0 0 0.1mm rgba(0,0,0,.15)', flexShrink: 0, ...style }}
    >
      {spec.bands.map((color, i) => (
        isVertical
          ? <rect key={i} x={(3 / n) * i} y={0} width={3 / n} height={2} fill={color} />
          : <rect key={i} x={0} y={(2 / n) * i} width={3} height={2 / n} fill={color} />
      ))}
      {spec.star && <polygon points={starPoints(1.5, 1, 0.36, 0.14)} fill={spec.star.color} />}
    </svg>
  );
}
