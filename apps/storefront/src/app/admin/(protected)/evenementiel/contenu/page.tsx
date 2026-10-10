import Link from 'next/link';
import { IconPhoto, IconTools } from '@tabler/icons-react';

export default function AdminEvenementielContentPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-a-text">Contenu</h1>
      <p className="mt-1 text-sm text-a-text-3">Gérez les services et la galerie du module événementiel.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/admin/evenementiel/services" className="flex min-h-24 items-center gap-3 rounded-xl border border-a-border bg-a-surface p-4 transition-colors hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus">
          <IconTools size={22} className="text-a-text-3" />
          <div><p className="text-sm font-semibold text-a-text">Services</p><p className="mt-1 text-xs text-a-text-3">Traiteur, location matériel et autres offres.</p></div>
        </Link>
        <Link href="/admin/evenementiel/galerie" className="flex min-h-24 items-center gap-3 rounded-xl border border-a-border bg-a-surface p-4 transition-colors hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus">
          <IconPhoto size={22} className="text-a-text-3" />
          <div><p className="text-sm font-semibold text-a-text">Galerie</p><p className="mt-1 text-xs text-a-text-3">Photos utilisées dans l’expérience événementielle.</p></div>
        </Link>
      </div>
    </div>
  );
}
