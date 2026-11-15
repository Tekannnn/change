import { useState } from 'react';
import { SiSpotify } from 'react-icons/si';
import { PageHeader } from '@/components/PageHeader';
import { stateStyles } from '@/components/music/States';

/**
 * Spotify integration page: presents a clean "Connect Spotify" button placeholder
 * while YouTube Music playback and browsing run natively through the built-in proxy.
 */
export default function SpotifyPage() {
  const [clicked, setClicked] = useState(false);

  return (
    <>
      <PageHeader title="Spotify" />
      <div className={stateStyles.state}>
        <span className="mb-2 grid size-14 place-items-center rounded-2xl bg-[#1ed760] text-black">
          <SiSpotify size={30} />
        </span>
        <p className={stateStyles.title}>Connect Spotify</p>
        <p className={stateStyles.detail}>
          {clicked
            ? 'Spotify integration is prepared as a button for now. YouTube Music browsing, search, lyrics, and playback are active.'
            : 'Sync your Spotify playlists and Liked Songs into Bitrate.'}
        </p>
        <button
          type="button"
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-pill bg-[#1ed760] px-5 type-body-emphasized text-black transition-transform hover:brightness-105 active:scale-95"
          onClick={() => setClicked(true)}
        >
          <SiSpotify size={16} />
          <span>{clicked ? 'Spotify Ready Soon' : 'Connect Spotify'}</span>
        </button>
      </div>
    </>
  );
}
