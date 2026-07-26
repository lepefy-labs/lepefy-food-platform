'use client';

import { useState } from 'react';

type TabKey = 'ingredients' | 'conservation';

interface ProductTabsProps {
  ingredientsText: string | null;
  allergensText: string | null;
  glutenFreeCertified: boolean;
  conservationInstructions: string | null;
  conservationAfterOpening: string | null;
  usageInstructions: string | null;
}

const FALLBACK_TEXT = 'Informations disponibles sur l\'emballage';

/**
 * Uniquement 2 onglets : "Ingrédients & allergènes" et "Conservation". Pas
 * d'onglet "Avis clients" — la feature de notation n'existe pas encore côté
 * plateforme, donc aucune donnée à y montrer. Chaque champ texte est
 * nullable en base (mêmes colonnes que le système d'étiquettes) : à défaut
 * de valeur on affiche un repli neutre plutôt que d'inventer une affirmation
 * (ex. jamais "ne contient aucun des 14 allergènes majeurs" pour un champ
 * NULL — personne n'a confirmé cette absence).
 */
export function ProductTabs({
  ingredientsText,
  allergensText,
  glutenFreeCertified,
  conservationInstructions,
  conservationAfterOpening,
  usageInstructions,
}: ProductTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('ingredients');

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'ingredients', label: 'Ingrédients & allergènes' },
    { key: 'conservation', label: 'Conservation' },
  ];

  return (
    <div className="mt-10">
      <div className="flex gap-6 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            aria-current={activeTab === tab.key}
            className="pb-3 text-sm font-semibold transition-colors -mb-px"
            style={{
              color: activeTab === tab.key ? 'var(--color-primary)' : '#9ca3af',
              borderBottom: activeTab === tab.key ? '2px solid var(--color-primary)' : '2px solid transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="py-6">
        {activeTab === 'ingredients' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-2">Ingrédients</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{ingredientsText || FALLBACK_TEXT}</p>
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-2">Allergènes</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{allergensText || FALLBACK_TEXT}</p>
              {glutenFreeCertified && (
                <span
                  className="inline-block mt-3 text-xs font-semibold px-3 py-1 rounded-full"
                  style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-dark)' }}
                >
                  Sans gluten
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 max-w-2xl">
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-2">Conservation</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{conservationInstructions || FALLBACK_TEXT}</p>
            </div>
            {conservationAfterOpening && (
              <div>
                <h3 className="text-sm font-bold text-gray-900 mb-2">Après ouverture</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{conservationAfterOpening}</p>
              </div>
            )}
            {usageInstructions && (
              <div>
                <h3 className="text-sm font-bold text-gray-900 mb-2">Utilisation</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{usageInstructions}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
