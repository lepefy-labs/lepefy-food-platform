export default function AccountLoading() {
  return (
    <div role="status" aria-label="Chargement de votre compte" className="mx-auto max-w-5xl px-4 py-8">
      <p className="mb-6 text-sm text-gray-600">Chargement de votre compte…</p>
      <div aria-hidden="true" className="grid gap-6 lg:grid-cols-2">
        <div className="h-52 rounded-3xl bg-gray-200 motion-safe:animate-pulse" />
        <div className="h-52 rounded-2xl bg-gray-200 motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
