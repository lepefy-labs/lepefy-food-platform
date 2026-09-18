export default function ReviewLoading() {
  return (
    <div role="status" aria-label="Chargement du formulaire d’avis" className="mx-auto max-w-xl px-4 py-6 sm:px-6 sm:py-8">
      <span className="sr-only">Chargement du formulaire d’avis…</span>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="mx-auto h-7 w-36 rounded-full bg-slate-200" />
        <div className="mx-auto mt-3 h-9 w-56 rounded-lg bg-slate-200" />
        <div className="mx-auto mt-3 h-5 w-4/5 rounded bg-slate-200" />
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-7">
          <div className="h-5 w-32 rounded bg-slate-200" />
          <div className="mx-auto mt-6 grid max-w-xs grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((value) => <div key={value} className="h-12 rounded-xl bg-slate-100" />)}
          </div>
          <div className="mt-8 h-5 w-40 rounded bg-slate-200" />
          <div className="mt-3 h-32 rounded-xl bg-slate-100" />
          <div className="mt-6 h-12 rounded-xl bg-slate-200" />
        </div>
      </div>
    </div>
  );
}
