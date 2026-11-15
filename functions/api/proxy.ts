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

type YouTubeClientHeaders = {
  ua: string;
  isWeb: boolean;
  origin?: string;
};

function resolveYouTubeClientHeaders(clientNameRaw?: string | null, hostname?: string): YouTubeClientHeaders {
  const c = (clientNameRaw ?? '').trim().toUpperCase();
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
        origin: 'https://m.youtube.com',
      };
    case 'WEB_REMIX':
      return { ua: CHROME_UA, isWeb: true, origin: 'https://music.youtube.com' };
    default: {
      const origin = hostname?.toLowerCase() === 'music.youtube.com' ? 'https://music.youtube.com' : 'https://www.youtube.com';
      return { ua: CHROME_UA, isWeb: true, origin };
    }
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

      const method = request.method.toUpperCase();
      const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();
      const bodyText = body && body.byteLength > 0 ? new TextDecoder().decode(body) : undefined;

      const headers: Record<string, string> = {
        'User-Agent': CHROME_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      };
      const contentType = request.headers.get('content-type');
      if (contentType) headers['Content-Type'] = contentType;
      applyTargetHostHeaders(target, headers, bodyText);

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

    const method = (payload.method ?? 'GET').toUpperCase();
    let requestBody: BodyInit | undefined;
    let bodyText: string | undefined;
    if (payload.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      if (payload.bodyEncoding === 'base64') {
        const bytes = fromBase64(payload.body);
        requestBody = bytes as unknown as BodyInit;
        bodyText = new TextDecoder().decode(bytes);
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
