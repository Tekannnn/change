import type { YtAuthState } from '@bitchord/shared/bridge';
import { resetSignedInnertube, simpleRequestFetch } from '@/playback/youtube/innertube';
import {
  clearStoredYtOAuth,
  loadStoredYtOAuth,
  saveStoredYtOAuth,
  type StoredOAuthTokens,
  type StoredYtAccount,
  type StoredYtOAuthSession,
} from './ytOAuthStorage';

export interface OAuthPendingInfo {
  userCode: string;
  verificationUrl: string;
}

export const SIGNED_OUT_STATE: YtAuthState = {
  browserSignedIn: false,
  connected: false,
  signedIn: false,
  accounts: [],
  active: null,
  problem: null,
};

export function toYtAuthState(session: StoredYtOAuthSession | null): YtAuthState {
  if (!session) return SIGNED_OUT_STATE;
  const { account } = session;
  return {
    browserSignedIn: true,
    connected: true,
    signedIn: true,
    accounts: [
      {
        authUser: account.authUser,
        name: account.name,
        email: account.handle,
        avatarUrl: account.avatarUrl,
        channels: [account],
      },
    ],
    active: account,
    problem: null,
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Interactive YouTube / Google Device OAuth2 flow via youtubei.js + `/api/proxy`.
 * The user signs in directly on Google's official page with their Google credentials,
 * unlocking their personal YouTube Music library and playlists without any extension.
 */
export async function startYtOAuthFlow(
  onPending: (info: OAuthPendingInfo) => void,
  signal?: AbortSignal,
): Promise<YtAuthState> {
  const { Innertube } = await import('youtubei.js/web');
  const yt = await Innertube.create({
    fetch: simpleRequestFetch,
    retrieve_player: false,
    generate_session_locally: true,
  });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const oauth = yt.session.oauth;
  const clientId = oauth.client_id ?? (await oauth.getClientID());
  oauth.client_id = clientId;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const codeData = await oauth.getDeviceAndUserCode();
  onPending({
    userCode: codeData.user_code,
    verificationUrl: codeData.verification_url,
  });

  const expiresAt = Date.now() + (codeData.expires_in || 1800) * 1000;
  let intervalMs = Math.max(3000, (codeData.interval || 5) * 1000);

  let rawToken: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
  } | null = null;

  while (Date.now() < expiresAt) {
    await sleep(intervalMs, signal);
    const resp = await simpleRequestFetch('https://www.youtube.com/o/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId.client_id,
        client_secret: clientId.client_secret,
        code: codeData.device_code,
        grant_type: 'http://oauth.net/grant_type/device/1.0',
      }),
      signal,
    });
    const data = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
      error?: string;
      error_description?: string;
    };

    if (data.access_token && data.refresh_token) {
      rawToken = data;
      break;
    }

    if (data.error === 'authorization_pending') {
      continue;
    }
    if (data.error === 'slow_down') {
      intervalMs += 2000;
      continue;
    }
    if (data.error === 'access_denied') {
      throw new Error('Sign-in was cancelled on Google.');
    }
    if (data.error === 'expired_token') {
      throw new Error('The sign-in code expired. Please try again.');
    }
    throw new Error(data.error_description || data.error || 'Google sign-in failed.');
  }

  if (!rawToken?.access_token || !rawToken.refresh_token) {
    throw new Error('Google sign-in timed out. Please try again.');
  }

  const tokens: StoredOAuthTokens = {
    access_token: rawToken.access_token,
    refresh_token: rawToken.refresh_token,
    expiry_date: new Date(Date.now() + (rawToken.expires_in ?? 3600) * 1000).toISOString(),
    ...(rawToken.scope && { scope: rawToken.scope }),
    ...(rawToken.token_type && { token_type: rawToken.token_type }),
    client: clientId,
  };

  oauth.setTokens(tokens);
  yt.session.logged_in = true;

  let name = 'YouTube Music';
  let handle: string | null = null;
  let avatarUrl: string | null = null;
  try {
    const info = (await yt.account.getInfo()) as unknown as {
      contents?: {
        sections?: Array<{
          contents?: Array<{
            account_name?: { toString?: () => string };
            channel_handle?: { toString?: () => string };
            account_photo?: Array<{ url?: string }>;
          }>;
        }>;
      };
    };
    const header = info?.contents?.sections?.[0]?.contents?.[0];
    const parsedName = header?.account_name?.toString?.().trim();
    const parsedHandle = header?.channel_handle?.toString?.().trim();
    const parsedAvatar = header?.account_photo?.[0]?.url;
    if (parsedName && parsedName !== 'N/A') name = parsedName;
    if (parsedHandle && parsedHandle !== 'N/A') handle = parsedHandle;
    if (parsedAvatar) avatarUrl = parsedAvatar;
  } catch {
    // Fallback to default YouTube Music label if account_menu doesn't return metadata.
  }

  const account: StoredYtAccount = {
    id: handle || 'yt-oauth',
    name,
    handle,
    avatarUrl,
    brand: false,
    authUser: '0',
  };

  const session: StoredYtOAuthSession = { tokens, account };
  saveStoredYtOAuth(session);
  resetSignedInnertube();
  return toYtAuthState(session);
}

export async function signOutYtOAuth(): Promise<YtAuthState> {
  const existing = loadStoredYtOAuth();
  clearStoredYtOAuth();
  resetSignedInnertube();
  if (existing?.tokens?.access_token) {
    void simpleRequestFetch(
      `https://www.youtube.com/o/oauth2/revoke?token=${encodeURIComponent(existing.tokens.access_token)}`,
      { method: 'POST' },
    ).catch(() => undefined);
  }
  return SIGNED_OUT_STATE;
}
