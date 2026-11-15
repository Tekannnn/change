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

function applyTargetHostHeaders(target: URL, headers: Record<string, string>): void {
  const host = target.hostname.toLowerCase();
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

      const headers: Record<string, string> = {
        'User-Agent': CHROME_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      };
      const contentType = headerString(req.headers['content-type']);
      if (contentType) headers['Content-Type'] = contentType;
      applyTargetHostHeaders(target, headers);

      const method = (req.method ?? 'GET').toUpperCase();
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBuffer(req);

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
    applyTargetHostHeaders(target, headers);

    const method = (payload.method ?? 'GET').toUpperCase();
    let requestBody: Uint8Array | string | undefined;
    if (payload.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      requestBody =
        payload.bodyEncoding === 'base64' ? new Uint8Array(Buffer.from(payload.body, 'base64')) : payload.body;
    }

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

    // googlevideo rejects VISIONOS/ANDROID/IOS direct URLs with 403 when a YouTube Origin is attached.
    const clientParam = target.searchParams.get('c')?.toUpperCase();
    const skipOrigin = clientParam === 'VISIONOS' || clientParam === 'ANDROID' || clientParam === 'IOS';
    if (!skipOrigin) {
      headers['Origin'] = 'https://www.youtube.com';
      headers['Referer'] = 'https://www.youtube.com/';
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
