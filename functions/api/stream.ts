const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

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
