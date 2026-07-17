type OrderStatus =
  | 'new'
  | 'preparing'
  | 'ready_for_pickup'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

type Tone = 'info' | 'warn' | 'success' | 'danger' | 'neutral';

const STATUS_META: Record<OrderStatus, { label: string; tone: Tone }> = {
  new:              { label: 'Nouveau',        tone: 'info'    },
  preparing:        { label: 'En préparation', tone: 'warn'    },
  ready_for_pickup: { label: 'Prêt à retirer', tone: 'success' },
  shipped:          { label: 'Expédié',        tone: 'info'    },
  delivered:        { label: 'Livré',          tone: 'success' },
  cancelled:        { label: 'Annulé',         tone: 'danger'  },
};

const STATUS_META_IT: Record<OrderStatus, string> = {
  new:              'Nuovo',
  preparing:        'In preparazione',
  ready_for_pickup: 'Pronto per ritiro',
  shipped:          'Spedito',
  delivered:        'Consegnato',
  cancelled:        'Annullato',
};

export default function StatusBadge({
  status,
  lang = 'fr',
}: {
  status: string;
  lang?: 'fr' | 'it';
}) {
  const meta = STATUS_META[status as OrderStatus] ?? { label: status, tone: 'neutral' as Tone };
  const label = lang === 'it'
    ? (STATUS_META_IT[status as OrderStatus] ?? status)
    : meta.label;

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full
                 text-xs font-semibold whitespace-nowrap"
      style={{
        background: `var(--status-${meta.tone}-bg)`,
        color:      `var(--status-${meta.tone}-fg)`,
      }}
    >
      <span
        aria-hidden="true"
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: `var(--status-${meta.tone}-dot)` }}
      />
      {label}
    </span>
  );
}
