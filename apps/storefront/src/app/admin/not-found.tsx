import Link from 'next/link';

export default function AdminNotFound() {
  return (
    <div className="flex flex-col items-center justify-center
                    min-h-[60vh] text-center px-4">
      <p className="text-6xl font-bold text-gray-100 mb-4">404</p>
      <p className="text-lg font-medium text-gray-700 mb-2">
        Page introuvable
      </p>
      <p className="text-sm text-gray-400 mb-8">
        Cette page n&apos;existe pas ou a été déplacée.
      </p>
      <Link
        href="/admin"
        className="inline-flex items-center gap-2 px-5 py-2.5
                   bg-[var(--color-primary)] text-white rounded-lg
                   text-sm font-medium hover:opacity-90 transition-opacity"
      >
        ← Retour au tableau de bord
      </Link>
    </div>
  );
}
