'use client';

import { type ReactNode, useRef } from 'react';
import styles from './ProductEditWorkspace.module.css';

interface ProductEditWorkspaceProps {
  children: ReactNode;
  isNew: boolean;
  productName: string;
  categoryName?: string | null;
  active: boolean;
  stock: number;
  hasImage: boolean;
  descriptionSource: 'ai' | 'human' | null;
}

const WORKFLOW_SECTIONS = [
  { label: 'Essentiel', tab: 'Général', heading: 'Informations' },
  { label: 'Contenu', tab: 'Général', heading: 'Descriptions' },
  { label: 'Stock & logistique', tab: 'Général', heading: 'Tarification & Logistique' },
  { label: 'Média', tab: 'Général', heading: 'Médias' },
  { label: 'Conformité', tab: 'Étiquette', heading: 'Origine et conformité' },
  { label: 'Étiquette', tab: 'Étiquette', heading: "Fond d'étiquette" },
  { label: 'Associés', tab: 'Produits associés', heading: 'Produits associés' },
] as const;

export default function ProductEditWorkspace({
  children,
  isNew,
  productName,
  categoryName,
  active,
  stock,
  hasImage,
  descriptionSource,
}: ProductEditWorkspaceProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  function openSection(tabLabel: 'Général' | 'Étiquette' | 'Produits associés', headingLabel: string) {
    const root = editorRef.current;
    if (!root) return;

    const tabButton = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === tabLabel
    );
    tabButton?.click();

    window.setTimeout(() => {
      const heading = Array.from(root.querySelectorAll('h2, h3')).find((node) =>
        node.textContent?.trim().toLowerCase().includes(headingLabel.toLowerCase())
      );
      heading?.closest('section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 40);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
              {isNew ? 'Création produit' : 'Espace produit'}
            </p>
            <h1 className="mt-1 truncate text-lg font-bold text-gray-900 sm:text-xl">
              {isNew ? 'Créer un produit sans se perdre' : productName}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              {isNew
                ? "Commencez par l'essentiel, enregistrez, puis complétez contenu, média et conformité sans quitter le même écran."
                : 'Accédez directement à la section utile et gardez les actions d’enregistrement à portée pendant le défilement.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-600">
              {categoryName || 'Catégorie à définir'}
            </span>
            <span className={`rounded-full px-2.5 py-1 font-medium ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
              {active ? 'Actif' : 'Inactif'}
            </span>
            <span className={`rounded-full px-2.5 py-1 font-medium ${stock === 0 ? 'bg-red-50 text-red-700' : stock < 10 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
              Stock {stock}
            </span>
            <span className={`rounded-full px-2.5 py-1 font-medium ${hasImage ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
              {hasImage ? 'Image prête' : 'Image à compléter'}
            </span>
            {descriptionSource === 'ai' && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700">
                Description IA à revoir
              </span>
            )}
          </div>
        </div>
      </section>

      <nav
        aria-label="Sections du produit"
        className="sticky top-0 z-30 -mx-1 overflow-x-auto border-y border-gray-200 bg-white/95 px-1 py-2 shadow-sm backdrop-blur"
      >
        <div className="flex min-w-max items-center gap-1.5">
          {WORKFLOW_SECTIONS.filter((section) => !isNew || section.tab !== 'Produits associés').map((section, index) => (
            <button
              key={section.label}
              type="button"
              onClick={() => openSection(section.tab, section.heading)}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-600 transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-gray-500">
                {index + 1}
              </span>
              {section.label}
            </button>
          ))}
        </div>
      </nav>

      {isNew && (
        <div className="rounded-xl border border-[var(--color-primary)]/20 bg-[var(--color-primary-light)] px-4 py-3 text-sm text-gray-700">
          <span className="font-semibold text-gray-900">Priorité recommandée :</span>{' '}
          nom, catégorie, prix, stock et statut d’abord. Les sections avancées restent disponibles immédiatement mais ne bloquent pas le premier passage.
        </div>
      )}

      <div ref={editorRef} className={styles.workspace}>
        {children}
      </div>
    </div>
  );
}
