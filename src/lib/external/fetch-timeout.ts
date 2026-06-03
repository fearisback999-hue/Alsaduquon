/**
 * fetch() with a hard timeout via AbortController.
 *
 * Raw fetch() never times out on its own — if a TCP connection stalls with no
 * response, the promise hangs forever. In the unattended pipeline that means a
 * single wedged external call freezes the step that holds the run lock until
 * the 30-minute staleness reaper reclaims it. Bounding every request lets the
 * retry/backoff layer above it actually do its job.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 60_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
