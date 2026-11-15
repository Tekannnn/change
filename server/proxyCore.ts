import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const FORBIDDEN_REQUEST_HEADERS = new Set([
  'host',
  'cookie',
  'origin',
  'referer',
  'x-origin',
  'content-length',
  'connection',
]);

const TEXTUAL_CONTENT_TYPE = /json|text|javascript|xml/i;

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
}

type YouTubeClientHeaders = {
  ua: string;
  isWeb: boolean;
  origin?: string;
};

function resolveYouTubeClientHeaders(clientNameRaw?: string | null, hostname?: string): YouTubeClientHeaders {
  const c = (clientNameRaw ?? '').trim().toUpperCase();
  const hostLower = hostname?.toLowerCase() ?? '';
  const hostOrigin =
    hostLower === 'music.youtube.com'
      ? 'https://music.youtube.com'
      : hostLower === 'm.youtube.com'
        ? 'https://m.youtube.com'
        : 'https://www.youtube.com';
  switch (c) {
    case 'VISIONOS':
      return {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        isWeb: false,
      };
    case 'IOS':
      return {
        ua: 'com.google.ios.youtube/21.29.1 (iPhone16,2; U; CPU iOS 18_5 like Mac OS X;)',
        isWeb: false,
      };
    case 'ANDROID_VR':
      return {
        ua: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
        isWeb: false,
      };
    case 'ANDROID':
      return {
        ua: 'com.google.android.youtube/21.26.364 (Linux; U; Android 15; en_US; Pixel 9 Pro; Build/AP4A.250205.002; Cronet/132.0.6834.79) gzip',
        isWeb: false,
      };
    case 'ANDROID_MUSIC':
      return {
        ua: 'com.google.android.apps.youtube.music/8.39.42 (Linux; U; Android 15; en_US; Pixel 9 Pro; Build/AP4A.250205.002) gzip',
        isWeb: false,
      };
    case 'MWEB':
      return {
        ua: 'Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1,gzip(gfe)',
        isWeb: true,
        origin: hostOrigin,
      };
    case 'WEB_REMIX':
    default:
      return { ua: CHROME_UA, isWeb: true, origin: hostOrigin };
  }
}

function deleteHeadersCI(headers: Record<string, string>, names: string[]): void {
  const lowerSet = new Set(names.map((n) => n.toLowerCase()));
  for (const key of Object.keys(headers)) {
    if (lowerSet.has(key.toLowerCase())) delete headers[key];
  }
}

function hasHeaderCI(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

function applyTargetHostHeaders(target: URL, headers: Record<string, string>, bodyText?: string): void {
  const host = target.hostname.toLowerCase();
  if (host === 'jiosaavn.com' || host.endsWith('.jiosaavn.com')) {
    headers['User-Agent'] = CHROME_UA;
    headers['Accept'] = 'application/json, text/plain, */*';
    headers['Accept-Language'] = 'en-IN,en;q=0.9';
    headers['X-Forwarded-For'] = '49.36.0.1';
    headers['X-Real-IP'] = '49.36.0.1';
    headers['Cookie'] = 'explicit_content=1; DL=english; L=english';
    deleteHeadersCI(headers, ['Origin', 'Referer', 'X-Origin']);
    return;
  }

  if (
    (host === 'music.youtube.com' || host === 'www.youtube.com' || host === 'youtube.com' || host === 's.youtube.com') &&
    target.pathname.startsWith('/youtubei/') &&
    bodyText
  ) {
    try {
      const parsed = JSON.parse(bodyText) as {
        context?: { client?: { clientName?: string; visitorData?: string } };
      };
      const clientName = parsed?.context?.client?.clientName;
      const visitorData = parsed?.context?.client?.visitorData;
      if (typeof visitorData === 'string' && visitorData && !hasHeaderCI(headers, 'x-goog-visitor-id')) {
        headers['X-Goog-Visitor-Id'] = visitorData;
      }
      if (clientName) {
        const clientInfo = resolveYouTubeClientHeaders(clientName, host);
        deleteHeadersCI(headers, ['User-Agent']);
        headers['User-Agent'] = clientInfo.ua;
        if (!clientInfo.isWeb) {
          deleteHeadersCI(headers, ['Origin', 'Referer', 'X-Origin']);
        } else if (clientInfo.origin) {
          headers['Origin'] = clientInfo.origin;
          headers['Referer'] = `${clientInfo.origin}/`;
          headers['X-Origin'] = clientInfo.origin;
        }
        return;
      }
    } catch {
      // Ignore non-JSON bodies and fall back to host defaults.
    }
  }

  if ((host === 'www.youtube.com' || host === 'youtube.com') && target.pathname === '/tv') {
    headers['User-Agent'] = 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version';
    headers['Referer'] = 'https://www.youtube.com/tv';
    deleteHeadersCI(headers, ['Origin', 'X-Origin']);
    return;
  }

  if (host === 'music.youtube.com') {
    headers['Origin'] = 'https://music.youtube.com';
    headers['Referer'] = 'https://music.youtube.com/';
    headers['X-Origin'] = 'https://music.youtube.com';
  } else if (host === 'www.youtube.com' || host === 'youtube.com' || host === 's.youtube.com') {
    headers['Origin'] = 'https://www.youtube.com';
    headers['Referer'] = 'https://www.youtube.com/';
    if (target.pathname.startsWith('/youtubei/')) {
      headers['X-Origin'] = 'https://www.youtube.com';
    }
  } else if (host.endsWith('apple.com')) {
    headers['Origin'] = 'https://music.apple.com';
    headers['Referer'] = 'https://music.apple.com/';
  }
}

function validateTargetUrl(rawUrl: string | null): URL | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readRequestBuffer(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function toBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('base64');
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Handles `/api/proxy` for both `?url=` mode and JSON Bridge Envelope mode. */
export async function handleProxyRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const reqUrl = new URL(req.url ?? '/', 'http://localhost');
  const queryTarget = reqUrl.searchParams.get('url');

  try {
    if (queryTarget) {
      const target = validateTargetUrl(queryTarget);
      if (!target) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid or missing target url' }));
        return;
      }

      const method = (req.method ?? 'GET').toUpperCase();
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBuffer(req);
      const bodyText = body && body.length > 0 ? body.toString('utf8') : undefined;

      const headers: Record<string, string> = {
        'User-Agent': CHROME_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      };
      const contentType = headerString(req.headers['content-type']);
      if (contentType) headers['Content-Type'] = contentType;
      const authorization = headerString(req.headers['authorization']);
      if (authorization) headers['Authorization'] = authorization;
      applyTargetHostHeaders(target, headers, bodyText);

      const upstream = await fetch(target, {
        method,
        headers,
        body: body && body.length > 0 ? new Uint8Array(body) : undefined,
        redirect: 'follow',
      });

      res.statusCode = upstream.status;
      const upstreamType = upstream.headers.get('content-type');
      if (upstreamType) res.setHeader('Content-Type', upstreamType);
      const cacheControl = upstream.headers.get('cache-control');
      if (cacheControl) res.setHeader('Cache-Control', cacheControl);

      const data = Buffer.from(await upstream.arrayBuffer());
      res.end(data);
      return;
    }

    if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const rawBody = await readRequestBuffer(req);
    const payload = JSON.parse(rawBody.toString('utf8')) as {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      bodyEncoding?: 'text' | 'base64';
    };

    const target = validateTargetUrl(payload.url ?? null);
    if (!target) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid or missing url in JSON body' }));
      return;
    }

    const method = (payload.method ?? 'GET').toUpperCase();
    let requestBody: Uint8Array | string | undefined;
    let bodyText: string | undefined;
    if (payload.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      if (payload.bodyEncoding === 'base64') {
        const buf = Buffer.from(payload.body, 'base64');
        requestBody = new Uint8Array(buf);
        bodyText = buf.toString('utf8');
      } else {
        requestBody = payload.body;
        bodyText = payload.body;
      }
    }

    const headers: Record<string, string> = {
      'User-Agent': CHROME_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    };
    if (payload.headers && typeof payload.headers === 'object') {
      for (const [key, value] of Object.entries(payload.headers)) {
        if (!FORBIDDEN_REQUEST_HEADERS.has(key.toLowerCase())) {
          headers[key] = value;
        }
      }
    }
    applyTargetHostHeaders(target, headers, bodyText);

    const upstream = await fetch(target, {
      method,
      headers,
      body: requestBody as BodyInit | undefined,
      redirect: 'follow',
    });

    const resHeaders: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'content-length') {
        resHeaders[key] = value;
      }
    });

    const contentType = upstream.headers.get('content-type') ?? '';
    const textual = TEXTUAL_CONTENT_TYPE.test(contentType);
    const responseEnvelope = {
      status: upstream.status,
      headers: resHeaders,
      url: upstream.url,
      bodyEncoding: textual ? ('text' as const) : ('base64' as const),
      body: textual ? await upstream.text() : toBase64(await upstream.arrayBuffer()),
    };

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(responseEnvelope));
  } catch (error) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}

/** Handles `/api/stream?url=` for YouTube audio/video byte-range streaming. */
export async function handleStreamRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const reqUrl = new URL(req.url ?? '/', 'http://localhost');
  const target = validateTargetUrl(reqUrl.searchParams.get('url'));
  if (!target) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Invalid or missing target url' }));
    return;
  }
  for (const [key, value] of reqUrl.searchParams) {
    if (key !== 'url') target.searchParams.set(key, value);
  }

  try {
    const headers: Record<string, string> = {
      'User-Agent': CHROME_UA,
      'Accept-Encoding': 'identity',
    };
    const range = headerString(req.headers['range']);
    if (range) headers['Range'] = range;
    const contentType = headerString(req.headers['content-type']);
    if (contentType) headers['Content-Type'] = contentType;

    // googlevideo requires User-Agent/Origin to match the issuing client; native clients reject Origin/Referer.
    const host = target.hostname.toLowerCase();
    if (host.endsWith('googlevideo.com') || host.endsWith('youtube.com')) {
      const clientInfo = resolveYouTubeClientHeaders(target.searchParams.get('c'), host);
      headers['User-Agent'] = clientInfo.ua;
      if (clientInfo.isWeb && clientInfo.origin) {
        headers['Origin'] = clientInfo.origin;
        headers['Referer'] = `${clientInfo.origin}/`;
      }
    }

    const method = (req.method ?? 'GET').toUpperCase();
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBuffer(req);

    const upstream = await fetch(target, {
      method,
      headers,
      body: body && body.length > 0 ? new Uint8Array(body) : undefined,
      redirect: 'follow',
    });

    res.statusCode = upstream.status;
    res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') ?? 'bytes');
    for (const key of ['content-type', 'content-length', 'content-range', 'cache-control']) {
      const value = upstream.headers.get(key);
      if (value) res.setHeader(key, value);
    }

    if (method === 'HEAD' || !upstream.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    nodeStream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    req.on('close', () => {
      nodeStream.destroy();
    });
    nodeStream.pipe(res);
  } catch (error) {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}
