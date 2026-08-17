import type { ComponentType } from 'react';
import Link from 'next/link';
import { IconArrowUpRight, IconArrowDownRight } from '@tabler/icons-react';

type Tone = 'primary' | 'info' | 'warn' | 'success' | 'danger' | 'neutral';

const TONE_ICON_STYLE: Record<Tone, { bg: string; fg: string }> = {
  primary: { bg: 'var(--color-primary-light)', fg: 'var(--color-primary-dark)' },
  info:    { bg: 'var(--status-info-bg)',     fg: 'var(--status-info-fg)' },
  warn:    { bg: 'var(--status-warn-bg)',     fg: 'var(--status-warn-fg)' },
  success: { bg: 'var(--status-success-bg)',  fg: 'var(--status-success-fg)' },
  danger:  { bg: 'var(--status-danger-bg)',   fg: 'var(--status-danger-fg)' },
  neutral: { bg: '#F3F4F6',                   fg: '#4B5563' },
};

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  /** Variation % mois/mois — badge coloré avec flèche si fourni. */
  delta?: number | null;
  /**
   * Icône Tabler (composant, pas élément) affichée dans le badge rond en haut
   * de la card. `size`/`stroke` en `string | number` — pas juste `number` —
   * pour matcher `IconProps` réel du package (`@tabler/icons-react` ne
   * l'exporte pas nommément, sinon on l'utiliserait directement).
   */
  icon?: ComponentType<{ size?: string | number; stroke?: string | number; className?: string }>;
  /** Teinte du badge icône — 'primary' (couleur tenant) par défaut, ou un ton sémantique --status-*. */
  tone?: Tone;
}

/**
 * Card KPI condivisa (stile ispirato a TailAdmin — vedi
 * _tailadmin-staging/components/ecommerce/EcommerceMetrics.tsx come solo
 * riferimento visivo, nessun codice riusato da lì): badge icona tondo
 * colorato + valore + etichetta + badge trend con freccia.
 *
 * Non ancora adottata da nessuna pagina reale (Fase A crea solo il building
 * block) — `(protected)/page.tsx` continua a usare la sua KpiCard locale
 * finché la Fase C non fa la sostituzione.
 */
export default function KpiCard({ label, value, sub, href, delta, icon: Icon, tone = 'primary' }: KpiCardProps) {
  const iconStyle = TONE_ICON_STYLE[tone];

  const inner = (
    <>
      {Icon && (
        <div
          className="flex items-center justify-center w-11 h-11 rounded-xl mb-3"
          style={{ background: iconStyle.bg, color: iconStyle.fg }}
        >
          <Icon size={22} stroke={1.75} />
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
          {sub && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>}
        </div>
        {delta != null && (
          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
            style={{
              background: delta >= 0 ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
              color:      delta >= 0 ? 'var(--status-success-fg)' : 'var(--status-danger-fg)',
            }}
          >
            {delta >= 0 ? <IconArrowUpRight size={13} stroke={2.5} /> : <IconArrowDownRight size={13} stroke={2.5} />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      {href && (
        <p className="text-xs mt-2" style={{ color: 'var(--color-primary-dark)' }}>
          Voir →
        </p>
      )}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-4 hover:shadow-md transition-shadow"
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-card p-4">
      {inner}
    </div>
  );
}
