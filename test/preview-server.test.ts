import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { resetPreviewsForTests, startPreview } from '../src/main/preview-server.js';
import { makeTempDir, removeTempDir } from './helpers.js';

const folders: string[] = [];

afterEach(async () => {
  resetPreviewsForTests();
  await Promise.all(folders.splice(0).map(removeTempDir));
});

function get(url: string, cookie?: string): Promise<{ status: number; body: string; type: string; cookie: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: cookie ? { cookie } : {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
        type: String(res.headers['content-type'] ?? ''),
        cookie: String(res.headers['set-cookie']?.[0] ?? '')
      }));
    }).on('error', reject);
  });
}

it('serves a website on a private loopback URL and reuses it for the same folder', async () => {
  const folder = await makeTempDir('cos-preview-');
  folders.push(folder);
  await fs.writeFile(path.join(folder, 'index.html'), '<h1>Malachi Studio</h1>');
  await fs.writeFile(path.join(folder, 'app.js'), 'document.body.dataset.ready = "yes";');

  const allowed = async () => true;
  const url = await startPreview(folder, allowed);
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{32,}\/$/);
  expect(await startPreview(folder, allowed)).toBe(url);
  const first = await get(url);
  expect(first).toMatchObject({ status: 200, body: '<h1>Malachi Studio</h1>', type: 'text/html; charset=utf-8' });
  expect(first.cookie).toMatch(/HttpOnly; SameSite=Strict/);
  expect(await get(new URL('app.js', url).href)).toMatchObject({ status: 200, type: 'text/javascript; charset=utf-8' });
  expect((await get(new URL('missing.txt', url).href)).status).toBe(404);
  expect((await get(new URL('/', url).href)).status).toBe(403);
  expect(await get(new URL('/app.js', url).href, first.cookie.split(';')[0])).toMatchObject({ status: 200, type: 'text/javascript; charset=utf-8' });
});

it('revokes an existing preview when its live permission is removed', async () => {
  const folder = await makeTempDir('cos-preview-');
  folders.push(folder);
  await fs.writeFile(path.join(folder, 'index.html'), 'private fixture');
  let approved = true;
  const url = await startPreview(folder, async () => approved);
  expect((await get(url)).status).toBe(200);
  approved = false;
  expect((await get(url)).status).toBe(403);
});
