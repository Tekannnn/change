import type { Bridge, DetectedExtension } from '@bitchord/shared/bridge';
import { queryClient } from '@/lib/queryClient';
import { proxyBridge } from './proxyBridge';
import { extensionQueryKey } from './useExtension';

/** The active bridge (browser extension if present, otherwise the built-in backend proxy). */
export function getBridge(): Bridge | null {
  return queryClient.getQueryData<DetectedExtension | null>(extensionQueryKey)?.bridge ?? proxyBridge;
}
