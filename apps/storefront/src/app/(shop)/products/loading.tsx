/** Même gabarit que ProductCardSkeleton (ProductGrid.tsx) — dupliqué ici car
 *  loading.tsx doit être autonome et ce composant interne n'est pas exporté. */
function ProductCardSkeleton() {
  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 animate-pulse">
      <div className="aspect-[4/3] bg-gray-100 sm:aspect-square" />
      <div className="p-2.5 sm:p-3">
        <div className="space-y-1">
          <div className="h-3.5 bg-gray-100 rounded-sm w-full" />
          <div className="h-3.5 bg-gray-100 rounded-sm w-2/3" />
        </div>
        <div className="mt-1.5 h-3 w-1/2 rounded-sm bg-gray-100 sm:mt-2" />
        <div className="mt-1.5 flex items-end justify-between gap-2 sm:mt-2">
          <div className="h-4 w-16 rounded-sm bg-gray-100" />
          <div className="h-11 w-11 rounded-full bg-gray-100" />
        </div>
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-5 md:py-8">
      <div className="mb-5 space-y-2 animate-pulse"><div className="h-9 w-44 rounded bg-gray-100"/><div className="h-4 w-36 rounded bg-gray-100"/></div>
      <div className="h-[52px] max-w-2xl bg-gray-50 border border-gray-200 rounded-xl animate-pulse" />
      <div className="mt-6 mb-3 h-6 w-28 bg-gray-100 rounded animate-pulse" />
      <div className="mb-6 flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="aspect-[4/5] flex-[0_0_31%] sm:flex-[0_0_23%] md:flex-[0_0_168px] rounded-[18px] bg-gray-100 animate-pulse" />)}
      </div>
      <div className="h-7 w-40 bg-gray-100 rounded mb-4 animate-pulse" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
      </div>
    </div>
  );
}
