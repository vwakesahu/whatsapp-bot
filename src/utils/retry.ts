const NETWORK_ERRORS = [
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
  'EAI_AGAIN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT',
  'fetch failed', 'network error', 'socket hang up',
];

// HTTP status codes that are safe to retry
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504, 529];

export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Check for network-level errors
  const msg = String((error as any)?.message ?? error).toLowerCase();
  const code = (error as any)?.code ?? '';
  if (NETWORK_ERRORS.some(e => msg.includes(e.toLowerCase()) || code === e)) {
    return true;
  }

  // Check for retryable HTTP status codes (Anthropic SDK throws with .status)
  const status = (error as any)?.status;
  if (status && RETRYABLE_STATUS_CODES.includes(status)) {
    return true;
  }

  // Check x-should-retry header (Anthropic sets this)
  const headers = (error as any)?.headers;
  if (headers?.['x-should-retry'] === 'true') {
    return true;
  }

  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { label: string; retries?: number; delayMs?: number } = { label: 'operation' }
): Promise<T> {
  const { label, retries = 3, delayMs = 2000 } = opts;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isRetryableError(error) && attempt < retries) {
        // Use longer delay for rate limits (429) and overloaded (529)
        const status = (error as any)?.status;
        const multiplier = (status === 429 || status === 529) ? 3 : 1;
        const wait = delayMs * attempt * multiplier;
        console.warn(`[${label}] Retryable error${status ? ` (${status})` : ''} — attempt ${attempt}/${retries}, retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw error;
    }
  }

  throw new Error(`[${label}] All ${retries} attempts failed`);
}
