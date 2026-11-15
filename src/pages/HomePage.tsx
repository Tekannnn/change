import { Play } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { Shelves, TrackShelf } from '@/components/music/ShelfView';
import { LoadError, LoadMoreError, NeedsExtension } from '@/components/music/States';
import { playList } from '@/components/music/play';
import { useHome, useLibrary, useYouTubeReady } from '@/data/music/queries';
import type { MusicItem, Track } from '@/data/music/types';
import { sizedArtwork } from '@/lib/artwork';
import { HomeSkeleton } from '@/skeletons/PageSkeletons';
import { ShelfSkeleton } from '@/skeletons/ShelfSkeleton';

const RECENT_TITLE = 'Recently Played';
const RECENT_LIMIT = 20;
const RECENT_SOURCE = { title: RECENT_TITLE, type: 'home' as const };

/**
 * The account's listening history, newest first, one row per song
 * (YtMusicRepository.recentlyPlayed): the first 20, signed in only. The same
 * query as Library's Recently Played, so either page warms the other.
 */
function useRecentlyPlayed(): Track[] {
  const history = useLibrary('recent');
  const first = history.data?.pages[0]?.data.tracks ?? [];
  const seen = new Set<string>();
  return first.filter((t) => !seen.has(t.videoId) && seen.add(t.videoId)).slice(0, RECENT_LIMIT);
}

/** YouTube Music's home feed, as Apple's Home: shelf after shelf, more as you scroll. */
export default function HomePage() {
  const { missing } = useYouTubeReady();
  const home = useHome();
  const recent = useRecentlyPlayed();
  const sentinel = useRef<HTMLDivElement>(null);

  // Loads the next shelves before the bottom comes into view; after a failed
  // page it waits for Try Again rather than retrying on every scroll.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !home.hasNextPage || home.isFetchNextPageError) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !home.isFetchingNextPage) void home.fetchNextPage();
      },
      { root: document.getElementById('scrollable-page'), rootMargin: '600px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [home.hasNextPage, home.isFetchingNextPage, home.isFetchNextPageError, home.fetchNextPage]);

  if (missing) {
    return (
      <>
        <PageHeader title="Home" />
        <NeedsExtension />
      </>
    );
  }
  // Only a failed first page replaces the feed; a later one is shown under it.
  if (home.isError && !home.data) {
    return (
      <>
        <PageHeader title="Home" />
        <LoadError error={home.error} onRetry={() => void home.refetch()} />
      </>
    );
  }
  if (!home.data) return <HomeSkeleton />;

  // YouTube's feed can carry its own, older Recently Played; the history wins, as on the phone.
  const shelves = home.data.pages
    .flatMap((page) => page.data)
    .filter((shelf) => !(recent.length > 0 && shelf.title.trim().toLowerCase() === RECENT_TITLE.toLowerCase()));

  const heroTrack: Track | null =
    recent[0] ??
    (() => {
      const firstSong: MusicItem | undefined = shelves
        .flatMap((s) => s.items)
        .find((i) => i.kind === 'song' || i.kind === 'video');
      if (!firstSong) return null;
      return {
        videoId: firstSong.id,
        title: firstSong.title,
        artists: firstSong.artists,
        album: firstSong.album,
        durationSec: firstSong.durationSec,
        explicit: firstSong.explicit,
        thumbnail: firstSong.thumbnail,
        index: 1,
        plays: null,
      };
    })();

  const heroArtist = heroTrack?.artists.map((a) => a.name).filter(Boolean).join(', ') || 'Audiophile Mix';

  return (
    <>
      <PageHeader title="Home" />
      {heroTrack && (
        <section className="px-(--body-gutter) pt-1 pb-4">
          <div className="relative flex items-center gap-4 overflow-hidden rounded-[18px] border border-white/10 bg-shelf-bg p-4 shadow-[0_12px_36px_rgba(0,0,0,0.22)]">
            {heroTrack.thumbnail && (
              <img
                src={sizedArtwork(heroTrack.thumbnail, 300)}
                alt=""
                aria-hidden="true"
                referrerPolicy="no-referrer"
                className="pointer-events-none absolute -right-10 -top-10 size-48 rounded-full object-cover opacity-20 blur-2xl"
              />
            )}
            <div className="relative flex-none pr-4">
              {/* Subtle vinyl disc peeking out behind the sleeve */}
              <div
                aria-hidden="true"
                className="absolute top-1.5 right-0 size-17 rounded-full border border-white/10 bg-[radial-gradient(circle_at_center,#e5a952_0%,#e5a952_16%,#16161a_17%,#0b0b0d_62%,#222228_100%)] shadow-md"
              />
              {heroTrack.thumbnail ? (
                <img
                  src={sizedArtwork(heroTrack.thumbnail, 200)}
                  alt={heroTrack.title}
                  referrerPolicy="no-referrer"
                  className="relative z-1 size-20 rounded-[12px] object-cover ring-1 ring-white/15 shadow-lg"
                />
              ) : (
                <div className="relative z-1 size-20 rounded-[12px] bg-quaternary ring-1 ring-white/15" />
              )}
            </div>
            <div className="relative z-1 flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-mono text-[10px] font-semibold tracking-[0.14em] text-key uppercase">
                Continue Listening
              </span>
              <h2 className="truncate type-title-2-emphasized text-primary">{heroTrack.title}</h2>
              <p className="truncate type-callout text-secondary">{heroArtist}</p>
              <div className="mt-1.5">
                <button
                  type="button"
                  onClick={() =>
                    void playList(recent.length > 0 ? recent : [heroTrack], 0, {
                      source: { title: 'Continue Listening', type: 'home' },
                    })
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-key-bg px-3.5 type-callout-emphasized text-[#0b0b0d] shadow-[0_4px_16px_rgba(229,169,82,0.32)] transition-transform active:scale-95"
                >
                  <Play size={13} fill="currentColor" />
                  <span>Play</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
      {recent.length > 0 && <TrackShelf title={RECENT_TITLE} to="/library/recent" tracks={recent} source={RECENT_SOURCE} />}
      <Shelves shelves={shelves} />
      <div ref={sentinel} />
      {home.isFetchingNextPage && <ShelfSkeleton kind="square" />}
      {home.isFetchNextPageError && <LoadMoreError onRetry={() => void home.fetchNextPage()} />}
    </>
  );
}
