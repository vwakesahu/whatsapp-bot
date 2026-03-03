const NETWORK_ERRORS = [
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
  'EAI_AGAIN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT',
  'fetch failed', 'network error', 'socket hang up',
];

export function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const msg = String((error as any)?.message ?? error).toLowerCase();
  const code = (error as any)?.code ?? '';
  return NETWORK_ERRORS.some(e => msg.includes(e.toLowerCase()) || code === e);
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
      if (isNetworkError(error) && attempt < retries) {
        const wait = delayMs * attempt;
        console.warn(`[${label}] Network error (attempt ${attempt}/${retries}), retrying in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw error;
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error(`[${label}] All ${retries} attempts failed`);
}
