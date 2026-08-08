/**
 * Resilient chrome.storage.local access shared by settings and diagnostics.
 *
 * Uses the callback form, for the same reason ~lib/runtime-message uses it for
 * messaging: the promise-returning form is a Chrome extension to the API, and
 * on a callback-only runtime `await chrome.storage.local.get(key)` resolves to
 * undefined. Reading a key off that throws.
 *
 * Both helpers resolve on whichever of callback or returned promise settles
 * first, and never reject: every caller treats storage as best-effort.
 */

export function storageGet(
  key: string | null,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let settled = false;
    const accept = (items: unknown) => {
      if (settled) return;
      settled = true;
      resolve((items as Record<string, unknown>) ?? {});
    };

    try {
      const returned = chrome.storage.local.get(key, (items) => {
        // Reading lastError marks it handled; leaving it logs a warning.
        void chrome.runtime.lastError;
        accept(items);
      });
      if (
        typeof (returned as unknown as Promise<unknown>)?.then === "function"
      ) {
        (returned as unknown as Promise<unknown>).then(accept, () =>
          accept({}),
        );
      }
    } catch {
      accept({});
    }
  });
}

export function storageSet(items: Record<string, unknown>): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const accept = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    try {
      const returned = chrome.storage.local.set(items, () => {
        accept(!chrome.runtime.lastError);
      });
      if (
        typeof (returned as unknown as Promise<unknown>)?.then === "function"
      ) {
        (returned as unknown as Promise<unknown>).then(
          () => accept(true),
          () => accept(false),
        );
      }
    } catch {
      accept(false);
    }
  });
}

/**
 * Subscribes to storage changes, tolerating a browser that does not implement
 * chrome.storage.onChanged. The settings watchers are called from React
 * effects in the injected inspector, and an effect that throws takes the
 * whole tree down with it — React unmounts the root when no error boundary
 * catches — so an absent namespace here would blank the inspector rather than
 * merely cost it live updates. Returns a cleanup function in every case.
 */
export function watchStorage(
  listener: (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => void,
): () => void {
  try {
    chrome.storage.onChanged.addListener(listener);
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch {
      /* Nothing was ever registered. */
    }
  };
}
