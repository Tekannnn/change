import type { YtChannel } from '@bitchord/shared/bridge';

export interface StoredOAuthTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: string;
  scope?: string;
  token_type?: string;
  client?: { client_id: string; client_secret: string };
}

export type StoredYtAccount = YtChannel & { authUser: string };

export interface StoredYtOAuthSession {
  tokens: StoredOAuthTokens;
  account: StoredYtAccount;
}

const OAUTH_STORAGE_KEY = 'unknwser:yt_oauth';

export function loadStoredYtOAuth(): StoredYtOAuthSession | null {
  try {
    const raw = localStorage.getItem(OAUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredYtOAuthSession>;
    if (!parsed?.tokens?.access_token || !parsed.tokens.refresh_token || !parsed.tokens.expiry_date || !parsed.account) {
      return null;
    }
    return parsed as StoredYtOAuthSession;
  } catch {
    return null;
  }
}

export function saveStoredYtOAuth(session: StoredYtOAuthSession): void {
  try {
    localStorage.setItem(OAUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota errors.
  }
}

export function updateStoredYtOAuthTokens(tokens: StoredOAuthTokens): void {
  const existing = loadStoredYtOAuth();
  if (!existing) return;
  saveStoredYtOAuth({ ...existing, tokens });
}

export function clearStoredYtOAuth(): void {
  try {
    localStorage.removeItem(OAUTH_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
