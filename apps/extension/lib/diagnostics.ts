/**
 * A persistent diagnostics log for environments with no reachable console —
 * Orion on iPad above all, where a memory kill takes the page, the inspector,
 * and any trace of why, and the only "debugger" left is restarting the
 * browser.
 *
 * Entries live as a ring buffer in chrome.storage.local, which survives
 * process kills and browser restarts, and are read back by the popup's
 * Diagnostics section — a separate document that outlives the inspected
 * page's death. Every write is best-effort: diagnostics must never become a
 * failure mode of their own.
 */

import { storageGet, storageSet } from "~lib/storage";

export const DIAGNOSTICS_STORAGE_KEY = "diagnosticsLog";

/** Ring-buffer bound: old entries fall off, storage never grows unbounded. */
const MAX_ENTRIES = 100;
/** Per-message bound: one runaway error string cannot eat the buffer. */
const MAX_MESSAGE_LENGTH = 500;

export type DiagnosticSource = "background" | "popup" | "inspector";

export type DiagnosticEntry = {
  /** Epoch ms. */
  time: number;
  source: DiagnosticSource;
  level: "error" | "info";
  message: string;
};

function isDiagnosticEntry(value: unknown): value is DiagnosticEntry {
  const entry = value as Partial<DiagnosticEntry> | null;
  return (
    typeof entry?.time === "number" &&
    (entry.source === "background" ||
      entry.source === "popup" ||
      entry.source === "inspector") &&
    (entry.level === "error" || entry.level === "info") &&
    typeof entry.message === "string"
  );
}

export async function readDiagnostics(): Promise<DiagnosticEntry[]> {
  const stored = await storageGet(DIAGNOSTICS_STORAGE_KEY);
  const value = stored[DIAGNOSTICS_STORAGE_KEY];
  return Array.isArray(value) ? value.filter(isDiagnosticEntry) : [];
}

export async function clearDiagnostics(): Promise<boolean> {
  return storageSet({ [DIAGNOSTICS_STORAGE_KEY]: [] });
}

/**
 * Appends one entry, trimming to the ring-buffer cap. Read-modify-write
 * without a lock: concurrent writers (background vs. inspector) can lose an
 * entry to a race, which a best-effort log accepts rather than serializing
 * every error path through a queue.
 */
export async function appendDiagnostic(
  entry: Omit<DiagnosticEntry, "time">,
): Promise<void> {
  const entries = await readDiagnostics();
  entries.push({
    time: Date.now(),
    source: entry.source,
    level: entry.level,
    message: entry.message.slice(0, MAX_MESSAGE_LENGTH),
  });
  await storageSet({ [DIAGNOSTICS_STORAGE_KEY]: entries.slice(-MAX_ENTRIES) });
}

/**
 * appendDiagnostic for facts, not events: "webRequest events unsupported
 * here" is worth recording once, not once per service-worker start. Skips
 * the write when an identical source + message is already in the buffer.
 */
export async function appendDiagnosticOnce(
  entry: Omit<DiagnosticEntry, "time">,
): Promise<void> {
  const entries = await readDiagnostics();
  const exists = entries.some(
    (existing) =>
      existing.source === entry.source && existing.message === entry.message,
  );
  if (exists) return;
  entries.push({
    time: Date.now(),
    source: entry.source,
    level: entry.level,
    message: entry.message.slice(0, MAX_MESSAGE_LENGTH),
  });
  await storageSet({ [DIAGNOSTICS_STORAGE_KEY]: entries.slice(-MAX_ENTRIES) });
}

function describeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message || reason.name;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason) ?? String(reason);
  } catch {
    return String(reason);
  }
}

/**
 * Registers uncaught-error and unhandled-rejection handlers on this context's
 * global. Works in the popup document, the background service worker, and the
 * content-script world of the injected inspector.
 *
 * The content-script world needs the filename filter: uncaught page-script
 * errors fire the same window "error" event, and logging the inspected site's
 * bugs would drown the extension's own. Extension code is identifiable by its
 * chrome-extension:// filename; for the inspector source, events without one
 * (cross-origin "Script error." noise included) are dropped.
 *
 * Rejections need the same treatment: on Orion's WebKit runtime the page's
 * own unhandled rejections reach the content-script listener (observed in the
 * field — site API clients rejecting with plain payload objects were logged
 * as inspector errors). A rejection has no filename, so attribution goes
 * through the reason instead: only Error reasons whose stack points into the
 * extension are the extension's own. Every rejection path in this codebase
 * rejects with an Error subclass, so nothing of ours is lost.
 */
export function installGlobalDiagnostics(source: DiagnosticSource): void {
  const scope = globalThis as typeof globalThis & {
    __inspectorLabDiagnostics?: boolean;
  };
  if (scope.__inspectorLabDiagnostics) return;
  scope.__inspectorLabDiagnostics = true;

  const extensionUrl = (() => {
    try {
      return chrome.runtime.getURL("");
    } catch {
      return null;
    }
  })();

  try {
    scope.addEventListener("error", (event) => {
      const { filename, message, lineno } = event as ErrorEvent;
      if (source === "inspector") {
        if (!filename || (extensionUrl && !filename.startsWith(extensionUrl)))
          return;
      }
      void appendDiagnostic({
        source,
        level: "error",
        message: `Uncaught: ${message || "unknown error"}${
          lineno ? ` (line ${lineno})` : ""
        }`,
      }).catch(() => undefined);
    });
    scope.addEventListener("unhandledrejection", (event) => {
      const { reason } = event as PromiseRejectionEvent;
      if (source === "inspector") {
        const stack = reason instanceof Error ? reason.stack : undefined;
        if (!stack || (extensionUrl && !stack.includes(extensionUrl))) return;
      }
      void appendDiagnostic({
        source,
        level: "error",
        message: `Unhandled rejection: ${describeReason(reason)}`,
      }).catch(() => undefined);
    });
  } catch {
    /* A runtime without addEventListener semantics we expect: diagnostics
       are an aid, never a requirement. */
  }
}
