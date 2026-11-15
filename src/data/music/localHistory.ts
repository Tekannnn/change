import type { Track } from './types';

const STORAGE_KEY = 'audiophile:recent_tracks';
const MAX_LOCAL_RECENT = 50;

/** Reads music tracks recently played inside Audiophile (newest first). */
export function loadLocalRecentTracks(): Track[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Track =>
        !!item && typeof item === 'object' && typeof item.videoId === 'string' && typeof item.title === 'string',
    );
  } catch {
    return [];
  }
}

/** Prepends [track] to local recently played music history, deduplicated by videoId. */
export function recordLocalRecentTrack(track: Track): void {
  if (!track?.videoId || !track.title) return;
  try {
    const existing = loadLocalRecentTracks().filter((t) => t.videoId !== track.videoId);
    const next = [{ ...track, index: 1 }, ...existing].slice(0, MAX_LOCAL_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors.
  }
}

/** Merges [primary] then [secondary], keeping unique videoIds in order. */
export function mergeRecentTracks(primary: Track[], secondary: Track[], limit = MAX_LOCAL_RECENT): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const list of [primary, secondary]) {
    for (const track of list) {
      if (!track.videoId || seen.has(track.videoId)) continue;
      seen.add(track.videoId);
      out.push({ ...track, index: out.length + 1 });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
