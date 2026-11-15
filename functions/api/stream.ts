const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
};

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

export async function onRequest(context: { request: Request }): Promise<Response> {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const reqUrl = new URL(request.url);
  const target = validateTargetUrl(reqUrl.searchParams.get('url'));
  if (!target) {
    return new Response(JSON.stringify({ error: 'Invalid or missing target url' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  for (const [key, value] of reqUrl.searchParams) {
    if (key !== 'url') target.searchParams.set(key, value);
  }

  try {
    const headers: Record<string, string> = {
      'User-Agent': CHROME_UA,
      'Accept-Encoding': 'identity',
    };
    const range = request.headers.get('range');
    if (range) headers['Range'] = range;
    const contentType = request.headers.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;

    // googlevideo rejects VISIONOS/ANDROID/IOS direct URLs with 403 when a YouTube Origin is attached.
    const clientParam = target.searchParams.get('c')?.toUpperCase();
    const skipOrigin = clientParam === 'VISIONOS' || clientParam === 'ANDROID' || clientParam === 'IOS';
    if (!skipOrigin) {
      headers['Origin'] = 'https://www.youtube.com';
      headers['Referer'] = 'https://www.youtube.com/';
    }

    const method = request.method.toUpperCase();
    const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();

    const upstream = await fetch(target.toString(), {
      method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      redirect: 'follow',
    });

    const responseHeaders = new Headers(CORS_HEADERS);
    responseHeaders.set('Accept-Ranges', upstream.headers.get('accept-ranges') ?? 'bytes');
    for (const key of ['content-type', 'content-length', 'content-range', 'cache-control']) {
      const value = upstream.headers.get(key);
      if (value) responseHeaders.set(key, value);
    }

    return new Response(method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}
