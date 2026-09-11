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

function get(url: string): Promise<{ status: number; body: string; type: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
        type: String(res.headers['content-type'] ?? '')
      }));
    }).on('error', reject);
  });
}

it('serves a website on a short loopback URL and reuses it for the same folder', async () => {
  const folder = await makeTempDir('cos-preview-');
  folders.push(folder);
  await fs.writeFile(path.join(folder, 'index.html'), '<h1>Malachi Studio</h1>');
  await fs.writeFile(path.join(folder, 'app.js'), 'document.body.dataset.ready = "yes";');

  const url = await startPreview(folder);
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  expect(await startPreview(folder)).toBe(url);
  expect(await get(url)).toMatchObject({ status: 200, body: '<h1>Malachi Studio</h1>', type: 'text/html; charset=utf-8' });
  expect(await get(new URL('app.js', url).href)).toMatchObject({ status: 200, type: 'text/javascript; charset=utf-8' });
  expect((await get(new URL('missing.txt', url).href)).status).toBe(404);
});
