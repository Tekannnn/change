import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOwnerPopup } from '@/state/ownerPopup';

const EXIT_MS = 240;

/**
 * Translucent glass owner-credit popup ("Made By Ren"), displayed on app launch
 * and whenever a user signs in to YouTube Music.
 */
export function OwnerCreditPopup() {
  const open = useOwnerPopup((s) => s.open);
  const close = useOwnerPopup((s) => s.close);
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (open) {
      clearTimer();
      setRendered(true);
      setClosing(false);
      return;
    }

    if (!renderedRef.current) return;
    setClosing(true);
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setRendered(false);
      setClosing(false);
    }, EXIT_MS);

    return clearTimer;
  }, [open, clearTimer]);

  const handleClose = useCallback(() => {
    if (!open || closing) return;
    close();
  }, [open, closing, close]);

  useEffect(() => {
    if (!rendered || closing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rendered, closing, handleClose]);

  if (!rendered) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-(--z-modal) grid place-items-center bg-black/25 backdrop-blur-sm ${
        closing ? 'animate-owner-backdrop-out pointer-events-none' : 'animate-owner-backdrop-in'
      }`}
      onPointerDown={handleClose}
    >
      <div
        className={`glass-pill relative flex min-w-[240px] items-center justify-center rounded-[20px] px-9 py-5.5 ${
          closing ? 'animate-owner-card-out' : 'animate-owner-card-in'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Made By Ren"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="type-title-2-emphasized tracking-[-0.01em] text-primary">Made By Ren</p>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-full text-secondary transition-all duration-200 hover:rotate-90 hover:scale-110 hover:bg-quinary hover:text-primary active:scale-90"
        >
          <X size={14} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
