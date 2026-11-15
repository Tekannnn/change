import { X } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useUi } from '@/state/ui';
import { UpNext } from './UpNext';

// am-lyrics is large; it loads the first time the panel opens (prompt §3).
const LyricsPanel = lazy(() => import('./LyricsPanel').then((m) => ({ default: m.LyricsPanel })));

/** Up Next / Lyrics glass panel (report §7). */
export function SidePanel() {
  const panel = useUi((s) => s.sidePanel);
  const toggleSidePanel = useUi((s) => s.toggleSidePanel);
  // Hidden under the full-screen player, which has its own lyrics: one am-lyrics at a time.
  const fullScreen = useUi((s) => s.fullScreen);
  if (!panel || fullScreen) return null;

  return (
    <aside
      className="absolute inset-y-0 right-0 z-(--z-web-chrome) flex w-(--side-panel-width) animate-slide-in flex-col glass-material shadow-glass max-sm:w-full"
      aria-label={panel === 'up-next' ? 'Up Next' : 'Lyrics'}
    >
      <button
        className="absolute top-3 right-3 z-20 hidden size-8 place-items-center rounded-full bg-quinary text-primary max-sm:grid"
        aria-label="Close panel"
        onClick={() => toggleSidePanel(panel)}
      >
        <X size={16} />
      </button>
      {panel === 'up-next' ? (
        <UpNext />
      ) : (
        <Suspense fallback={null}>
          <LyricsPanel />
        </Suspense>
      )}
    </aside>
  );
}
