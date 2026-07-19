/** Même gabarit visuel que ProductCardSkeleton (ProductGrid.tsx), adapté au
 *  format "shelf" (carte étroite en rangée horizontale) de la home. */
function ShelfCardSkeleton() {
  return (
    <div className="rounded-lg overflow-hidden border border-gray-100 bg-white flex-shrink-0 w-36 md:w-full md:flex-shrink animate-pulse">
      <div className="aspect-square bg-gray-100" />
      <div className="px-2 pt-1 pb-6 space-y-1.5">
        <div className="h-3 bg-gray-100 rounded-sm w-full" />
        <div className="h-3 bg-gray-100 rounded-sm w-1/2" />
      </div>
    </div>
  );
}

function ShelfSectionSkeleton() {
  return (
    <section>
      <div className="flex items-center justify-between px-4 mb-2 mt-5">
        <div className="h-4 w-32 bg-gray-100 rounded-sm animate-pulse" />
        <div className="h-3 w-14 bg-gray-100 rounded-sm animate-pulse" />
      </div>
      <div className="
        flex gap-2.5 overflow-x-auto px-4 pb-3
        [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
        md:grid md:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]
        md:overflow-x-visible md:pb-4
      ">
        {Array.from({ length: 4 }).map((_, i) => <ShelfCardSkeleton key={i} />)}
      </div>
    </section>
  );
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f7f9f8]">
      {/* Hero placeholder */}
      <div className="h-56 md:h-72 bg-gray-100 animate-pulse" />

      <div className="max-w-6xl mx-auto w-full">
        {Array.from({ length: 3 }).map((_, i) => <ShelfSectionSkeleton key={i} />)}
        <div className="h-6" />
      </div>
    </div>
  );
}
