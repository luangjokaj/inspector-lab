/**
 * User preferences shared between the popup and the injected inspector via
 * chrome.storage.local — the popup writes, the inspector reads and watches.
 * Values are validated on read: storage is extension-private, but a strict
 * `=== true` keeps any malformed value from flipping a feature on.
 */

export const CUSTOM_THEME_STORAGE_KEY = "customInspectorTheme";

/** True when the inspector should use the extension's own branding instead of
 *  the Chrome DevTools look. Defaults to false (DevTools look). */
export async function readCustomThemeSetting(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(CUSTOM_THEME_STORAGE_KEY);
    return stored[CUSTOM_THEME_STORAGE_KEY] === true;
  } catch {
    return false;
  }
}

/** Persists the popup toggle. Resolves false when storage rejects, so the
 *  caller can roll its UI back. */
export async function saveCustomThemeSetting(
  enabled: boolean,
): Promise<boolean> {
  try {
    await chrome.storage.local.set({ [CUSTOM_THEME_STORAGE_KEY]: enabled });
    return true;
  } catch {
    return false;
  }
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
    if (change) onChange(change.newValue === true);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
