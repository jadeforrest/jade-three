/**
 * fetch() that retries network-level failures.
 *
 * launchd fires missed jobs the moment the Mac wakes, often before Wi-Fi and
 * DNS are back, and Node reports that as a bare "fetch failed". Retrying with
 * a growing pause rides out the wake-up.
 *
 * Only a thrown fetch (no response at all) is retried. An HTTP response of any
 * status is returned as-is: the caller decides what a 401 or 500 means.
 *
 * Use it only for requests that are safe to repeat (auth, GETs). A request
 * that creates something must not go through here: it may have succeeded
 * before the connection dropped, and a retry would create it twice.
 */

export const DEFAULT_DELAYS_MS = [5_000, 15_000, 30_000];

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One line naming what actually went wrong, e.g. "fetch failed (ENOTFOUND bsky.social)". */
export function describeFetchError(err) {
  const message = err?.message ?? String(err);
  const cause = err?.cause;
  const detail = [cause?.code, cause?.hostname].filter(Boolean).join(' ') || cause?.message;
  return detail ? `${message} (${detail})` : message;
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{ delaysMs?: number[], fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, log?: (line: string) => void }} [opts]
 *   delaysMs: pause before each retry, so attempts = delaysMs.length + 1.
 */
export async function fetchWithRetry(url, init, opts = {}) {
  const {
    delaysMs = DEFAULT_DELAYS_MS,
    fetchImpl = fetch,
    sleep = realSleep,
    log = (line) => process.stderr.write(`${line}\n`),
  } = opts;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchImpl(url, init);
    } catch (err) {
      const host = new URL(url).host;
      if (attempt >= delaysMs.length) {
        throw new Error(
          `Network error reaching ${host} after ${attempt + 1} attempt(s): ${describeFetchError(err)}`,
          { cause: err },
        );
      }
      log(`  ${host}: ${describeFetchError(err)}; retrying in ${delaysMs[attempt] / 1000}s`);
      await sleep(delaysMs[attempt]);
    }
  }
}
