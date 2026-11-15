import { Menu, Settings } from 'lucide-react';
import { PrefetchLink, PrefetchNavLink } from '@/components/PrefetchLink';
import { useUi } from '@/state/ui';

/** Below 484px the sidebar folds into this bar and a drawer (report §11). */
export function MobileTopBar() {
  const setDrawerOpen = useUi((s) => s.setDrawerOpen);
  return (
    <header className="hidden max-sm:absolute max-sm:inset-x-0 max-sm:top-0 max-sm:z-[calc(var(--z-web-chrome)-2)] max-sm:grid max-sm:h-(--mobile-top-bar-height) max-sm:grid-cols-[44px_1fr_44px] max-sm:items-center max-sm:px-3.5 max-sm:glass-material">
      <button className="grid size-11 place-items-center rounded-full" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
        <Menu size={22} strokeWidth={2} />
      </button>
      <PrefetchLink to="/home" className="inline-flex items-center gap-1.5 justify-self-center type-[700_17px/20px] tracking-[-0.02em]" aria-label="Audiophile, Home">
        <span className="size-1.5 rounded-full bg-key" aria-hidden="true" />
        <span>Audiophile</span>
      </PrefetchLink>
      <PrefetchNavLink
        to="/settings"
        className="grid size-11 place-items-center rounded-full text-secondary hover:text-primary aria-[current=page]:text-key"
        aria-label="Settings"
        title="Settings"
      >
        <Settings size={20} strokeWidth={2} />
      </PrefetchNavLink>
    </header>
  );
}
