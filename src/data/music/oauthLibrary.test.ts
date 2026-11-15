import { describe, expect, it } from 'vitest';
import { mergeRecentTracks } from './localHistory';
import { isLikelyMusicTrack } from './oauthLibrary';
import type { Track } from './types';

function makeTrack(videoId: string, title: string): Track {
  return {
    videoId,
    title,
    artists: [{ name: 'Artist', id: null }],
    album: null,
    durationSec: 210,
    explicit: false,
    thumbnail: null,
    index: null,
    plays: null,
  };
}

describe('oauthLibrary music history filtering', () => {
  it('keeps Topic, VEVO, artist-badged, music-titled, and liked tracks while dropping regular YouTube videos', () => {
    const likedIds = new Set(['liked123']);

    expect(isLikelyMusicTrack('Nightcall', 'Kavinsky - Topic', null, 258, likedIds, 'a')).toBe(true);
    expect(isLikelyMusicTrack('Blinding Lights', 'TheWeekndVEVO', null, 200, likedIds, 'b')).toBe(true);
    expect(
      isLikelyMusicTrack('Midnight', 'Some Artist', [{ metadataBadgeRenderer: { icon: { iconType: 'OFFICIAL_ARTIST_BADGE' } } }], 190, likedIds, 'c'),
    ).toBe(true);
    expect(isLikelyMusicTrack('My Song (Official Audio)', 'Artist Channel', null, 210, likedIds, 'd')).toBe(true);
    expect(isLikelyMusicTrack('Random Track Title', 'Channel', null, 180, likedIds, 'liked123')).toBe(true);

    // Regular YouTube videos should be excluded
    expect(isLikelyMusicTrack('Elden Ring Full Gameplay Walkthrough Part 4', 'GamerGuy', null, 1800, likedIds, 'e')).toBe(false);
    expect(isLikelyMusicTrack('iPhone 17 Unboxing & Review', 'TechChannel', null, 520, likedIds, 'f')).toBe(false);
    expect(isLikelyMusicTrack('Funny Cat #shorts', 'PetClips', null, 22, likedIds, 'g')).toBe(false);
    expect(isLikelyMusicTrack('Podcast Episode 45 feat. Guest', 'TalkShow', null, 300, likedIds, 'h')).toBe(false);
  });

  it('merges local recent plays ahead of YouTube music history without duplicates', () => {
    const local = [makeTrack('v1', 'Played In Audiophile'), makeTrack('v2', 'Second Local')];
    const remote = [makeTrack('v2', 'Duplicate'), makeTrack('v3', 'Remote Music')];

    const merged = mergeRecentTracks(local, remote);
    expect(merged.map((t) => t.videoId)).toEqual(['v1', 'v2', 'v3']);
    expect(merged.map((t) => t.index)).toEqual([1, 2, 3]);
  });
});
