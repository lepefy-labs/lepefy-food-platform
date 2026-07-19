/** Même gabarit que ProductCardSkeleton (ProductGrid.tsx) — dupliqué ici car
 *  loading.tsx doit être autonome et ce composant interne n'est pas exporté. */
function ProductCardSkeleton() {
  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 animate-pulse">
      <div className="aspect-square bg-gray-100" />
      <div className="p-3 space-y-2">
        <div className="h-3.5 bg-gray-100 rounded-sm w-full" />
        <div className="h-3.5 bg-gray-100 rounded-sm w-2/3" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="h-[52px] bg-gray-50 border border-gray-200 rounded-full mb-4 animate-pulse" />
      <div className="h-6 w-40 bg-gray-100 rounded-sm mb-4 animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
      </div>
    </div>
  );
}
