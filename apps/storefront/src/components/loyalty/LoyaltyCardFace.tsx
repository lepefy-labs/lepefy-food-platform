import type { LoyaltyBrand } from '@/lib/loyalty/wallet/brand';

interface Props {
  brand: LoyaltyBrand;
  fullName: string | null;
  points: number | null;
  cardNumberDisplay: string | null;
  barcodeSvg?: string | null;
  variant?: 'full' | 'compact';
}

export function LoyaltyCardFace({ brand, fullName, points, cardNumberDisplay, barcodeSvg, variant = 'full' }: Props) {
  const compact = variant === 'compact';
  return (
    <div className={`relative flex flex-col overflow-hidden rounded-3xl shadow-lg ${compact ? 'min-h-[156px]' : 'min-h-[240px]'}`}
      style={{ backgroundColor: brand.background, color: brand.foreground }}>
      <svg aria-hidden="true" viewBox="0 0 200 240"
        className="pointer-events-none absolute right-0 top-0 h-full w-1/2 opacity-[0.08]" fill="none" stroke="currentColor">
        <circle cx="180" cy="80" r="125" strokeWidth="18" />
        <circle cx="180" cy="80" r="90" strokeWidth="2" />
        <path d="M100 0l25 25L100 50l25 25-25 25 25 25-25 25 25 25-25 25" strokeWidth="5" />
      </svg>
      <div className={compact ? "relative flex flex-1 flex-col gap-2 p-4" : "relative flex flex-1 flex-col gap-5 p-5 sm:p-6"}>
        <div className="flex items-start justify-between gap-3">
          {brand.logoUrl ? (
            // Tenant logo is a public brand asset; keep the original artwork.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} className={compact ? "h-8 w-16 object-contain" : "h-16 w-28 rounded-lg object-contain"} />
          ) : <span className="max-w-[60%] break-words text-xl font-bold">{brand.name}</span>}
          <span className="pt-1 text-right text-[10px] font-semibold uppercase tracking-[0.15em]">
            Carte de fidélité
          </span>
        </div>
        <p className={compact ? "text-xl font-bold tracking-tight" : "text-2xl font-bold tracking-tight sm:text-3xl"}>
          {brand.name} <span style={{ color: brand.textAccent }}>Club</span>
        </p>
        <div className="mt-auto flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest opacity-80">Membre</p>
            <p className="break-words text-sm font-semibold uppercase tracking-wide">{fullName || 'Client'}</p>
            {!barcodeSvg && cardNumberDisplay && <p className="mt-1 font-mono text-xs">{cardNumberDisplay}</p>}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-widest opacity-80">Points confirmés</p>
            <p className="text-2xl font-extrabold leading-tight">{points === null ? '—' : new Intl.NumberFormat('fr-FR').format(points)}</p>
          </div>
        </div>
        {barcodeSvg && (
          <div className="rounded-xl bg-white px-3 py-2 text-center text-gray-800">
            <div className="[&>svg]:mx-auto [&>svg]:block [&>svg]:h-auto [&>svg]:max-h-[52px] [&>svg]:w-full"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: barcodeSvg }} />
            <p className="mt-1 font-mono text-[11px] tracking-widest">{cardNumberDisplay}</p>
          </div>
        )}
      </div>
      <div className="h-2 shrink-0" style={{ backgroundColor: brand.accent }} />
    </div>
  );
}
