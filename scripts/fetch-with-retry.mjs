const RETRYABLE_STATUS = new Set([406, 408, 425, 429]);

export function transientHttpStatus(status) {
  return RETRYABLE_STATUS.has(status) || status >= 500;
}

export async function downloadWithRetry(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const delays = options.delays ?? [0, 750, 2_000, 5_000];
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
  let lastError;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) await sleep(delays[attempt]);
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
