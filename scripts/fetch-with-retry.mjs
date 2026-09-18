const RETRYABLE_STATUS = new Set([406, 408, 425, 429]);
const DEFAULT_DELAYS = [0, 5_000, 20_000, 60_000, 120_000];

function retryAfterMs(response) {
  const raw = response.headers.get('retry-after');
  if (!raw) return response.status === 406 || response.status === 429 ? 15_000 : 0;
  const value = raw.trim();
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Number(value) * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : response.status === 406 || response.status === 429 ? 15_000 : 0;
}

export function transientHttpStatus(status) {
  return RETRYABLE_STATUS.has(status) || status >= 500;
}

export async function downloadWithRetry(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  // Some immutable archive providers transiently return 406 while applying anonymous
  // anti-abuse limits. Keep retries bounded, but give that provider-side window time to
  // clear instead of repeating the same request four times in under eight seconds.
  const delays = options.delays ?? DEFAULT_DELAYS;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
  let lastError;
  let serverDelay = 0;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    const delay = Math.max(delays[attempt], serverDelay);
    serverDelay = 0;
    if (delay > 0) await sleep(delay);
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: 'application/octet-stream, */*;q=0.8',
          'User-Agent': 'MALACHI-OVERDRIVE-native-source-packager',
        },
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        if (!transientHttpStatus(response.status)) throw Object.assign(error, { retryable: false });
        serverDelay = retryAfterMs(response);
        throw error;
      }
      if (!response.body) throw Object.assign(new Error('Response body is unavailable'), { retryable: false });
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > maxBytes) throw Object.assign(new Error('Response exceeds reviewed size'), { retryable: false });
        chunks.push(bytes);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error?.retryable === false) throw error;
      lastError = error;
      if (attempt + 1 === delays.length) throw error;
    }
  }
  throw lastError ?? new Error('Native source request failed');
}
