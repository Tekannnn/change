import { Check, Copy, ExternalLink, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SiYoutubemusic } from 'react-icons/si';
import { adoptYtAuth, useSetConnected, useYtAuth } from '@/extension/useYtAuth';
import { startYtOAuthFlow, type OAuthPendingInfo } from '@/extension/ytOAuth';
import { settingsUi } from './settingsStyles';

/**
 * YouTube Music account integration under Settings -> Account & Integrations.
 * Anonymous mode works by default ("Not signed in"). Pressing "Sign In" starts
 * real Google OAuth2 sign-in so users can access all their YouTube Music
 * library sections and personal playlists.
 */
export function YouTubeIntegration() {
  const auth = useYtAuth();
  const setConnected = useSetConnected();
  const [modalOpen, setModalOpen] = useState(false);
  const [pending, setPending] = useState<OAuthPendingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const isReady = auth.state === 'ready';
  const signedIn = isReady && auth.auth.signedIn;
  const browserSignedIn = isReady && auth.auth.browserSignedIn;

  const stopFlow = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  useEffect(() => stopFlow, []);

  const beginSignIn = () => {
    stopFlow();
    setPending(null);
    setError(null);
    setCopied(false);
    setModalOpen(true);

    const controller = new AbortController();
    abortRef.current = controller;

    void startYtOAuthFlow((info) => setPending(info), controller.signal)
      .then((nextState) => {
        if (controller.signal.aborted) return;
        setModalOpen(false);
        setPending(null);
        adoptYtAuth(nextState, { showCredit: true });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to sign in to YouTube Music.');
      });
  };

  const closeModal = () => {
    stopFlow();
    setModalOpen(false);
    setPending(null);
    setError(null);
  };

  const copyCode = async () => {
    if (!pending?.userCode) return;
    try {
      await navigator.clipboard.writeText(pending.userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable; code stays clearly visible on screen.
    }
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
              <button type="button" className={settingsUi.inlineButton} onClick={beginSignIn}>
                Sign In
              </button>
            </>
          )}
        </span>
      </div>

      {modalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-(--z-modal) grid animate-fade place-items-center bg-black/35 backdrop-blur-sm"
            onPointerDown={(e) => e.target === e.currentTarget && closeModal()}
          >
            <div
              className="glass-pill relative flex w-[min(410px,calc(100vw-32px))] animate-zoom flex-col gap-4 rounded-[18px] p-5"
              role="dialog"
              aria-modal="true"
              aria-label="Sign in to YouTube Music"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    className="grid size-7 place-items-center rounded-[7px] text-[#ff0033]"
                    style={{ backgroundColor: '#ffffff' }}
                    aria-hidden="true"
                  >
                    <SiYoutubemusic size={17} />
                  </span>
                  <h2 className="type-title-2-emphasized">Sign in to YouTube Music</h2>
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  aria-label="Close"
                  className="grid size-7 place-items-center rounded-full bg-quinary text-secondary hover:text-primary"
                >
                  <X size={15} />
                </button>
              </div>

              {error ? (
                <div className="flex flex-col gap-3">
                  <p className="type-body text-red">{error}</p>
                  <button
                    type="button"
                    onClick={beginSignIn}
                    className="inline-flex h-9 items-center justify-center rounded-[10px] bg-key-bg px-4 type-body-emphasized text-white"
                  >
                    Try Again
                  </button>
                </div>
              ) : !pending ? (
                <div className="flex items-center gap-2.5 py-4 text-secondary type-body">
                  <Loader2 size={16} className="animate-spin" />
                  <span>Preparing Google sign-in…</span>
                </div>
              ) : (
                <>
                  <p className="type-body-emphasized text-primary">Copy This Code</p>
                  <div className="flex items-center justify-between gap-3 rounded-[12px] bg-quinary px-4 py-3">
                    <span className="font-mono text-[20px] font-bold tracking-[0.14em] text-primary select-all">
                      {pending.userCode}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyCode()}
                      className="inline-flex items-center gap-1.5 rounded-[8px] bg-quaternary px-2.5 py-1.5 type-callout-emphasized text-primary"
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <a
                    href={pending.verificationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-key-bg px-4 type-body-emphasized text-white"
                  >
                    <span>Continue with Google Sign-In</span>
                    <ExternalLink size={15} />
                  </a>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
