/** App-owned static previews for projects inside approved folders. */

import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { rawPromises as fs } from './rawfs.js';
import { isContained } from './sandbox.js';

const previews = new Map<string, { server: http.Server; url: string }>();

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function response(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function fileForRequest(root: string, requestUrl: string): Promise<string | null> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname);
  } catch {
    return null;
  }
  const parts = pathname.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part === '.')) return null;
  let candidate = path.join(root, ...parts);
  try {
    let stat = await fs.stat(candidate);
    if (stat.isDirectory()) {
      candidate = path.join(candidate, 'index.html');
      stat = await fs.stat(candidate);
    }
    if (!stat.isFile()) return null;
    const canonical = await fs.realpath(candidate);
    return isContained(root, canonical) ? canonical : null;
  } catch {
    return null;
  }
}

/** Start one loopback-only server per folder, and reuse it for later preview calls. */
export async function startPreview(root: string, allowed: () => Promise<boolean>): Promise<string> {
  const canonical = await fs.realpath(root);
  const stat = await fs.stat(canonical);
  if (!stat.isDirectory()) throw new Error('Preview path must be a folder');
  const current = previews.get(canonical);
  if (current) return current.url;

  // The first navigation carries this unguessable path component. A cookie keeps absolute
  // asset URLs working afterwards without exposing a public unauthenticated root URL.
  const secret = randomBytes(32).toString('base64url');
  const prefix = `/${secret}`;

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      response(res, 405, 'Method not allowed');
      return;
    }
    const host = (req.headers.host ?? '').split(':')[0]?.toLowerCase();
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
      response(res, 403, 'Loopback only');
      return;
    }
    let pathname: string;
    try { pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname; }
    catch { response(res, 400, 'Bad request'); return; }
    const byPath = pathname === prefix || pathname.startsWith(`${prefix}/`);
    const byCookie = (req.headers.cookie ?? '').split(';').some(cookie => cookie.trim() === `overdrive_preview=${secret}`);
    if (!byPath && !byCookie) { response(res, 403, 'Preview access required'); return; }
    const fileUrl = byPath ? (req.url ?? '/').replace(prefix, '') || '/' : req.url ?? '/';
    void allowed().then(async (isAllowed) => {
      if (!isAllowed) { response(res, 403, 'Preview permission revoked'); return; }
      const file = await fileForRequest(canonical, fileUrl);
      if (!file) {
        response(res, 404, 'Not found');
        return;
      }
      const body = await fs.readFile(file);
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': body.byteLength,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        ...(byPath ? { 'set-cookie': `overdrive_preview=${secret}; HttpOnly; SameSite=Strict; Path=/` } : {})
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    }).catch(() => response(res, 500, 'Preview failed'));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Preview server did not receive a port');
  }
  const url = `http://127.0.0.1:${address.port}${prefix}/`;
  previews.set(canonical, { server, url });
  return url;
}

export async function stopPreviews(): Promise<void> {
  const running = [...previews.values()];
  previews.clear();
  await Promise.all(running.map(({ server }) => new Promise<void>((resolve) => server.close(() => resolve()))));
}

export function resetPreviewsForTests(): void {
  for (const { server } of previews.values()) server.close();
  previews.clear();
}
