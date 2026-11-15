import {
  BRIDGE_PROTOCOL,
  BridgeCallError,
  type Bridge,
  type BridgeMethod,
  type DetectedExtension,
  type ParamsOf,
  type ResultOf,
} from '@bitchord/shared/bridge';

const DEFAULT_TIMEOUT_MS = 30_000;

async function postProxy<M extends BridgeMethod>(
  body: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  externalSignal?: AbortSignal,
): Promise<ResultOf<M>> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }
  const timer = setTimeout(() => {
    controller.abort(new BridgeCallError('timeout', `Proxy request timed out after ${timeoutMs} ms`));
  }, timeoutMs);

  try {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new BridgeCallError('network', `Proxy answered HTTP ${response.status}`);
    }
    return (await response.json()) as ResultOf<M>;
  } catch (error) {
    if (error instanceof BridgeCallError) throw error;
    if (controller.signal.aborted && controller.signal.reason instanceof BridgeCallError) {
      throw controller.signal.reason;
    }
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new BridgeCallError('network', error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

const SIGNED_OUT_YT = {
  browserSignedIn: false,
  connected: false,
  signedIn: false,
  accounts: [],
  active: null,
  problem: null,
};

const SIGNED_OUT_SPOTIFY = {
  browserSignedIn: false,
  connected: false,
  signedIn: false,
  user: null,
  problem: null,
};

const UNAVAILABLE_DISCORD = {
  available: false,
  connected: false,
  enabled: false,
  user: null,
  gateway: 'off' as const,
  problem: null,
};

export const BUILTIN_INFO: ResultOf<'ping'> = {
  version: '1.0.0',
  protocol: BRIDGE_PROTOCOL,
  browser: 'chromium',
  capabilities: ['yt', 'lyrics'],
};

/** Built-in serverless/backend proxy bridge so YouTube Music and lyrics work without an extension. */
export const proxyBridge: Bridge = {
  transport: 'external',
  async call<M extends BridgeMethod>(method: M, params: ParamsOf<M>, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ResultOf<M>> {
    switch (method) {
      case 'ping':
        return BUILTIN_INFO as ResultOf<M>;
      case 'yt.fetch':
      case 'lyrics.fetch':
      case 'addon.fetch':
        return postProxy<M>(params, options?.timeoutMs, options?.signal);
      case 'lyrics.permissions':
        return { granted: (params as ParamsOf<'lyrics.permissions'>).origins ?? [] } as ResultOf<M>;
      case 'lyrics.requestPermissions':
        return {} as ResultOf<M>;
      case 'yt.authState':
      case 'yt.selectChannel':
      case 'yt.setConnected':
        return SIGNED_OUT_YT as ResultOf<M>;
      case 'spotify.authState':
      case 'spotify.setConnected':
        return SIGNED_OUT_SPOTIFY as ResultOf<M>;
      case 'spotify.signIn':
        return {} as ResultOf<M>;
      case 'spotify.playlists':
      case 'spotify.tracks':
        return { items: [], total: 0, raw: 0 } as ResultOf<M>;
      case 'spotify.playlist':
        return { name: '', owner: null, imageUrl: null, total: 0 } as ResultOf<M>;
      case 'spotify.searchTracks':
        return [] as unknown as ResultOf<M>;
      case 'spotify.canvas':
        return { url: null } as ResultOf<M>;
      case 'discord.state':
      case 'discord.disconnect':
      case 'discord.setEnabled':
        return UNAVAILABLE_DISCORD as ResultOf<M>;
      case 'discord.connect':
      case 'discord.presence':
        return {} as ResultOf<M>;
      default:
        throw new BridgeCallError('unsupported', `${String(method)} is not supported by the built-in proxy`);
    }
  },
  subscribe() {
    return () => {};
  },
};

export const builtInExtension: DetectedExtension = {
  bridge: proxyBridge,
  info: BUILTIN_INFO,
};
