import type { Innertube } from 'youtubei.js/web';
import { best, queries, ranked, searchableTitle, type MatchCandidate, type MatchTarget } from '@/data/match/trackMatcher';
import { mapPlaylistTracks } from '@/data/music/mappers';
import { trackLog } from '../trackLog';
import { resolvePlayer, type ResolvedPlayer } from './resolver';

export interface PlaybackTrackHint {
  title?: string;
  artist?: string;
  album?: string | null;
  durationSec?: number | null;
  explicit?: boolean | null;
  thumbnail?: string | null;
}

export interface SaavnFallbackStream {
  url: string;
  kbps: number | null;
  title: string;
  author: string;
  durationSec: number;
  thumbnail: string | null;
}

// ---- Pure-TypeScript 64-bit DES-ECB (FIPS 46-3) for JioSaavn media URLs ----

const SAAVN_DES_KEY = '38346591';

const DES_IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];

const DES_FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];

const DES_E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9,
  8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];

const DES_P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];

const DES_PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];

const DES_PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4,
  26, 8, 16, 7, 27, 20, 13, 2, 41, 52, 31, 37, 47, 55, 30, 40,
  51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];

const DES_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

const DES_S = [
  [
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
  ],
  [
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
    3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
  ],
  [
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
  ],
  [
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
  ],
  [
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
  ],
  [
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
  ],
  [
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
  ],
  [
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
  ],
];

function getBit(bytes: Uint8Array, bitPos1Based: number): number {
  const zero = bitPos1Based - 1;
  return (bytes[zero >> 3]! >> (7 - (zero & 7))) & 1;
}

function setBit(bytes: Uint8Array, bitPos1Based: number, bit: number): void {
  const zero = bitPos1Based - 1;
  const byteIdx = zero >> 3;
  const mask = 1 << (7 - (zero & 7));
  if (bit) bytes[byteIdx]! |= mask;
  else bytes[byteIdx]! &= ~mask;
}

function permute(src: Uint8Array, table: readonly number[]): Uint8Array {
  const out = new Uint8Array(Math.ceil(table.length / 8));
  for (let i = 0; i < table.length; i++) {
    setBit(out, i + 1, getBit(src, table[i]!));
  }
  return out;
}

function desSubkeys(keyStr: string): Uint8Array[] {
  const keyBytes = new TextEncoder().encode(keyStr.slice(0, 8).padEnd(8, '\0'));
  const pc1 = permute(keyBytes, DES_PC1);
  let c = 0;
  let d = 0;
  for (let i = 1; i <= 28; i++) c = (c << 1) | getBit(pc1, i);
  for (let i = 29; i <= 56; i++) d = (d << 1) | getBit(pc1, i);

  const subkeys: Uint8Array[] = [];
  for (let round = 0; round < 16; round++) {
    const s = DES_SHIFTS[round]!;
    c = ((c << s) | (c >>> (28 - s))) & 0x0fffffff;
    d = ((d << s) | (d >>> (28 - s))) & 0x0fffffff;

    const cd = new Uint8Array(7);
    for (let i = 0; i < 28; i++) setBit(cd, i + 1, (c >>> (27 - i)) & 1);
    for (let i = 0; i < 28; i++) setBit(cd, 29 + i, (d >>> (27 - i)) & 1);
    subkeys.push(permute(cd, DES_PC2));
  }
  return subkeys;
}

const SAAVN_SUBKEYS = desSubkeys(SAAVN_DES_KEY);

function feistel(r: Uint8Array, subkey: Uint8Array): Uint8Array {
  const expanded = permute(r, DES_E);
  for (let i = 0; i < 6; i++) expanded[i]! ^= subkey[i]!;

  const sOut = new Uint8Array(4);
  for (let box = 0; box < 8; box++) {
    const offset = box * 6 + 1;
    const b1 = getBit(expanded, offset);
    const b2 = getBit(expanded, offset + 1);
    const b3 = getBit(expanded, offset + 2);
    const b4 = getBit(expanded, offset + 3);
    const b5 = getBit(expanded, offset + 4);
    const b6 = getBit(expanded, offset + 5);
    const row = (b1 << 1) | b6;
    const col = (b2 << 3) | (b3 << 2) | (b4 << 1) | b5;
    const val = DES_S[box]![row * 16 + col]!;
    const outBit = box * 4;
    setBit(sOut, outBit + 1, (val >> 3) & 1);
    setBit(sOut, outBit + 2, (val >> 2) & 1);
    setBit(sOut, outBit + 3, (val >> 1) & 1);
    setBit(sOut, outBit + 4, val & 1);
  }
  return permute(sOut, DES_P);
}

function decryptDesBlock(block: Uint8Array, subkeys: readonly Uint8Array[]): Uint8Array {
  const ip = permute(block, DES_IP);
  let left = ip.subarray(0, 4);
  let right = ip.subarray(4, 8);
  for (let round = 15; round >= 0; round--) {
    const f = feistel(right, subkeys[round]!);
    const nextRight = new Uint8Array(4);
    for (let i = 0; i < 4; i++) nextRight[i] = left[i]! ^ f[i]!;
    left = right;
    right = nextRight;
  }
  const combined = new Uint8Array(8);
  combined.set(right, 0);
  combined.set(left, 4);
  return permute(combined, DES_FP);
}

/** Decrypts a JioSaavn `encrypted_media_url` payload using DES/ECB/PKCS5Padding. */
export function decryptSaavnMediaUrl(encryptedBase64: string): string {
  const trimmed = encryptedBase64.trim();
  if (!trimmed) return '';
  try {
    const binary = atob(trimmed);
    if (!binary.length || binary.length % 8 !== 0) return '';
    const cipher = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) cipher[i] = binary.charCodeAt(i);

    const plain = new Uint8Array(cipher.length);
    for (let offset = 0; offset < cipher.length; offset += 8) {
      plain.set(decryptDesBlock(cipher.subarray(offset, offset + 8), SAAVN_SUBKEYS), offset);
    }

    const pad = plain[plain.length - 1] ?? 0;
    const end = pad >= 1 && pad <= 8 && plain.subarray(plain.length - pad).every((b) => b === pad)
      ? plain.length - pad
      : plain.length;
    return new TextDecoder().decode(plain.subarray(0, end)).trim();
  } catch {
    return '';
  }
}

/** Picks the highest JioSaavn rendition without dropping URL query parameters (JioSaavnService.kt). */
export function selectBestSaavnStream(
  decryptedUrl: string,
  supports320: boolean,
): { url: string; kbps: number | null } | null {
  if (!decryptedUrl.trim()) return null;
  const normalized = decryptedUrl
    .trim()
    .replace(/^http:\/\//i, 'https://')
    .replace(/^(https?:\/\/)h\.saavncdn\.com/i, '$1aac.saavncdn.com');

  const match = /_(48|96|160|320)\.(mp4|aac|mp3)(?=[?#]|$)/i.exec(normalized);
  if (!match) return { url: normalized, kbps: null };

  const offered = Number(match[1]);
  if (!supports320) return { url: normalized, kbps: offered };

  const ext = match[2]!;
  const upgraded = `${normalized.slice(0, match.index)}_320.${ext}${normalized.slice(match.index + match[0].length)}`;
  return { url: upgraded, kbps: 320 };
}

// ---- JioSaavn Track Search + Matching ---------------------------------------

interface RawSaavnArtist {
  name?: string;
}

interface RawSaavnSong {
  id?: string;
  title?: string;
  subtitle?: string;
  image?: string;
  explicit_content?: string | boolean;
  more_info?: {
    album?: string;
    duration?: string | number;
    encrypted_media_url?: string;
    '320kbps'?: string | boolean;
    singers?: string;
    artistMap?: { primary_artists?: RawSaavnArtist[] };
  };
}

interface SaavnCandidate extends MatchCandidate {
  id: string;
  encryptedUrl: string;
  supports320: boolean;
  thumbnail: string | null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&#039;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function toSaavnCandidate(item: RawSaavnSong): SaavnCandidate | null {
  const title = decodeHtmlEntities(item.title ?? '').trim();
  const encryptedUrl = item.more_info?.encrypted_media_url?.trim() ?? '';
  if (!title || !encryptedUrl) return null;

  const primaryArtists = (item.more_info?.artistMap?.primary_artists ?? [])
    .map((a) => decodeHtmlEntities(a.name ?? '').trim())
    .filter(Boolean);
  const artist =
    primaryArtists.join(', ') ||
    decodeHtmlEntities(item.more_info?.singers ?? item.subtitle ?? '').trim();
  const durationRaw = Number(item.more_info?.duration ?? 0);
  const durationSec = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : null;
  const album = item.more_info?.album ? decodeHtmlEntities(item.more_info.album).trim() : null;
  const explicit = item.explicit_content === '1' || item.explicit_content === true || item.explicit_content === 'true';
  const supports320 = item.more_info?.['320kbps'] === true || String(item.more_info?.['320kbps']).toLowerCase() === 'true';
  const thumbnail = item.image ? item.image.replace(/^http:\/\//i, 'https://').replace('150x150', '500x500') : null;

  return {
    id: item.id ?? '',
    title,
    artist,
    durationSec,
    album,
    explicit,
    encryptedUrl,
    supports320,
    thumbnail,
  };
}

export async function resolveJioSaavnStream(hint: PlaybackTrackHint): Promise<SaavnFallbackStream | null> {
  const title = hint.title?.trim() ?? '';
  const artist = hint.artist?.trim() ?? '';
  if (!title) return null;

  const target: MatchTarget = {
    title,
    artist,
    durationSec: hint.durationSec ?? null,
    album: hint.album ?? null,
    isExplicit: hint.explicit ?? null,
    isVideo: true,
  };

  const searchQueries = queries(target).slice(0, 2);
  if (!searchQueries.length) searchQueries.push([title, artist].filter(Boolean).join(' '));

  for (const query of searchQueries) {
    try {
      const targetUrl =
        `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=android&q=${encodeURIComponent(query)}&p=1&n=10`;
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(targetUrl)}`, { credentials: 'same-origin' });
      if (!res.ok) continue;

      const json = (await res.json()) as { results?: RawSaavnSong[] };
      const candidates = (json.results ?? [])
        .map(toSaavnCandidate)
        .filter((c): c is SaavnCandidate => c !== null);
      if (!candidates.length) continue;

      // Prefer explicit editions ahead of clean duplicates unless clean was specifically requested.
      const ordered =
        hint.explicit === false
          ? candidates
          : [...candidates].sort((a, b) => Number(Boolean(b.explicit)) - Number(Boolean(a.explicit)));

      const matched =
        best(ordered, target) ??
        best(ordered, { ...target, isExplicit: null }) ??
        (target.durationSec != null ? best(ordered, { ...target, durationSec: null, isExplicit: null }) : null);
      if (!matched) continue;

      const decrypted = decryptSaavnMediaUrl(matched.encryptedUrl);
      const stream = selectBestSaavnStream(decrypted, matched.supports320);
      if (!stream) continue;

      trackLog.i(`JioSaavn fallback matched "${matched.title}" (${stream.kbps ?? 'unknown'}kbps)`, matched.id);
      return {
        url: stream.url,
        kbps: stream.kbps,
        title: matched.title,
        author: matched.artist,
        durationSec: matched.durationSec ?? 0,
        thumbnail: matched.thumbnail,
      };
    } catch (error) {
      trackLog.w(`JioSaavn fallback search failed for "${query}": ${String(error)}`);
    }
  }
  return null;
}

// ---- YouTube Music Audio Counterpart Fallback (bypasses video age gates) ----

export async function findPlayableYouTubeCounterpart(
  yt: Innertube,
  originalVideoId: string,
  hint: PlaybackTrackHint,
): Promise<ResolvedPlayer | null> {
  const title = hint.title?.trim();
  if (!title) return null;

  const target: MatchTarget = {
    title,
    artist: hint.artist ?? '',
    durationSec: hint.durationSec ?? null,
    album: hint.album ?? null,
    isExplicit: hint.explicit ?? null,
    isVideo: true,
  };
  const searchQuery = queries(target)[0] ?? [searchableTitle(title, hint.artist ?? '') || title, hint.artist ?? ''].filter(Boolean).join(' ').trim();
  if (!searchQuery) return null;

  try {
    const search = await yt.music.search(searchQuery, { type: 'song' });
    const shelf = search.songs ?? search.contents?.find((c) => c.type === 'MusicShelf');
    const tracks = mapPlaylistTracks((shelf as { contents?: readonly unknown[] } | undefined)?.contents ?? [])
      .filter((t) => t.videoId && t.videoId !== originalVideoId);

    const candidates = tracks.map((track) => ({
      track,
      title: track.title,
      artist: track.artists.map((a) => a.name).join(', '),
      durationSec: track.durationSec,
      album: track.album?.name ?? null,
      explicit: track.explicit,
    }));

    const matched = ranked(candidates, target);
    const orderedIds = (matched.length ? matched : ranked(candidates, { ...target, isExplicit: null }))
      .map((c) => c.track.videoId)
      .slice(0, 3);

    for (const candidateId of orderedIds) {
      try {
        const resolved = await resolvePlayer(yt, candidateId);
        trackLog.i(`counterpart song ${candidateId} resolved for blocked ${originalVideoId}`, originalVideoId);
        return resolved;
      } catch {
        // Try next candidate song.
      }
    }
  } catch (error) {
    trackLog.w(`YouTube counterpart lookup failed: ${String(error)}`, originalVideoId);
  }
  return null;
}
