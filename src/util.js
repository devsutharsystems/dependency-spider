// Small shared helpers: typed errors, bounded concurrency, fetch with retry/backoff.

export class SpiderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SpiderError';
    this.code = code;
    this.details = details;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Like Promise.all(items.map(fn)) but never more than `limit` calls in flight. Keeps input order.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Retries network errors, 429 and 5xx with exponential backoff. Returns the last response otherwise.
export async function fetchRetry(fetchFn, url, init, { retries = 3, baseDelay = 400, sleepFn = sleep } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(url, init);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleepFn(baseDelay * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleepFn(baseDelay * 2 ** attempt);
    }
  }
  throw lastErr;
}
