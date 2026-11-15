import { create } from 'zustand';

interface OwnerPopupState {
  open: boolean;
  show: () => void;
  close: () => void;
}

/** Shows the transparent "Made By Ren" popup on initial load and after login. */
export const useOwnerPopup = create<OwnerPopupState>()((set) => ({
  open: true,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));
