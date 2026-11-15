import type { Plugin } from 'vite';
import { handleProxyRequest, handleStreamRequest } from './proxyCore';

/**
 * Registers `/api/proxy` and `/api/stream` middlewares on Vite's dev and preview servers
 * so the site runs identically on localhost (including LAN access from iPhone) as in production.
 */
export function proxyPlugin(): Plugin {
  const attach = (middlewares: { use: (path: string, fn: (req: any, res: any, next: () => void) => void) => void }) => {
    middlewares.use('/api/proxy', (req, res) => {
      void handleProxyRequest(req, res);
    });
    middlewares.use('/api/stream', (req, res) => {
      void handleStreamRequest(req, res);
    });
  };

  return {
    name: 'bitrate-proxy',
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}
