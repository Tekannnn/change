import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { SiYoutubemusic } from 'react-icons/si';
import { useRefreshYtAuth, useSetConnected, useYtAuth } from '@/extension/useYtAuth';
import { settingsUi } from './settingsStyles';

function extractPlaylistId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const list = url.searchParams.get('list');
    if (list) return list.trim();
  } catch {
    // Not a full URL; treat as a playlist ID if it looks like one.
  }
  const match = /[?&]list=([^&#\s]+)/.exec(trimmed);
  if (match?.[1]) return match[1].trim();
  return /^[A-Za-z0-9_-]{8,}$/.test(trimmed) ? trimmed : null;
}

/**
 * YouTube Music account row under Settings -> Account & Integrations.
 * Anonymous playback works immediately with no login required; by default this
 * shows "Not signed in" with a button for users who want to connect their account
 * or open their playlists.
 */
export function YouTubeIntegration() {
  const auth = useYtAuth();
  const setConnected = useSetConnected();
  const refresh = useRefreshYtAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [playlistInput, setPlaylistInput] = useState('');
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  const isReady = auth.state === 'ready';
  const signedIn = isReady && auth.auth.signedIn;
  const browserSignedIn = isReady && auth.auth.browserSignedIn;

  const handleOpenPlaylist = (e: FormEvent) => {
    e.preventDefault();
    const id = extractPlaylistId(playlistInput);
    if (!id) {
      setPlaylistError('Paste a valid YouTube or YouTube Music playlist URL or ID.');
      return;
    }
    setPlaylistError(null);
    setPlaylistInput('');
    setOpen(false);
    navigate(`/playlist/${encodeURIComponent(id)}`);
  };

  return (
    <>
      <div className={settingsUi.integration}>
        <span
          className="grid size-6 place-items-center rounded-[6px] text-[#ff0033]"
          style={{ backgroundColor: '#ffffff' }}
          aria-hidden="true"
        >
          <SiYoutubemusic size={15} />
        </span>
        <span className={settingsUi.integrationName}>YouTube Music</span>
        <span className={settingsUi.value}>
          {signedIn ? (
            <>
              <span className={settingsUi.dot} aria-hidden="true" />
              {auth.auth.active?.name ?? 'Signed in'}
              <button
                type="button"
                className={settingsUi.inlineButton}
                disabled={setConnected.isPending}
                onClick={() => setConnected.mutate(false)}
              >
                Disconnect
              </button>
            </>
          ) : browserSignedIn ? (
            <>
              Disconnected
              <button
                type="button"
                className={settingsUi.inlineButton}
                disabled={setConnected.isPending}
                onClick={() => setConnected.mutate(true)}
              >
                Connect
              </button>
            </>
          ) : (
            <>
              Not signed in
              <button
                type="button"
                className={settingsUi.inlineButton}
                onClick={() => setOpen((v) => !v)}
              >
                {open ? 'Close' : 'Sign In'}
              </button>
            </>
          )}
        </span>
      </div>

      {open && !signedIn && (
        <div className="relative flex flex-col gap-3 px-4 py-3 hairline-[16px]">
          <p className="type-callout text-secondary">
            Browsing, search, lyrics, and playback already work anonymously with no sign-in required. To play one of your
            playlists directly, paste its link or ID below, or sign in on YouTube Music in a supported desktop browser.
          </p>
          <form onSubmit={handleOpenPlaylist} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={playlistInput}
              onChange={(e) => {
                setPlaylistInput(e.target.value);
                if (playlistError) setPlaylistError(null);
              }}
              placeholder="Playlist URL or ID (e.g. PL...)"
              className="min-w-[200px] flex-1 rounded-[8px] border-0 bg-quaternary px-3 py-1.5 type-body text-primary placeholder:text-tertiary"
              aria-label="YouTube Music playlist URL or ID"
            />
            <button
              type="submit"
              className="rounded-[12px] bg-key-bg px-3.5 py-1.5 type-callout-emphasized text-white"
            >
              Open Playlist
            </button>
          </form>
          {playlistError && <p className="type-callout text-red">{playlistError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="https://music.youtube.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-[12px] bg-quaternary px-3 py-1.5 type-callout-emphasized text-primary"
            >
              Sign in on YouTube Music
            </a>
            <button
              type="button"
              className="inline-flex items-center rounded-[12px] bg-quaternary px-3 py-1.5 type-callout-emphasized text-primary disabled:opacity-50"
              disabled={refresh.isPending}
              onClick={() => void refresh.mutateAsync()}
            >
              {refresh.isPending ? 'Checking…' : 'Check Connection'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
