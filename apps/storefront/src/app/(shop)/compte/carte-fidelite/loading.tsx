export default function LoyaltyCardLoading() {
  return (
    <div role="status" aria-label="Chargement de votre carte" className="mx-auto max-w-4xl px-4 py-10">
      <p className="mb-6 text-sm text-gray-600">Chargement de votre carte…</p>
      <div aria-hidden="true" className="grid gap-6 md:grid-cols-2">
        <div className="h-72 rounded-3xl bg-gray-200 motion-safe:animate-pulse" />
        <div className="h-96 rounded-3xl bg-gray-200 motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
