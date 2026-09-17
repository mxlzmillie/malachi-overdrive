import { expect, it, vi } from 'vitest';
import { downloadWithRetry, transientHttpStatus } from '../scripts/fetch-with-retry.mjs';

const noSleep = async () => {};
const reply = (status: number, body = 'ok') => new Response(body, { status });

it('retries observed transient HTTP failures and returns verified body bytes', async () => {
  const fetchImpl = vi.fn().mockResolvedValueOnce(reply(406)).mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(200, 'final'));
  const result = await downloadWithRetry('https://example.test/source', { fetchImpl, sleep: noSleep, delays: [0, 0, 0], maxBytes: 16 });
  expect(result.toString()).toBe('final');
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});

it('retries transport failures including a body stream that dies after headers', async () => {
  const broken = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('partial')); controller.error(new Error('mid-stream timeout')); },
  }), { status: 200 });
  const fetchImpl = vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(reply(200, 'complete'));
  await expect(downloadWithRetry('https://example.test/source', { fetchImpl, sleep: noSleep, delays: [0, 0], maxBytes: 32 })).resolves.toEqual(Buffer.from('complete'));
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('fails permanent HTTP and reviewed-size violations without retrying', async () => {
  const permanent = vi.fn().mockResolvedValue(reply(404));
  await expect(downloadWithRetry('https://example.test/a', { fetchImpl: permanent, sleep: noSleep, delays: [0, 0, 0] })).rejects.toThrow('HTTP 404');
  expect(permanent).toHaveBeenCalledTimes(1);
  const oversized = vi.fn().mockResolvedValue(reply(200, 'toolarge'));
  await expect(downloadWithRetry('https://example.test/b', { fetchImpl: oversized, sleep: noSleep, delays: [0, 0, 0], maxBytes: 2 })).rejects.toThrow('exceeds reviewed size');
  expect(oversized).toHaveBeenCalledTimes(1);
});

it('bounds retries and classifies only temporary response statuses', async () => {
  const failing = vi.fn().mockResolvedValue(reply(429));
  const sleeps: number[] = [];
  await expect(downloadWithRetry('https://example.test/source', { fetchImpl: failing, sleep: async ms => { sleeps.push(ms); }, delays: [0, 0, 0, 0] })).rejects.toThrow('HTTP 429');
  expect(failing).toHaveBeenCalledTimes(4);
  expect(sleeps).toEqual([15_000, 15_000, 15_000]);
  expect([406, 408, 425, 429, 500, 503].every(transientHttpStatus)).toBe(true);
  expect([400, 401, 403, 404].some(transientHttpStatus)).toBe(false);
});

it('honors a provider Retry-After before another bounded download attempt', async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'Retry-After': '37' } }))
    .mockResolvedValueOnce(reply(200, 'complete'));
  const sleeps: number[] = [];
  await expect(downloadWithRetry('https://example.test/source', {
    fetchImpl,
    sleep: async ms => { sleeps.push(ms); },
    delays: [0, 750],
    maxBytes: 32,
  })).resolves.toEqual(Buffer.from('complete'));
  expect(sleeps).toEqual([37_000]);
});
