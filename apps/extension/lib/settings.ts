/**
 * User preferences shared between the popup and the injected inspector via
 * chrome.storage.local — the popup writes, the inspector reads and watches.
 * Values are validated on read: storage is extension-private, but a strict
 * `=== true` keeps any malformed value from flipping a feature on.
 */

/**
 * Subscribes to storage changes, tolerating a browser that does not implement
 * chrome.storage.onChanged. Both watchers below are called from a React effect
 * in the injected inspector, and an effect that throws takes the whole tree
 * down with it — React unmounts the root when no error boundary catches — so
 * an absent namespace here would blank the inspector rather than merely cost
 * it live theme updates. Returns a cleanup function in every case.
 */
function watchStorage(
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

/**
 * chrome.storage with the callback form, for the same reason ~lib/runtime-message
 * uses it for messaging: the promise-returning form is a Chrome extension to the
 * API, and on a callback-only runtime `await chrome.storage.local.get(key)`
 * resolves to undefined. Reading a key off that throws, which here would mean
 * the inspector silently ignoring the popup's theme choice.
 *
 * Both helpers resolve on whichever of callback or returned promise settles
 * first, and never reject: every caller already treats storage as best-effort.
 */
function storageGet(key: string): Promise<Record<string, unknown>> {
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

function storageSet(items: Record<string, unknown>): Promise<boolean> {
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

export const CUSTOM_THEME_STORAGE_KEY = "customInspectorTheme";

/** True when the inspector should use the extension's own branding instead of
 *  the Chrome DevTools look. Defaults to true (branded) — only an explicit
 *  false stored by the popup toggle switches to the DevTools look. */
export async function readCustomThemeSetting(): Promise<boolean> {
  const stored = await storageGet(CUSTOM_THEME_STORAGE_KEY);
  return stored[CUSTOM_THEME_STORAGE_KEY] !== false;
}

/** Persists the popup toggle. Resolves false when storage rejects, so the
 *  caller can roll its UI back. */
export function saveCustomThemeSetting(enabled: boolean): Promise<boolean> {
  return storageSet({ [CUSTOM_THEME_STORAGE_KEY]: enabled });
}

/** Calls `onChange` whenever the popup flips the toggle; returns cleanup. */
export function watchCustomThemeSetting(
  onChange: (enabled: boolean) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "local") return;
    const change = changes[CUSTOM_THEME_STORAGE_KEY];
    if (change) onChange(change.newValue !== false);
  };
  return watchStorage(listener);
}

export const COLOR_SCHEME_STORAGE_KEY = "inspectorColorScheme";

export type InspectorColorScheme = "light" | "dark";

/**
 * The light/dark choice made with the popup's theme toggle, mirrored here so
 * the injected inspector can follow it (the popup's own persistence lives in
 * popup-page localStorage, which content scripts cannot see). Null means no
 * choice has been made yet — follow the OS.
 */
export async function readColorSchemeSetting(): Promise<InspectorColorScheme | null> {
  const stored = await storageGet(COLOR_SCHEME_STORAGE_KEY);
  const value = stored[COLOR_SCHEME_STORAGE_KEY];
  return value === "light" || value === "dark" ? value : null;
}

export async function saveColorSchemeSetting(
  scheme: InspectorColorScheme,
): Promise<void> {
  /* Best-effort: the inspector falls back to the OS preference. */
  await storageSet({ [COLOR_SCHEME_STORAGE_KEY]: scheme });
}

/** Calls `onChange` when the popup's light/dark choice changes; cleanup fn. */
export function watchColorSchemeSetting(
  onChange: (scheme: InspectorColorScheme | null) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== "local") return;
    const change = changes[COLOR_SCHEME_STORAGE_KEY];
    if (!change) return;
    onChange(
      change.newValue === "light" || change.newValue === "dark"
        ? change.newValue
        : null,
    );
  };
  return watchStorage(listener);
}
