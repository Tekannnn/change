import type { Innertube } from 'youtubei.js/web';
import { getInnertube, getSignedInnertube } from '@/playback/youtube/innertube';
import { LIKED_MUSIC_PLAYLIST, type LibrarySection } from './library';
import type { ArtistRef, BrowsePage, MusicItem, PlaylistPage, Track } from './types';

type Raw = Record<string, unknown>;

export interface PagedResult<T> {
  data: T;
  next: (() => Promise<PagedResult<T>>) | null;
}

function collect(root: unknown, key: string, out: Raw[] = []): Raw[] {
  if (Array.isArray(root)) {
    for (const item of root) collect(item, key, out);
  } else if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      if (k === key && v && typeof v === 'object' && !Array.isArray(v)) {
        out.push(v as Raw);
      } else {
        collect(v, key, out);
      }
    }
  }
  return out;
}

function textOf(node: unknown): string {
  if (!node) return '';
  if (typeof node === 'string') return node.trim();
  const n = node as {
    simpleText?: string;
    content?: string;
    text?: string;
    runs?: Array<{ text?: string }>;
  };
  if (typeof n.simpleText === 'string') return n.simpleText.trim();
  if (typeof n.content === 'string') return n.content.trim();
  if (typeof n.text === 'string') return n.text.trim();
  if (Array.isArray(n.runs)) return n.runs.map((r) => r.text ?? '').join('').trim();
  return '';
}

function bestThumb(node: unknown): string | null {
  const obj = node as {
    thumbnails?: Array<{ url?: string }>;
    thumbnail?: { thumbnails?: Array<{ url?: string }>; sources?: Array<{ url?: string }> };
    sources?: Array<{ url?: string }>;
  } | null;
  const list = obj?.thumbnails ?? obj?.thumbnail?.thumbnails ?? obj?.thumbnail?.sources ?? obj?.sources;
  if (!Array.isArray(list) || !list.length) return null;
  const url = list[list.length - 1]?.url;
  return typeof url === 'string' && url ? (url.startsWith('//') ? `https:${url}` : url) : null;
}

function parseDurationSec(raw: unknown): number | null {
  const s = textOf(raw);
  if (!s) return null;
  const parts = s.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return null;
}

function firstContinuation(root: unknown): string | null {
  const items = collect(root, 'continuationEndpoint');
  for (const ep of items) {
    const token = (ep.continuationCommand as { token?: string } | undefined)?.token;
    if (token) return token;
  }
  const next = collect(root, 'nextContinuationData')[0];
  if (typeof next?.continuation === 'string') return next.continuation;
  return null;
}

async function executeBrowse(
  yt: Innertube,
  params: { browseId?: string; continuation?: string },
): Promise<Raw> {
  // Try WEB first, then fall back to TV (TVHTML5) which has the broadest OAuth2 compatibility.
  try {
    const res = await yt.actions.execute('/browse', params);
    return (res.data ?? {}) as Raw;
  } catch {
    const res = await yt.actions.execute('/browse', { ...params, client: 'TV' });
    return (res.data ?? {}) as Raw;
  }
}

function normalizePlaylistId(id: string): string {
  const clean = id.trim();
  if (!clean) return clean;
  return clean.startsWith('VL') ? clean : `VL${clean}`;
}

function extractPlaylists(root: unknown): MusicItem[] {
  const seen = new Set<string>();
  const out: MusicItem[] = [];
  const push = (id: string, title: string, subtitle: string, thumbnail: string | null) => {
    const norm = normalizePlaylistId(id);
    if (!norm || seen.has(norm) || !title) return;
    seen.add(norm);
    out.push({
      kind: 'playlist',
      id: norm,
      title,
      subtitle: subtitle || 'Playlist',
      artists: [],
      album: null,
      thumbnail,
      wide: false,
      durationSec: null,
      explicit: false,
    });
  };

  for (const key of ['playlistRenderer', 'gridPlaylistRenderer', 'compactPlaylistRenderer']) {
    for (const r of collect(root, key)) {
      const id = typeof r.playlistId === 'string' ? r.playlistId : '';
      const title = textOf(r.title);
      const count = textOf(r.videoCountText ?? r.videoCountShortText);
      const subtitle = textOf(r.longBylineText ?? r.shortBylineText) || (count ? `${count} songs` : 'Playlist');
      const thumb = bestThumb(r.thumbnailRenderer ?? r.thumbnail ?? (Array.isArray(r.thumbnails) ? r.thumbnails[0] : null));
      push(id, title, subtitle, thumb);
    }
  }

  for (const r of collect(root, 'lockupViewModel')) {
    const contentType = typeof r.contentType === 'string' ? r.contentType : '';
    const contentId = typeof r.contentId === 'string' ? r.contentId : '';
    if (contentType !== 'LOCKUP_CONTENT_TYPE_PLAYLIST' && !contentId.startsWith('PL') && !contentId.startsWith('VL')) continue;
    const meta = r.metadata as { lockupMetadataViewModel?: { title?: unknown; metadata?: { contentMetadataViewModel?: { metadataRows?: Array<{ metadataParts?: Array<{ text?: unknown }> }> } } } } | undefined;
    const title = textOf(meta?.lockupMetadataViewModel?.title);
    const rows = meta?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
    const subtitle = rows.map((row) => (row.metadataParts ?? []).map((p) => textOf(p.text)).filter(Boolean).join(' • ')).filter(Boolean).join(' • ');
    const imgWrap = r.contentImage as { collectionThumbnailViewModel?: { primaryThumbnail?: { thumbnailViewModel?: { image?: unknown } } }; thumbnailViewModel?: { image?: unknown } } | undefined;
    const thumb = bestThumb(imgWrap?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.image ?? imgWrap?.thumbnailViewModel?.image);
    push(contentId, title, subtitle, thumb);
  }

  for (const r of collect(root, 'tileRenderer')) {
    const nav = (r.onSelectCommand as { browseEndpoint?: { browseId?: string } } | undefined)?.browseEndpoint?.browseId ?? '';
    const contentType = typeof r.contentType === 'string' ? r.contentType : '';
    if (contentType !== 'TILE_CONTENT_TYPE_PLAYLIST' && !nav.startsWith('VL') && !nav.startsWith('PL')) continue;
    const meta = r.metadata as { tileMetadataRenderer?: { title?: unknown; lines?: Array<{ lineRenderer?: { items?: Array<{ lineItemRenderer?: { text?: unknown } }> } }> } } | undefined;
    const title = textOf(meta?.tileMetadataRenderer?.title);
    const thumb = bestThumb((r.header as { tileHeaderRenderer?: { thumbnail?: unknown } } | undefined)?.tileHeaderRenderer?.thumbnail);
    push(nav, title, 'Playlist', thumb);
  }

  return out;
}

function extractTracks(root: unknown): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  const push = (videoId: string, title: string, artist: string, artistId: string | null, durationSec: number | null, thumbnail: string | null) => {
    if (!videoId || seen.has(videoId) || !title) return;
    seen.add(videoId);
    const artists: ArtistRef[] = artist ? [{ name: artist, id: artistId }] : [];
    out.push({
      videoId,
      title,
      artists,
      album: null,
      durationSec,
      explicit: false,
      thumbnail,
      index: out.length + 1,
      plays: null,
    });
  };

  for (const key of ['playlistVideoRenderer', 'videoRenderer', 'gridVideoRenderer', 'compactVideoRenderer']) {
    for (const r of collect(root, key)) {
      const videoId = typeof r.videoId === 'string' ? r.videoId : '';
      const title = textOf(r.title ?? r.headline);
      const byline = (r.shortBylineText ?? r.longBylineText ?? r.ownerText) as { runs?: Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> } | undefined;
      const artist = textOf(byline).replace(/\s*-\s*Topic$/, '');
      const artistId = byline?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ?? null;
      const dur = parseDurationSec(r.lengthText);
      const thumb = bestThumb(r.thumbnail);
      push(videoId, title, artist, artistId, dur, thumb);
    }
  }

  for (const r of collect(root, 'lockupViewModel')) {
    const contentType = typeof r.contentType === 'string' ? r.contentType : '';
    const contentId = typeof r.contentId === 'string' ? r.contentId : '';
    if (contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' || !contentId || contentId.startsWith('PL') || contentId.startsWith('VL')) continue;
    const meta = r.metadata as { lockupMetadataViewModel?: { title?: unknown; metadata?: { contentMetadataViewModel?: { metadataRows?: Array<{ metadataParts?: Array<{ text?: unknown }> }> } } } } | undefined;
    const title = textOf(meta?.lockupMetadataViewModel?.title);
    const rows = meta?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
    const artist = textOf(rows[0]?.metadataParts?.[0]?.text).replace(/\s*-\s*Topic$/, '');
    const imgWrap = r.contentImage as { thumbnailViewModel?: { image?: unknown } } | undefined;
    const thumb = bestThumb(imgWrap?.thumbnailViewModel?.image);
    push(contentId, title, artist, null, null, thumb);
  }

  for (const r of collect(root, 'tileRenderer')) {
    const videoId = (r.onSelectCommand as { watchEndpoint?: { videoId?: string } } | undefined)?.watchEndpoint?.videoId ?? '';
    if (!videoId) continue;
    const meta = r.metadata as { tileMetadataRenderer?: { title?: unknown; lines?: Array<{ lineRenderer?: { items?: Array<{ lineItemRenderer?: { text?: unknown } }> } }> } } | undefined;
    const title = textOf(meta?.tileMetadataRenderer?.title);
    const artist = textOf(meta?.tileMetadataRenderer?.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text).replace(/\s*-\s*Topic$/, '');
    const thumb = bestThumb((r.header as { tileHeaderRenderer?: { thumbnail?: unknown } } | undefined)?.tileHeaderRenderer?.thumbnail);
    push(videoId, title, artist, null, null, thumb);
  }

  return out;
}

function extractArtists(root: unknown): MusicItem[] {
  const seen = new Set<string>();
  const out: MusicItem[] = [];
  for (const key of ['channelRenderer', 'gridChannelRenderer', 'compactChannelRenderer']) {
    for (const r of collect(root, key)) {
      const id = typeof r.channelId === 'string' ? r.channelId : '';
      const title = textOf(r.title);
      if (!id || seen.has(id) || !title) continue;
      seen.add(id);
      out.push({
        kind: 'artist',
        id,
        title,
        subtitle: textOf(r.subscriberCountText) || 'Artist',
        artists: [{ name: title, id }],
        album: null,
        thumbnail: bestThumb(r.thumbnail),
        wide: false,
        durationSec: null,
        explicit: false,
      });
    }
  }
  return out;
}

const emptyPage = (title: string): BrowsePage => ({ title, shelves: [], grid: [], tracks: [] });

async function pagedBrowse(
  yt: Innertube,
  title: string,
  params: { browseId?: string; continuation?: string },
  extract: (data: Raw) => Pick<BrowsePage, 'grid' | 'tracks'>,
): Promise<PagedResult<BrowsePage>> {
  const data = await executeBrowse(yt, params);
  const token = firstContinuation(data);
  const { grid, tracks } = extract(data);
  return {
    data: { title, shelves: [], grid, tracks },
    next: token
      ? () =>
          pagedBrowse(yt, title, { continuation: token }, extract).catch(() => ({
            data: emptyPage(title),
            next: null,
          }))
      : null,
  };
}

export async function fetchOAuthLibrary(section: LibrarySection, title: string): Promise<PagedResult<BrowsePage>> {
  const yt = await getSignedInnertube();

  switch (section) {
    case 'playlists': {
      const page = await pagedBrowse(yt, title, { browseId: 'FEplaylist_aggregation' }, (data) => ({
        grid: extractPlaylists(data),
        tracks: [],
      })).catch(async () =>
        pagedBrowse(yt, title, { browseId: 'FElibrary' }, (data) => ({
          grid: extractPlaylists(data),
          tracks: [],
        })),
      );
      const hasLiked = page.data.grid.some((i) => i.id === 'VLLM' || i.id === `VL${LIKED_MUSIC_PLAYLIST}`);
      if (!hasLiked) {
        page.data.grid = [
          {
            kind: 'playlist',
            id: `VL${LIKED_MUSIC_PLAYLIST}`,
            title: 'Liked Music',
            subtitle: 'Auto playlist',
            artists: [],
            album: null,
            thumbnail: null,
            wide: false,
            durationSec: null,
            explicit: false,
          },
          ...page.data.grid,
        ];
      }
      return page;
    }

    case 'songs': {
      const lm = await pagedBrowse(yt, title, { browseId: 'VLLM' }, (data) => ({
        grid: [],
        tracks: extractTracks(data),
      })).catch(() => null);
      if (lm && lm.data.tracks.length > 0) return lm;
      return pagedBrowse(yt, title, { browseId: 'VLLL' }, (data) => ({
        grid: [],
        tracks: extractTracks(data),
      }));
    }

    case 'recent':
      return pagedBrowse(yt, title, { browseId: 'FEhistory' }, (data) => ({
        grid: [],
        tracks: extractTracks(data),
      }));

    case 'artists':
      return pagedBrowse(yt, title, { browseId: 'FEchannels' }, (data) => ({
        grid: extractArtists(data),
        tracks: [],
      }));

    case 'albums':
      return pagedBrowse(yt, title, { browseId: 'FElibrary' }, (data) => ({
        grid: extractPlaylists(data),
        tracks: [],
      }));

    case 'made-for-you': {
      // Public YouTube Music home mixes work cleanly via anonymous InnerTube without 400.
      const anon = await getInnertube();
      const home = await anon.music.getHomeFeed();
      const { mapHome } = await import('./mappers');
      const shelves = mapHome(home);
      const grid = shelves.flatMap((s) => s.items).filter((i) => i.kind === 'playlist' || i.kind === 'album');
      return {
        data: { title, shelves: [], grid, tracks: [] },
        next: null,
      };
    }
  }
}

export async function fetchOAuthPlaylist(id: string): Promise<{ page: PlaylistPage; more: PagedResult<Track[]>['next'] }> {
  const yt = await getSignedInnertube();
  const browseId = normalizePlaylistId(id);
  const data = await executeBrowse(yt, { browseId });
  const headerRenderer = collect(data, 'playlistHeaderRenderer')[0];
  const primarySidebar = collect(data, 'playlistSidebarPrimaryInfoRenderer')[0];
  const headerTitle =
    textOf(headerRenderer?.title) ||
    textOf(primarySidebar?.title) ||
    (browseId === 'VLLM' ? 'Liked Music' : browseId === 'VLLL' ? 'Liked Videos' : 'Playlist');
  const subtitle = textOf(headerRenderer?.subtitle ?? headerRenderer?.ownerText) || 'Playlist';
  const description = textOf(headerRenderer?.descriptionText) || null;
  const thumbnail = bestThumb(
    (headerRenderer?.playlistHeaderBanner as { heroPlaylistThumbnailRenderer?: { thumbnail?: unknown } } | undefined)
      ?.heroPlaylistThumbnailRenderer?.thumbnail ?? primarySidebar?.thumbnailRenderer,
  );
  const tracks = extractTracks(data);
  const token = firstContinuation(data);

  const loadMore = async (contToken: string): Promise<PagedResult<Track[]>> => {
    const nextData = await executeBrowse(yt, { continuation: contToken });
    const nextTracks = extractTracks(nextData);
    const nextToken = firstContinuation(nextData);
    return {
      data: nextTracks,
      next: nextToken ? () => loadMore(nextToken).catch(() => ({ data: [], next: null })) : null,
    };
  };

  return {
    page: {
      id,
      title: headerTitle,
      subtitle,
      meta: `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`,
      description,
      thumbnail,
      artists: [],
      explicit: false,
      library: null,
      tracks,
    },
    more: token ? () => loadMore(token).catch(() => ({ data: [], next: null })) : null,
  };
}
