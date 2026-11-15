import { Compass, Home, Library, Search } from 'lucide-react';
import { PrefetchNavLink } from '@/components/PrefetchLink';

const TABS = [
  { to: '/home', label: 'Home', Icon: Home },
  { to: '/search', label: 'Search', Icon: Search },
  { to: '/new', label: 'Explore', Icon: Compass },
  { to: '/library/playlists', label: 'Library', Icon: Library },
] as const;

/**
 * Floating Nocturne Hi-Fi bottom pill dock on mobile viewports (`< 640px`),
 * keeping core navigation within thumb reach.
 */
export function MobileBottomDock() {
  return (
    <nav
      aria-label="Mobile Navigation"
      className="pointer-events-none fixed inset-x-0 bottom-[max(10px,env(safe-area-inset-bottom))] z-[calc(var(--z-web-chrome)-1)] hidden justify-center px-5 max-sm:flex"
    >
      <div className="glass-pill pointer-events-auto grid h-[54px] w-[min(320px,100%)] grid-cols-4 items-center rounded-pill px-2">
        {TABS.map(({ to, label, Icon }) => (
          <PrefetchNavLink
            key={to}
            to={to}
            aria-label={label}
            className="group relative grid h-10 place-items-center rounded-pill text-secondary transition-colors duration-150 hover:text-primary aria-[current=page]:bg-key/15 aria-[current=page]:text-key"
          >
            <Icon size={19} strokeWidth={2} />
            <span className="sr-only">{label}</span>
          </PrefetchNavLink>
        ))}
      </div>
    </nav>
  );
}
