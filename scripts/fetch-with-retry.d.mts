export function transientHttpStatus(status: number): boolean;
export function downloadWithRetry(url: string, options?: {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  delays?: number[];
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<Buffer>;
