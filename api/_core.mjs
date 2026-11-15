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

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
}

function applyTargetHostHeaders(target, headers) {
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

function validateTargetUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readBodyBuffer(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body);
    return Buffer.from(JSON.stringify(req.body));
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function headerString(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export async function handleProxy(req, res) {
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

      const headers = {
        'User-Agent': CHROME_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      };
      const contentType = headerString(req.headers['content-type']);
      if (contentType) headers['Content-Type'] = contentType;
      applyTargetHostHeaders(target, headers);

      const method = (req.method ?? 'GET').toUpperCase();
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readBodyBuffer(req);

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

      res.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }

    if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let payload;
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      payload = req.body;
    } else {
      const rawBody = await readBodyBuffer(req);
      payload = JSON.parse(rawBody.toString('utf8'));
    }

    const target = validateTargetUrl(payload.url ?? null);
    if (!target) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid or missing url in JSON body' }));
      return;
    }

    const headers = {
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
    let requestBody;
    if (payload.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      requestBody =
        payload.bodyEncoding === 'base64' ? new Uint8Array(Buffer.from(payload.body, 'base64')) : payload.body;
    }

    const upstream = await fetch(target, {
      method,
      headers,
      body: requestBody,
      redirect: 'follow',
    });

    const resHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'content-length') {
        resHeaders[key] = value;
      }
    });

    const contentType = upstream.headers.get('content-type') ?? '';
    const textual = TEXTUAL_CONTENT_TYPE.test(contentType);
    const envelope = {
      status: upstream.status,
      headers: resHeaders,
      url: upstream.url,
      bodyEncoding: textual ? 'text' : 'base64',
      body: textual ? await upstream.text() : Buffer.from(await upstream.arrayBuffer()).toString('base64'),
    };

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(envelope));
  } catch (error) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}

export async function handleStream(req, res) {
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
    const headers = {
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
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBodyBuffer(req);

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

    const nodeStream = Readable.fromWeb(upstream.body);
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
