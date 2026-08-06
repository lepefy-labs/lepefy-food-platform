import { create } from 'zustand';

interface UIState {
  isModalOpen: boolean;
  setModalOpen: (open: boolean) => void;
}

// État de session pur (pas de persist) — un modale ouvert au moment du
// reload ne doit pas rester "ouvert" pour d'éventuels consommateurs futurs.
export const useUIStore = create<UIState>((set) => ({
  isModalOpen: false,
  setModalOpen: (open) => set({ isModalOpen: open }),
}));
