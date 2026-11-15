import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { DetectedExtension, YtAuthState } from '@bitchord/shared/bridge';
import { queryClient } from '@/lib/queryClient';
import { useOwnerPopup } from '@/state/ownerPopup';
import { extensionQueryKey, useExtension } from './useExtension';
import { SIGNED_OUT_STATE, signOutYtOAuth, toYtAuthState } from './ytOAuth';
import { loadStoredYtOAuth } from './ytOAuthStorage';

export const ytAuthQueryKey = ['yt', 'auth'] as const;

const SIGNED_OUT: YtAuthState = SIGNED_OUT_STATE;

function detected(): DetectedExtension | null {
  return queryClient.getQueryData<DetectedExtension | null>(extensionQueryKey) ?? null;
}

function supportsAuth(extension: DetectedExtension | null): boolean {
  return !!extension?.info.capabilities.includes('yt.auth');
}

/** The current state, for code outside React (the music API, the player). */
export function ytAuthSnapshot(): YtAuthState {
  return queryClient.getQueryData<YtAuthState>(ytAuthQueryKey) ?? toYtAuthState(loadStoredYtOAuth());
}

/** A key for "who is asking", which changes whenever the answers YouTube gives would. */
export function identityOf(state: YtAuthState): string {
  return state.signedIn && state.active ? state.active.id : 'anonymous';
}

let lastIdentity: string | null = null;
let musicIdentity: string | null = null;

export function noteMusicIdentity(identity: string): void {
  musicIdentity ??= identity;
  if (musicIdentity !== identity) resetMusic();
  musicIdentity = identity;
}

function resetMusic(): void {
  musicIdentity = null;
  void queryClient.cancelQueries({ queryKey: ['music'] }).then(() => queryClient.resetQueries({ queryKey: ['music'] }));
}

/**
 * Takes in a new state. When the identity changes (sign-in, sign-out, a
 * channel switch), everything read as the old identity is dropped: the home
 * feed, the library, playlists, and the resolver's verdicts.
 */
export function adoptYtAuth(state: YtAuthState, options?: { showCredit?: boolean }): void {
  const prev = queryClient.getQueryData<YtAuthState>(ytAuthQueryKey);
  queryClient.setQueryData(ytAuthQueryKey, state);
  const identity = identityOf(state);
  if (lastIdentity !== null && identity !== lastIdentity) {
    // Loaded on demand: the resolver pulls in BotGuard, which the shell shouldn't.
    void import('@/playback/youtube/resolver').then((m) => m.onSessionChanged());
  }
  if (musicIdentity !== null && identity !== musicIdentity) resetMusic();
  if (options?.showCredit && !prev?.signedIn && state.signedIn) {
    useOwnerPopup.getState().show();
  }
  lastIdentity = identity;
}

async function readAuth(refresh: boolean): Promise<YtAuthState> {
  const extension = detected();
  if (extension && supportsAuth(extension)) {
    const state = await extension.bridge.call('yt.authState', { refresh }, { timeoutMs: 20_000 });
    adoptYtAuth(state);
    return state;
  }
  const oauthState = toYtAuthState(loadStoredYtOAuth());
  adoptYtAuth(oauthState);
  return oauthState;
}

/** Waits for the extension and the first auth read, so the first browse request already knows who is asking. */
export async function ensureYtAuth(): Promise<YtAuthState> {
  const cached = queryClient.getQueryData<YtAuthState>(ytAuthQueryKey);
  if (cached) return cached;
  return queryClient.fetchQuery({ queryKey: ytAuthQueryKey, queryFn: () => readAuth(false), staleTime: 30_000 });
}

export type YtAuthStatus = { state: 'checking' } | { state: 'unavailable' } | { state: 'ready'; auth: YtAuthState };

export function useYtAuth(): YtAuthStatus {
  const extension = useExtension();
  const present = extension.state === 'present' ? extension.extension : null;
  const hasExtAuth = supportsAuth(present);
  const query = useQuery({
    queryKey: ytAuthQueryKey,
    queryFn: () => readAuth(false),
    enabled: extension.state !== 'checking',
    staleTime: 30_000,
    refetchOnWindowFocus: hasExtAuth,
    retry: 1,
  });

  useEffect(() => {
    if (!present || !hasExtAuth) return;
    return present.bridge.subscribe((event) => {
      if (event.event === 'yt.authState') adoptYtAuth(event.data);
    });
  }, [present, hasExtAuth]);

  if (extension.state === 'checking' || query.isPending) return { state: 'checking' };
  return { state: 'ready', auth: query.data ?? SIGNED_OUT };
}

/** Switches the channel requests act as. */
export function useSelectChannel() {
  return useMutation({
    mutationFn: async (channelId: string) => {
      const extension = detected();
      if (!extension || !supportsAuth(extension)) throw new Error('Channel switching requires the extension');
      return extension.bridge.call('yt.selectChannel', { channelId });
    },
    onSuccess: (s) => adoptYtAuth(s),
  });
}

/** Re-reads the accounts from YouTube rather than the extension's cache. */
export function useRefreshYtAuth() {
  return useMutation({ mutationFn: () => readAuth(true) });
}

/** Connect or disconnect Audiophile from the user's YouTube session. */
export function useSetConnected() {
  return useMutation({
    mutationFn: async (connected: boolean) => {
      const extension = detected();
      if (extension && supportsAuth(extension)) {
        return extension.bridge.call('yt.setConnected', { connected });
      }
      if (!connected) {
        return signOutYtOAuth();
      }
      return toYtAuthState(loadStoredYtOAuth());
    },
    onSuccess: (s) => adoptYtAuth(s),
  });
}
