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

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
};

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

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export async function onRequest(context: { request: Request }): Promise<Response> {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const reqUrl = new URL(request.url);
  const queryTarget = reqUrl.searchParams.get('url');

  try {
    if (queryTarget) {
      const target = validateTargetUrl(queryTarget);
      if (!target) {
        return new Response(JSON.stringify({ error: 'Invalid or missing target url' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const headers: Record<string, string> = {
        'User-Agent': CHROME_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      };
      const contentType = request.headers.get('content-type');
      if (contentType) headers['Content-Type'] = contentType;
      applyTargetHostHeaders(target, headers);

      const method = request.method.toUpperCase();
      const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

      const upstream = await fetch(target.toString(), {
        method,
        headers,
        body: body && body.byteLength > 0 ? body : undefined,
        redirect: 'follow',
      });

      const responseHeaders = new Headers(CORS_HEADERS);
      const upstreamType = upstream.headers.get('content-type');
      if (upstreamType) responseHeaders.set('Content-Type', upstreamType);
      const cacheControl = upstream.headers.get('cache-control');
      if (cacheControl) responseHeaders.set('Cache-Control', cacheControl);

      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    if (request.method.toUpperCase() !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const payload = (await request.json()) as {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      bodyEncoding?: 'text' | 'base64';
    };

    const target = validateTargetUrl(payload.url ?? null);
    if (!target) {
      return new Response(JSON.stringify({ error: 'Invalid or missing url in JSON body' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
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
    let requestBody: BodyInit | undefined;
    if (payload.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      requestBody =
        payload.bodyEncoding === 'base64' ? (fromBase64(payload.body) as unknown as BodyInit) : payload.body;
    }

    const upstream = await fetch(target.toString(), {
      method,
      headers,
      body: requestBody,
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
    const envelope = {
      status: upstream.status,
      headers: resHeaders,
      url: upstream.url,
      bodyEncoding: textual ? ('text' as const) : ('base64' as const),
      body: textual ? await upstream.text() : toBase64(new Uint8Array(await upstream.arrayBuffer())),
    };

    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}
