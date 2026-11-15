import { SabrStreamingAdapter } from 'googlevideo/sabr-streaming-adapter';
import { buildSabrFormat } from 'googlevideo/utils';
import shaka from 'shaka-player/dist/shaka-player.compiled';
import { Constants, Utils, YT, type Innertube } from 'youtubei.js/web';
import { timed, trackLog } from '../trackLog';
import { botguard } from './botguard';
import { ytAuthSnapshot } from '@/extension/useYtAuth';
import { getInnertube, getSignedInnertube } from './innertube';
import {
  findPlayableYouTubeCounterpart,
  resolveJioSaavnStream,
  type PlaybackTrackHint,
  type SaavnFallbackStream,
} from './fallbackStream';
import {
  CLIENT_ATTEMPTS,
  usesWebPo,
  excludeClient,
  playerRequest,
  resolvePlayer,
  UnplayableError,
  type PlayerClientName,
  type ResolvedPlayer,
} from './resolver';
import { ShakaPlayerAdapter } from './ShakaPlayerAdapter';

/** What the engine knows about the track it loaded. */
export interface LoadedTrack {
  videoId: string;
  title: string;
  author: string;
  durationSec: number;
  /** Largest first. */
  thumbnails: { url: string; width: number; height: number }[];
  client: PlayerClientName;
  /** The audio format actually selected, e.g. "251 opus 140kbps". */
  format: string;
  /** The same, field by field, for stats for nerds. */
  stream: StreamStats;
  loudnessDb: number | null;
}

/** What stats for nerds shows about the audio stream (the phone's NerdStats.Snapshot). */
export interface StreamStats {
  /** "Opus", "AAC". */
  codec: string | null;
  itag: string | null;
  bitrateKbps: number | null;
  sampleRateHz: number | null;
  channels: number | null;
  /** "direct" (googlevideo URLs, by range) or "SABR". */
  mode: 'direct' | 'SABR';
}

/** A music video's picture: a video-only DASH manifest over the same response's direct URLs. */
export interface VideoStream {
  videoId: string;
  manifest: string;
  /** Width over height of the largest rendition, e.g. 16/9. */
  aspect: number;
  /** Every height the response offers, largest first: what the quality switcher lists. */
  heights: number[];
}

/**
 * A square picture is YouTube's art track (a song): the album artwork as a
 * still video. Only a wider picture is a music video worth playing.
 */
const MIN_VIDEO_ASPECT = 1.2;

export class SupersededError extends Error {
  override readonly name = 'SupersededError';
}

/** How long to wait before re-asking after the server sent no media (its backoffs measured 0-2s). */
const RETRY_STREAMING_SECONDS = 2;

/** Waiting longer than this for the first audio means the client's stream isn't going to start. */
const FIRST_AUDIO_TIMEOUT_MS = 15_000;

function proxyStreamUrl(rawUrl: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  return `${base}/api/stream?url=${encodeURIComponent(rawUrl)}`;
}

/**
 * YouTube playback in the browser (prompt §5.2): a player request through
 * YouTube.js, then audio only through Shaka (or native HTMLAudioElement on
 * direct streams / iPhone/Safari), routed via `/api/stream` so it works everywhere without an
 * extension.
 */
export class YouTubeEngine {
  readonly audio: HTMLAudioElement;
  private player: shaka.Player | null = null;
  private adapter: SabrStreamingAdapter | null = null;
  private yt: Innertube | null = null;
  private generation = 0;
  private loading = false;
  private usingNativeAudio = false;
  private current: { videoId: string; client: PlayerClientName; signed: boolean } | null = null;
  private currentHint: PlaybackTrackHint | null = null;
  /** The response the playing track streams from, when it has direct URLs; the video picture comes from it too. */
  private direct: ResolvedPlayer | null = null;
  private preferredCodecs: string[];

  /** Raised when a track can't be played at all, after every fallback. */
  onFatal: (videoId: string, message: string, permanent: boolean) => void = () => {};
  /** Raised when the engine moved a track to another client mid-playback. */
  onRecovered: (track: LoadedTrack) => void = () => {};

  constructor(audio: HTMLAudioElement) {
    this.audio = audio;
    // Opus (itag 251) when the browser can decode it in MSE, AAC (140)
    // otherwise, which is Safari / iOS.
    const opus = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/webm; codecs="opus"');
    this.preferredCodecs = opus ? ['opus', 'mp4a'] : ['mp4a'];
  }

  private async ensurePlayer(): Promise<shaka.Player> {
    if (this.player) return this.player;
    shaka.polyfill.installAll();
    if (!shaka.Player.isBrowserSupported()) {
      throw new Error('This browser can’t play YouTube MSE streams (no Media Source Extensions)');
    }
    const player = new shaka.Player();
    player.configure({
      manifest: { disableVideo: true, disableText: true, disableThumbnails: true },
      abr: { enabled: false },
      preferredAudioCodecs: this.preferredCodecs,
      streaming: {
        bufferingGoal: 120,
        rebufferingGoal: 0.01,
        bufferBehind: 300,
        retryParameters: { maxAttempts: 1, baseDelay: 1000, backoffFactor: 1, fuzzFactor: 0.5, timeout: 30_000 },
        failureCallback: (error: shaka.util.Error) => {
          if (!isRefusal(error)) player.retryStreaming(RETRY_STREAMING_SECONDS);
        },
      },
    });
    await player.attach(this.audio);
    player.addEventListener('error', (event) => this.onShakaError((event as unknown as { detail: shaka.util.Error }).detail));
    this.player = player;
    return player;
  }

  /** Pays the cold costs before the first tap (InnerTubeXResolver.warm): the session, the player script, BotGuard. */
  async warm(): Promise<void> {
    this.yt ??= await getInnertube();
    await botguard.init().catch((error: unknown) => trackLog.w(`BotGuard warm-up failed: ${String(error)}`));
  }

  /**
   * Loads [videoId] and starts it at [startSec]. Resolves once audio is
   * actually flowing; rejects with [UnplayableError] for a settled "no",
   * [SupersededError] if another load replaced this one.
   */
  async load(
    videoId: string,
    {
      startSec = 0,
      autoplay = true,
      hint,
    }: { startSec?: number; autoplay?: boolean; hint?: PlaybackTrackHint } = {},
  ): Promise<LoadedTrack> {
    const generation = ++this.generation;
    this.loading = true;
    this.currentHint = hint ?? null;
    const started = performance.now();
    trackLog.i(`loading at ${startSec.toFixed(1)}s`, videoId);
    try {
      this.yt ??= await timed('InnerTube session', videoId, getInnertube);
      void botguard.init().catch((error: unknown) => trackLog.w(`BotGuard init failed: ${String(error)}`, videoId));

      const skip = new Set<PlayerClientName>();
      let lastError: unknown = null;
      let yt = this.yt;
      let signed = false;
      for (let attempt = 0; attempt < CLIENT_ATTEMPTS; attempt++) {
        let resolved: ResolvedPlayer;
        try {
          resolved = await timed('player request', videoId, () => resolvePlayer(yt, videoId, skip, signed));
        } catch (error) {
          if (error instanceof UnplayableError && error.ageGated && !signed && ytAuthSnapshot().signedIn) {
            trackLog.i('age-restricted; asking again signed in', videoId);
            yt = await timed('signed-in InnerTube session', videoId, getSignedInnertube);
            signed = true;
            skip.clear();
            attempt = -1;
            continue;
          }
          lastError = error;
          break;
        }
        this.checkCurrent(generation);
        try {
          const track = await this.startStream(resolved, startSec, autoplay, generation);
          trackLog.i(
            `playing via ${track.client}, ${track.format}, first audio after ${Math.round(performance.now() - started)}ms`,
            videoId,
          );
          return track;
        } catch (error) {
          if (error instanceof SupersededError) throw error;
          lastError = error;
          skip.add(resolved.client);
          excludeClient(videoId, resolved.client, `streaming failed: ${describe(error)}`, resolved.signed);
        }
      }

      if (hint?.title) {
        const counterpart = await findPlayableYouTubeCounterpart(yt, videoId, hint);
        this.checkCurrent(generation);
        if (counterpart) {
          try {
            const track = await this.startStream(counterpart, startSec, autoplay, generation);
            trackLog.i(
              `playing counterpart ${counterpart.videoId} via ${track.client}, ${track.format}, first audio after ${Math.round(performance.now() - started)}ms`,
              videoId,
            );
            return { ...track, videoId };
          } catch (error) {
            if (error instanceof SupersededError) throw error;
            lastError = error;
          }
        }

        const saavn = await resolveJioSaavnStream(hint);
        this.checkCurrent(generation);
        if (saavn) {
          try {
            const track = await this.startExternalDirectStream(videoId, saavn, startSec, autoplay, generation);
            trackLog.i(
              `playing fallback JioSaavn ${track.format}, first audio after ${Math.round(performance.now() - started)}ms`,
              videoId,
            );
            return track;
          } catch (error) {
            if (error instanceof SupersededError) throw error;
            lastError = error;
          }
        }
      }

      throw lastError instanceof Error ? lastError : new Error('No YouTube client could stream this track');
    } catch (error) {
      if (!(error instanceof SupersededError)) {
        trackLog.e(`load failed: ${describe(error)}`, videoId);
      }
      throw error;
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  private checkCurrent(generation: number) {
    if (generation !== this.generation) throw new SupersededError('Replaced by a newer load');
  }

  private async startStream(
    resolved: ResolvedPlayer,
    startSec: number,
    autoplay: boolean,
    generation: number,
  ): Promise<LoadedTrack> {
    if (hasDirectAudio(resolved.info)) {
      return this.startNativeDirectStream(resolved, startSec, autoplay, generation);
    }

    const player = await this.ensurePlayer();
    if (this.usingNativeAudio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      await player.attach(this.audio);
      this.usingNativeAudio = false;
    }

    const { videoId, client, info, signed } = resolved;
    await player.unload();
    this.adapter?.dispose();
    this.adapter = null;
    this.current = { videoId, client, signed };
    this.direct = null;

    const manifest = await this.sabrManifest(player, resolved);
    this.checkCurrent(generation);
    const mode = 'SABR' as const;

    await timed(`${client} ${mode} load`, videoId, () =>
      player.load(`data:application/dash+xml;base64,${btoa(manifest)}`, startSec, 'application/dash+xml'),
    );
    this.checkCurrent(generation);
    const selected = this.selectAudio(player);
    const format = `${selected.label} ${mode}`;

    let autoplayBlocked = false;
    if (autoplay) {
      await this.audio.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          autoplayBlocked = true;
          trackLog.w('autoplay was blocked by the browser; waiting for a tap', videoId);
        } else throw error;
      });
    }
    await this.firstAudio(generation, autoplayBlocked || !autoplay);

    const basic = info.basic_info;
    return {
      videoId,
      title: basic.title ?? '',
      author: basic.author ?? '',
      durationSec: basic.duration ?? Math.round(player.seekRange().end),
      thumbnails: [...(basic.thumbnail ?? [])]
        .map((t) => ({ url: t.url, width: t.width, height: t.height }))
        .sort((a, b) => b.width - a.width),
      client,
      format,
      stream: { ...selected.stats, mode },
      loudnessDb: info.player_config?.audio_config?.loudness_db ?? null,
    };
  }

  /**
   * Detaches Shaka and plays a direct audio URL natively via `<audio src="/api/stream?url=...">`.
   * Used by both YouTube direct streams and JioSaavn fallback streams across desktop, Android, and iPhone Safari.
   */
  private async playProxiedAudioUrl(
    videoId: string,
    rawUrl: string,
    startSec: number,
    autoplay: boolean,
    generation: number,
  ): Promise<void> {
    if (this.player) {
      await this.player.unload().catch(() => {});
      await this.player.detach().catch(() => {});
    }
    this.adapter?.dispose();
    this.adapter = null;
    this.usingNativeAudio = true;

    this.audio.preload = 'auto';
    this.audio.src = proxyStreamUrl(rawUrl);
    this.audio.load();

    if (startSec > 0) {
      const applyStart = () => {
        if (generation === this.generation && Number.isFinite(startSec)) {
          this.audio.currentTime = startSec;
        }
      };
      if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA) applyStart();
      else this.audio.addEventListener('loadedmetadata', applyStart, { once: true });
    }

    let autoplayBlocked = false;
    if (autoplay) {
      await this.audio.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          autoplayBlocked = true;
          trackLog.w('autoplay was blocked by the browser; waiting for a tap', videoId);
        } else {
          throw error;
        }
      });
    }
    await this.firstAudio(generation, autoplayBlocked || !autoplay);
  }

  private async startNativeDirectStream(
    resolved: ResolvedPlayer,
    startSec: number,
    autoplay: boolean,
    generation: number,
  ): Promise<LoadedTrack> {
    const { videoId, client, info, signed } = resolved;
    this.current = { videoId, client, signed };
    this.direct = resolved;

    const candidates = (info.streaming_data?.adaptive_formats ?? []).filter(
      (f) => f.has_audio && !f.has_video && (f.url || f.signature_cipher || f.cipher),
    );
    if (!candidates.length) {
      throw new Error('No direct audio formats available');
    }

    const canPlay = (mime: string | undefined) => {
      if (!mime) return false;
      const result = this.audio.canPlayType(mime);
      return result === 'probably' || result === 'maybe';
    };
    const isMp4Audio = (mime: string | undefined) => !!mime && (/mp4a|audio\/mp4/i.test(mime));

    const playable = candidates.filter((f) => canPlay(f.mime_type));
    const pool = playable.length ? playable : candidates;
    const sorted = [...pool].sort((a, b) => {
      // Prefer AAC/MP4 first for universal compatibility across iOS Safari, Android, and desktop.
      const mp4Diff = Number(isMp4Audio(b.mime_type)) - Number(isMp4Audio(a.mime_type));
      if (mp4Diff !== 0) return mp4Diff;
      return (b.average_bitrate ?? b.bitrate ?? 0) - (a.average_bitrate ?? a.bitrate ?? 0);
    });
    const best = sorted[0]!;

    const deciphered = await best.decipher(resolved.yt.session.player);
    this.checkCurrent(generation);
    if (!deciphered) throw new Error('Could not decipher audio stream URL');

    const streamUrl = new URL(deciphered);
    if (usesWebPo(client)) {
      const pot = await botguard.mint(videoId);
      if (pot) streamUrl.searchParams.set('pot', pot);
    }
    this.checkCurrent(generation);

    await this.playProxiedAudioUrl(videoId, streamUrl.toString(), startSec, autoplay, generation);

    const isAac = isMp4Audio(best.mime_type);
    const codec = isAac ? 'AAC' : best.mime_type?.includes('opus') ? 'Opus' : codecName(best.mime_type ?? null);
    const bitrateKbps = Math.round((best.average_bitrate ?? best.bitrate ?? 0) / 1000) || null;
    const itag = best.itag ? String(best.itag) : null;
    const label = `${itag ?? ''} ${codec?.toLowerCase() ?? 'audio'} ${bitrateKbps ? `${bitrateKbps}kbps` : ''}`.trim();
    const basic = info.basic_info;

    return {
      videoId,
      title: basic.title ?? '',
      author: basic.author ?? '',
      durationSec: basic.duration ?? (Number.isFinite(this.audio.duration) ? Math.round(this.audio.duration) : 0),
      thumbnails: [...(basic.thumbnail ?? [])]
        .map((t) => ({ url: t.url, width: t.width, height: t.height }))
        .sort((a, b) => b.width - a.width),
      client,
      format: `${label} direct`,
      stream: {
        codec,
        itag,
        bitrateKbps,
        sampleRateHz: best.audio_sample_rate ?? null,
        channels: best.audio_channels ?? null,
        mode: 'direct',
      },
      loudnessDb: info.player_config?.audio_config?.loudness_db ?? null,
    };
  }

  private async startExternalDirectStream(
    videoId: string,
    saavn: SaavnFallbackStream,
    startSec: number,
    autoplay: boolean,
    generation: number,
  ): Promise<LoadedTrack> {
    this.current = null;
    this.direct = null;
    await this.playProxiedAudioUrl(videoId, saavn.url, startSec, autoplay, generation);

    const bitrateKbps = saavn.kbps ?? 320;
    return {
      videoId,
      title: saavn.title,
      author: saavn.author,
      durationSec: saavn.durationSec || (Number.isFinite(this.audio.duration) ? Math.round(this.audio.duration) : 0),
      thumbnails: saavn.thumbnail ? [{ url: saavn.thumbnail, width: 500, height: 500 }] : [],
      client: 'VISIONOS',
      format: `saavn aac ${bitrateKbps}kbps direct`,
      stream: {
        codec: 'AAC',
        itag: 'saavn',
        bitrateKbps,
        sampleRateHz: 44100,
        channels: 2,
        mode: 'direct',
      },
      loudnessDb: null,
    };
  }

  /**
   * The playing track's picture, if it's a music video: its video-only
   * renditions from the same response, as a DASH manifest for a second,
   * muted player.
   */
  async videoStream(height: number | null = null): Promise<VideoStream | null> {
    const resolved = this.direct;
    if (!resolved) return null;
    const { videoId, client, info } = resolved;
    const pictures = (info.streaming_data?.adaptive_formats ?? []).filter(
      (f) => f.has_video && !f.has_audio && f.width && f.height && (f.url || f.signature_cipher || f.cipher),
    );
    const largest = pictures.sort((a, b) => b.width! * b.height! - a.width! * a.height!)[0];
    if (!largest || largest.width! / largest.height! < MIN_VIDEO_ASPECT) return null;
    const heights = [...new Set(pictures.map((f) => f.height!))].sort((a, b) => b - a);
    const wanted = height !== null && heights.includes(height) ? height : null;
    const pot = usesWebPo(client) ? await botguard.mint(videoId) : undefined;
    const manifest = await info.toDash({
      format_filter: (format) => !format.has_video || format.has_audio || (wanted !== null && format.height !== wanted),
      url_transformer: (url) => {
        if (pot) url.searchParams.set('pot', pot);
        return new URL(proxyStreamUrl(url.toString()));
      },
      manifest_options: { include_thumbnails: false },
    });
    return { videoId, manifest, aspect: largest.width! / largest.height!, heights };
  }

  /** The SABR session: googlevideo's adapter in front of Shaka (Kira, googlevideo's example). */
  private async sabrManifest(player: shaka.Player, { videoId, client, info, yt }: ResolvedPlayer): Promise<string> {
    const streaming = info.streaming_data!;
    const sessionClient = yt.session.context.client;
    const adapter = new SabrStreamingAdapter({
      playerAdapter: new ShakaPlayerAdapter(),
      clientInfo: {
        osName: sessionClient.osName,
        osVersion: sessionClient.osVersion,
        clientName: parseInt(Constants.CLIENT_NAME_IDS[sessionClient.clientName as keyof typeof Constants.CLIENT_NAME_IDS]),
        clientVersion: sessionClient.clientVersion,
      },
    });

    const coldStart = await botguard.coldStartToken(videoId);
    let webPoToken: string | undefined;
    let minting = false;
    adapter.onMintPoToken(async () => {
      if (!webPoToken && !minting) {
        minting = true;
        void botguard.mint(videoId).then((token) => {
          webPoToken = token;
          minting = false;
        });
      }
      return webPoToken ?? coldStart;
    });

    adapter.onReloadPlayerResponse(async (reloadContext) => {
      trackLog.d(`SABR asked for a fresh player response (${client})`, videoId);
      const response = await playerRequest(yt, videoId, client, reloadContext);
      const reloaded = new YT.VideoInfo([response], yt.actions, Utils.generateRandomString(16));
      const rawReloadUrl = await yt.session.player!.decipher(reloaded.streaming_data?.server_abr_streaming_url);
      adapter.setStreamingURL(rawReloadUrl);
      adapter.setUstreamerConfig(
        (reloaded.player_config ?? info.player_config)?.media_common_config.media_ustreamer_request_config
          ?.video_playback_ustreamer_config,
      );
    });

    adapter.attach(player);
    this.adapter = adapter;

    const rawStreamingUrl = await yt.session.player!.decipher(streaming.server_abr_streaming_url);
    adapter.setStreamingURL(rawStreamingUrl);
    adapter.setUstreamerConfig(info.player_config?.media_common_config.media_ustreamer_request_config?.video_playback_ustreamer_config);
    adapter.setServerAbrFormats(streaming.adaptive_formats.map(buildSabrFormat));

    return info.toDash({
      manifest_options: { is_sabr: true, captions_format: 'vtt', include_thumbnails: false },
    });
  }

  /** Picks Opus 251 (else AAC 140): the preferred codec's highest bitrate, avoiding DRC renditions. */
  private selectAudio(player: shaka.Player): { label: string; stats: Omit<StreamStats, 'mode'> } {
    const tracks = player.getVariantTracks().filter((t) => !/drc/i.test(t.originalAudioId ?? ''));
    const statsOf = (t: shaka.extern.Track) => ({
      codec: codecName(t.audioCodec),
      itag: (t.originalAudioId ?? '').split('-')[0] || null,
      bitrateKbps: Math.round((t.audioBandwidth ?? t.bandwidth) / 1000) || null,
      sampleRateHz: t.audioSamplingRate,
      channels: t.channelsCount,
    });
    for (const codec of this.preferredCodecs) {
      const best = tracks
        .filter((t) => t.audioCodec?.startsWith(codec))
        .sort((a, b) => (b.audioBandwidth ?? b.bandwidth) - (a.audioBandwidth ?? a.bandwidth))[0];
      if (best) {
        if (!best.active) player.selectVariantTrack(best, true);
        const itag = (best.originalAudioId ?? '').split('-')[0];
        return { label: `${itag} ${codec} ${Math.round((best.audioBandwidth ?? best.bandwidth) / 1000)}kbps`, stats: statsOf(best) };
      }
    }
    const active = player.getVariantTracks().find((t) => t.active);
    return active
      ? { label: `${active.originalAudioId} ${active.audioCodec}`, stats: statsOf(active) }
      : { label: 'unknown', stats: { codec: null, itag: null, bitrateKbps: null, sampleRateHz: null, channels: null } };
  }

  /** Resolves once the element has data to play, or rejects after the timeout or media error. */
  private firstAudio(generation: number, allowLoadedMetadata = false): Promise<void> {
    const audio = this.audio;
    if (audio.error) {
      return Promise.reject(new Error(`Audio element error (${audio.error.code})`));
    }
    const targetReadyState = allowLoadedMetadata ? HTMLMediaElement.HAVE_METADATA : HTMLMediaElement.HAVE_FUTURE_DATA;
    if (audio.readyState >= targetReadyState) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        audio.removeEventListener('canplay', done);
        audio.removeEventListener('loadeddata', done);
        audio.removeEventListener('loadedmetadata', done);
        audio.removeEventListener('error', onError);
      };
      const done = () => {
        cleanup();
        if (generation !== this.generation) reject(new SupersededError('Replaced by a newer load'));
        else resolve();
      };
      const onError = () => {
        cleanup();
        const code = audio.error?.code;
        reject(new Error(code ? `Audio element error (${code})` : 'Audio stream failed to load'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`no audio within ${FIRST_AUDIO_TIMEOUT_MS / 1000}s`));
      }, FIRST_AUDIO_TIMEOUT_MS);
      audio.addEventListener('canplay', done);
      audio.addEventListener('loadeddata', done);
      if (allowLoadedMetadata) audio.addEventListener('loadedmetadata', done);
      audio.addEventListener('error', onError);
    });
  }

  private onShakaError(error: shaka.util.Error) {
    const current = this.current;
    const line = `Shaka error ${error.code} (severity ${error.severity}): ${describe(error)}`;
    if (!isRefusal(error)) {
      trackLog.d(line, current?.videoId ?? null);
      return;
    }
    trackLog.w(line, current?.videoId ?? null);
    if (this.loading || !current || error.severity !== shaka.util.Error.Severity.CRITICAL) return;
    this.current = null;
    excludeClient(current.videoId, current.client, `stream error ${error.code}`, current.signed);
    const resumeAt = this.audio.currentTime;
    const wasPlaying = !this.audio.paused;
    this.load(current.videoId, { startSec: resumeAt, autoplay: wasPlaying, hint: this.currentHint ?? undefined })
      .then((track) => this.onRecovered(track))
      .catch((failure: unknown) => {
        if (failure instanceof SupersededError) return;
        void this.stop();
        this.onFatal(current.videoId, describe(failure), failure instanceof UnplayableError);
      });
  }

  async stop(): Promise<void> {
    this.generation++;
    this.current = null;
    this.currentHint = null;
    this.direct = null;
    if (this.usingNativeAudio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.usingNativeAudio = false;
    }
    await this.player?.unload();
    this.adapter?.dispose();
    this.adapter = null;
  }
}

/** The codec under its usual name rather than its RFC 6381 string (the phone's codecLabel). */
function codecName(codec: string | null): string | null {
  if (!codec) return null;
  if (codec.startsWith('opus')) return 'Opus';
  if (codec.startsWith('mp4a')) return 'AAC';
  if (codec.startsWith('ec-3')) return 'E-AC-3';
  if (codec.startsWith('ac-3')) return 'AC-3';
  return codec.toUpperCase();
}

/** Whether the response carries audio URLs to fetch directly (VISIONOS does; the web clients only offer SABR). */
function hasDirectAudio(info: YT.VideoInfo): boolean {
  return !!info.streaming_data?.adaptive_formats.some((f) => f.has_audio && !f.has_video && (f.url || f.signature_cipher || f.cipher));
}

/** googlevideo saying no to this client, as opposed to pacing or a network blip. */
function isRefusal(error: shaka.util.Error): boolean {
  const status = error.data?.[1];
  if (error.code === shaka.util.Error.Code.BAD_HTTP_STATUS && (status === 401 || status === 403)) return true;
  return error.code === shaka.util.Error.Code.HTTP_ERROR && error.data?.[0] === 'Server streaming error';
}

function describe(error: unknown): string {
  if (error instanceof shaka.util.Error) {
    const detail = error.data?.[1];
    const status = typeof detail === 'number' ? ` HTTP ${detail}` : detail instanceof Error ? ` (${detail.message})` : '';
    const uri = typeof error.data?.[0] === 'string' ? ` ${error.data[0].slice(0, 80)}` : '';
    return `Shaka ${error.code}${status}${uri}`;
  }
  return error instanceof Error ? error.message : String(error);
}
