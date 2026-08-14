/**
 * Resilient chrome.tabs.query access, callback-form for the same reason
 * ~lib/storage uses it: the promise-returning form is a Chrome extension to
 * the API, and on a callback-only runtime `await chrome.tabs.query(...)`
 * resolves to undefined.
 *
 * The try/catch earns its keep on Orion, whose chrome.* shim relays calls
 * through window.webkit.messageHandlers and throws a raw TypeError
 * ("undefined is not an object (evaluating '...messageHandlers.tabs
 * .postMessage')") when that bridge lacks a tabs handler — observed in the
 * field, surfaced verbatim in the popup. Resolving null instead lets each
 * caller phrase the failure for its own context; null means "the API is
 * unavailable here", distinct from a genuinely empty result.
 */

export function queryTabs(
  query: chrome.tabs.QueryInfo,
): Promise<chrome.tabs.Tab[] | null> {
  return new Promise((resolve) => {
    let settled = false;
    const accept = (tabs: unknown) => {
      if (settled) return;
      settled = true;
      resolve(Array.isArray(tabs) ? (tabs as chrome.tabs.Tab[]) : null);
    };

    try {
      const returned = chrome.tabs.query(query, (tabs) => {
        // Reading lastError marks it handled; leaving it logs a warning.
        void chrome.runtime.lastError;
        accept(tabs);
      });
      if (
        typeof (returned as unknown as Promise<unknown>)?.then === "function"
      ) {
        (returned as unknown as Promise<unknown>).then(accept, () =>
          accept(null),
        );
      }
    } catch {
      accept(null);
    }
  });
}
