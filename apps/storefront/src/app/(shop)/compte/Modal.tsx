'use client';

import { useEffect, type ReactNode } from 'react';
import { IconX } from '@tabler/icons-react';
import { useUIStore } from '@/lib/store/uiStore';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Zone fixe sous le body scrollable — typiquement le bouton d'action d'un
   * <form> ambiant, pour qu'il reste visible même quand le clavier iOS
   * réduit la hauteur du viewport. */
  footer?: ReactNode;
}

// Overlay minimal fait main — aucune librairie de dialog n'est présente dans
// le projet (ni Radix, ni Headless UI), cohérent avec le reste du storefront
// qui n'en utilise nulle part ailleurs.
export function Modal({ title, onClose, children, footer }: ModalProps) {
  const setModalOpen = useUIStore((s) => s.setModalOpen);

  useEffect(() => {
    setModalOpen(true);
    return () => setModalOpen(false);
  }, [setModalOpen]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full sm:max-w-sm bg-white max-h-[90vh] max-h-[90dvh] flex flex-col overflow-hidden rounded-t-[20px] sm:rounded-[20px]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
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
        <div className={`px-5 overflow-y-auto min-h-0 ${footer ? 'pb-4' : 'pb-6'}`}>{children}</div>
        {footer && (
          <div
            className="px-5 pt-3 border-t border-gray-100 shrink-0"
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
