'use client';

import { useEffect, type ReactNode } from 'react';
import { IconX } from '@tabler/icons-react';
import { useUIStore } from '@/lib/store/uiStore';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Zone fixe sous le body — typiquement le bouton d'action d'un <form>
   * ambiant. Reste dans le flux normal du document (pas de hauteur calculée
   * en vh/dvh) : si le contenu dépasse l'écran, c'est l'overlay entier qui
   * scrolle nativement, jamais une sous-zone à hauteur fixe. */
  footer?: ReactNode;
}

// Overlay minimal fait main — aucune librairie de dialog n'est présente dans
// le projet (ni Radix, ni Headless UI), cohérent avec le reste du storefront
// qui n'en utilise nulle part ailleurs.
//
// Pattern scroll : le conteneur `fixed inset-0` est LUI-MÊME le contexte de
// scroll (overflow-y-auto), pas une sous-div à hauteur plafonnée en vh/dvh.
// Un wrapper interne `min-h-full` sert uniquement à centrer/ancrer la feuille
// quand elle est plus courte que l'écran. Volontairement sans max-height :
// deux tentatives précédentes basées sur vh/dvh ont échoué sur un device
// Android réel (PWA installée) — probablement parce que (a) Tailwind ne
// garantit pas l'ordre des règles générées dans le même ordre que les
// classes dans le JSX, donc un "fallback" vh→dvh dans le className ne suit
// pas forcément cet ordre en cascade, et (b) même vh seul peut être calculé
// en incluant la zone de la barre de navigation système Android, rendant le
// contenu présent mais visuellement couvert. Le scroll natif du conteneur
// évite complètement ce problème de calcul d'unité.
export function Modal({ title, onClose, children, footer }: ModalProps) {
  const setModalOpen = useUIStore((s) => s.setModalOpen);

  useEffect(() => {
    setModalOpen(true);
    return () => setModalOpen(false);
  }, [setModalOpen]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      <div className="min-h-full flex items-end justify-center sm:items-center sm:py-8">
        <div
          className="w-full sm:max-w-sm bg-white rounded-t-[20px] sm:rounded-[20px]"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-4">
            <h2 className="font-bold text-gray-900" style={{ fontSize: 16 }}>{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="text-gray-400 hover:text-gray-600"
            >
              <IconX size={20} stroke={1.8} />
            </button>
          </div>
          <div className={`px-5 ${footer ? 'pb-4' : 'pb-6'}`}>{children}</div>
          {footer && (
            <div
              className="px-5 pt-3 border-t border-gray-100"
              style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
