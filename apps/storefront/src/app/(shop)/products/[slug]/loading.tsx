export default function Loading() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
        <div className="aspect-square bg-gray-100 rounded-2xl animate-pulse" />
        <div className="flex flex-col gap-4">
          <div className="h-3.5 w-24 bg-gray-100 rounded-sm animate-pulse" />
          <div className="h-8 w-3/4 bg-gray-100 rounded-sm animate-pulse" />
          <div className="h-8 w-28 bg-gray-100 rounded-sm animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 w-full bg-gray-100 rounded-sm animate-pulse" />
            <div className="h-4 w-full bg-gray-100 rounded-sm animate-pulse" />
            <div className="h-4 w-2/3 bg-gray-100 rounded-sm animate-pulse" />
          </div>
          <div className="h-4 w-32 bg-gray-100 rounded-sm animate-pulse" />
          <div className="h-12 w-full bg-gray-100 rounded-xl animate-pulse mt-2" />
        </div>
      </div>
    </div>
  );
}
