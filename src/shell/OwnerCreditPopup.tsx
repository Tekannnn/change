import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useOwnerPopup } from '@/state/ownerPopup';

/**
 * Translucent glass owner-credit popup ("Made By Ren"), displayed on app launch
 * and whenever a user signs in to YouTube Music.
 */
export function OwnerCreditPopup() {
  const open = useOwnerPopup((s) => s.open);
  const close = useOwnerPopup((s) => s.close);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-(--z-modal) grid animate-fade place-items-center bg-black/25 backdrop-blur-sm"
      onPointerDown={close}
    >
      <div
        className="glass-pill relative flex min-w-[230px] animate-zoom items-center justify-center rounded-[20px] px-8 py-5"
        role="dialog"
        aria-modal="true"
        aria-label="Made By Ren"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="type-title-2-emphasized tracking-[-0.01em] text-primary">Made By Ren</p>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-full text-secondary transition-colors hover:bg-quinary hover:text-primary"
        >
          <X size={14} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
