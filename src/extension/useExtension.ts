import { detectExtension, type DetectedExtension } from '@bitchord/shared/bridge';
import { useQuery } from '@tanstack/react-query';
import { config } from '@/config';
import { isMobileBrowser } from '@/lib/platform';
import { queryClient } from '@/lib/queryClient';
import { builtInExtension } from './proxyBridge';

export type ExtensionStatus =
  | { state: 'checking' }
  | { state: 'missing' }
  | { state: 'present'; extension: DetectedExtension };

export const extensionQueryKey = ['extension', 'detect'] as const;

// Seed immediately so non-React callers (player, prefetch) are ready before the first render.
if (!queryClient.getQueryData(extensionQueryKey)) {
  queryClient.setQueryData(extensionQueryKey, builtInExtension);
}

async function detect(): Promise<DetectedExtension | null> {
  if (isMobileBrowser()) return builtInExtension;
  const found = await detectExtension({ chromiumExtensionId: config.chromiumExtensionId, timeoutMs: 400 });
  return found ?? builtInExtension;
}

/**
 * Resolves the active backend transport. Falls back automatically to the built-in
 * proxy bridge so YouTube Music and lyrics work without any browser extension.
 */
export function useExtension(): ExtensionStatus {
  const query = useQuery({
    queryKey: extensionQueryKey,
    queryFn: detect,
    initialData: builtInExtension,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (query.isPending && !query.data) return { state: 'checking' };
  if (!query.data) return { state: 'present', extension: builtInExtension };
  return { state: 'present', extension: query.data };
}
