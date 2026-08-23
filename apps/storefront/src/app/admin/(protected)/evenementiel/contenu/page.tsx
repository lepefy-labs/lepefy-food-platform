import Link from 'next/link';
import { IconPhoto, IconTools } from '@tabler/icons-react';

export default function AdminEvenementielContentPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-gray-950 dark:text-white">Contenu</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Gérez les services et la galerie du module événementiel.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/admin/evenementiel/services" className="flex min-h-24 items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-white/5">
          <IconTools size={22} className="text-gray-400" />
          <div><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Services</p><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Traiteur, location matériel et autres offres.</p></div>
        </Link>
        <Link href="/admin/evenementiel/galerie" className="flex min-h-24 items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-white/5">
          <IconPhoto size={22} className="text-gray-400" />
          <div><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Galerie</p><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Photos utilisées dans l’expérience événementielle.</p></div>
        </Link>
      </div>
    </div>
  );
}
