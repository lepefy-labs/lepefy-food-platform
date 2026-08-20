import { IconX } from '@tabler/icons-react';
import { formatProductCount } from '@/lib/cart/formatProductCount';

interface CartDrawerHeaderProps {
  itemCount: number;
  onClose: () => void;
  titleId: string;
  closeButtonRef?: React.RefObject<HTMLButtonElement>;
}

export function CartDrawerHeader({ itemCount, onClose, titleId, closeButtonRef }: CartDrawerHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 shrink-0">
      <div>
        <h2 id={titleId} className="text-lg font-bold">Mon panier</h2>
        {itemCount > 0 && (
          <p className="text-xs text-gray-400 mt-0.5">{formatProductCount(itemCount)}</p>
        )}
      </div>
      <button
        ref={closeButtonRef}
        type="button"
        onClick={onClose}
        aria-label="Fermer le panier"
        className="w-11 h-11 -mr-2.5 -mt-1.5 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors shrink-0"
      >
        <IconX size={20} />
      </button>
    </div>
  );
}
