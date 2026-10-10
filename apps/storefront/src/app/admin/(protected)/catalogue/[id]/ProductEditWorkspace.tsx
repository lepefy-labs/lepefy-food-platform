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
  /** Missing or zero weight: shipping quote and carton suggestion cannot use it. */
  missingWeight?: boolean;
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
  missingWeight = false,
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
      <section className="rounded-2xl border border-a-border bg-a-surface p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-a-brand-fg">
              {isNew ? 'Création produit' : 'Espace produit'}
            </p>
            <h1 className="mt-1 truncate text-lg font-bold text-a-text sm:text-xl">
              {isNew ? 'Créer un produit sans se perdre' : productName}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-a-text-3">
              {isNew
                ? "Commencez par l'essentiel, enregistrez, puis complétez contenu, média et conformité sans quitter le même écran."
                : 'Accédez directement à la section utile et gardez les actions d’enregistrement à portée pendant le défilement.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-a-hover px-2.5 py-1 font-medium text-a-text-2">
              {categoryName || 'Catégorie à définir'}
            </span>
            <span className={`rounded-full px-2.5 py-1 font-medium ${active ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-a-hover text-a-text-3'}`}>
              {active ? 'Actif' : 'Inactif'}
            </span>
            <span className={`rounded-full px-2.5 py-1 font-medium ${stock === 0 ? 'bg-tone-danger-bg text-tone-danger-fg' : stock < 10 ? 'bg-tone-warning-bg text-tone-warning-fg' : 'bg-a-hover text-a-text-2'}`}>
              Stock {stock}
            </span>
            <span className={`rounded-full px-2.5 py-1 font-medium ${hasImage ? 'bg-tone-info-bg text-tone-info-fg' : 'bg-tone-warning-bg text-tone-warning-fg'}`}>
              {hasImage ? 'Image prête' : 'Image à compléter'}
            </span>
            {!isNew && missingWeight && (
              <span className="rounded-full bg-tone-warning-bg px-2.5 py-1 font-medium text-tone-warning-fg">
                Poids à compléter
              </span>
            )}
            {descriptionSource === 'ai' && (
              <span className="rounded-full bg-tone-warning-bg px-2.5 py-1 font-medium text-tone-warning-fg">
                Description IA à revoir
              </span>
            )}
          </div>
        </div>
      </section>

      <nav
        aria-label="Sections du produit"
        className="sticky top-0 z-30 -mx-1 overflow-x-auto border-y border-a-border bg-a-surface px-1 py-2 shadow-sm backdrop-blur"
      >
        <div className="flex min-w-max items-center gap-1.5">
          {WORKFLOW_SECTIONS.filter((section) => !isNew || section.tab !== 'Produits associés').map((section, index) => (
            <button
              key={section.label}
              type="button"
              onClick={() => openSection(section.tab, section.heading)}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-a-border bg-a-surface px-3 text-sm font-medium text-a-text-2 transition-colors hover:border-a-brand hover:text-a-brand-fg focus:outline-none focus:ring-2 focus:ring-a-focus"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-a-hover text-xs font-bold text-a-text-3">
                {index + 1}
              </span>
              {section.label}
            </button>
          ))}
        </div>
      </nav>

      {isNew && (
        <div className="rounded-xl border border-[var(--admin-primary)]/20 bg-a-brand-soft px-4 py-3 text-sm text-a-text-2">
          <span className="font-semibold text-a-text">Priorité recommandée :</span>{' '}
          nom, catégorie, prix, stock et statut d’abord. Les sections avancées restent disponibles immédiatement mais ne bloquent pas le premier passage.
        </div>
      )}

      <div ref={editorRef} className={styles.workspace}>
        {children}
      </div>
    </div>
  );
}
