import {
  CLEAR_SITE_COOKIES_MESSAGE,
  DELETE_COOKIE_MESSAGE,
  EVALUATE_MESSAGE,
  FETCH_SOURCE_MESSAGE,
  GET_COOKIES_MESSAGE,
  GET_NETWORK_DETAILS_MESSAGE,
  INTERCEPT_CONSOLE_MESSAGE,
  INTERCEPT_NETWORK_MESSAGE,
  PING_MESSAGE,
  REQUEST_COOKIE_ACCESS_MESSAGE,
  SET_COOKIE_MESSAGE,
  TRACK_INSPECTOR_MESSAGE,
  isConsoleEventName,
  isNetworkEventName,
  type ClearSiteCookiesRequest,
  type ClearSiteCookiesResponse,
  type CookieDraft,
  type CookieEntry,
  type CookieIdentity,
  type DeleteCookieRequest,
  type DeleteCookieResponse,
  type EvaluateRequest,
  type EvaluateResponse,
  type FetchSourceRequest,
  type FetchSourceResponse,
  type GetCookiesResponse,
  type GetCookiesRequest,
  type GetNetworkDetailsRequest,
  type GetNetworkDetailsResponse,
  type InterceptConsoleRequest,
  type InterceptConsoleResponse,
  type InterceptNetworkRequest,
  type InterceptNetworkResponse,
  type PingRequest,
  type PingResponse,
  type RequestCookieAccessRequest,
  type RequestCookieAccessResponse,
  type SetCookieRequest,
  type SetCookieResponse,
  type TrackInspectorRequest,
  type TrackInspectorResponse,
  type WebRequestEntry,
} from "~lib/messages";
import { readBodyCapped } from "~lib/source-fetch";
import {
  appendDiagnostic,
  appendDiagnosticOnce,
  installGlobalDiagnostics,
} from "~lib/diagnostics";
import { storageGet, storageSet } from "~lib/storage";
import { evaluateInPage } from "~injected/page-eval";
import inspectorBundleUrl from "url:./injected/inspector-entry.tsx";
import consolePrehookUrl from "url:./injected/console-prehook.ts";
import networkPrehookUrl from "url:./injected/network-prehook.ts";

/**
 * Registered before anything else in this file runs.
 *
 * Two hazards below already have their own guards — chrome.storage.session and
 * chrome.webRequest, both absent or partial on Orion for iOS — because a throw
 * at module scope stops this file, and a file that stops before reaching its
 * onMessage listener leaves every panel talking to nothing. Registering the
 * listener first turns that from a fatal, invisible failure into a per-message
 * one: the handler still answers, and anything it needs that failed to
 * initialize surfaces as that message's own error.
 *
 * `handleMessage` is a function declaration precisely so it can be referenced
 * here, above its definition.
 */
chrome.runtime.onMessage.addListener(handleMessage);

/** Uncaught errors in this worker land in the persistent diagnostics log,
 *  readable from the popup — the only console an iPad has. */
installGlobalDiagnostics("background");

const PREVIEW_LIMIT = 2000;
/** Matches the Sources panel's own per-file display cap. */
const SOURCE_FETCH_LIMIT = 60000;

/** The optional grant that unlocks reading every profile cookie. */
const ALL_HOSTS = ["http://*/*", "https://*/*"];

/** chrome.scripting takes extension-relative paths, not full chrome:// URLs. */
function toExtensionPath(bundleUrl: string): string {
  const resolved = new URL(bundleUrl, chrome.runtime.getURL("/"));
  return resolved.pathname.replace(/^\//, "");
}

const INSPECTOR_BUNDLE = toExtensionPath(inspectorBundleUrl);
const CONSOLE_PREHOOK = toExtensionPath(consolePrehookUrl);
const NETWORK_PREHOOK = toExtensionPath(networkPrehookUrl);

/** storage.session key for a tab whose inspector is open; value = origin. */
const openTabKey = (tabId: number) => `openTab:${tabId}`;
/** storage.session key for an origin's last active panel tab. */
const panelKey = (origin: string) => `panel:${origin}`;
const prehookScriptId = (origin: string) => `inspector-lab-prehook:${origin}`;

/**
 * Registers the console prehook as a document_start MAIN-world content script
 * for `origin`, so after a reload console capture starts before any page
 * script runs. Needs the per-origin host grant (the same one the popup
 * requests for cookies); without it the registration is skipped and capture
 * starts at relaunch instead — the pre-persistence behavior.
 */
async function ensurePrehookRegistered(origin: string): Promise<void> {
  const granted = await chrome.permissions.contains({
    origins: [`${origin}/*`],
  });
  if (!granted) return;

  const id = prehookScriptId(origin);
  const existing = await chrome.scripting.getRegisteredContentScripts({
    ids: [id],
  });
  if (existing.length > 0) return;

  await chrome.scripting.registerContentScripts([
    {
      id,
      js: [CONSOLE_PREHOOK, NETWORK_PREHOOK],
      matches: [`${origin}/*`],
      runAt: "document_start",
      world: "MAIN",
      persistAcrossSessions: false,
    },
  ]);
}

/**
 * chrome.storage.session is not universally implemented — Orion on iOS ships a
 * reduced API surface, and reading `.get` off an absent namespace throws at
 * module scope, which would stop this file before the listeners below are
 * registered. That is the same hazard the webRequest guard covers, with a wider
 * blast radius: no onMessage listener means every panel goes silent, not just
 * the Network one. A `.catch()` cannot help, because the throw happens while
 * building the call, before any promise exists.
 *
 * The in-memory mirror keeps open-tab tracking and reload persistence working
 * where the namespace is missing. Session storage only promises to live as long
 * as the browser session anyway, so a Map that dies with the service worker is
 * a narrower version of the same contract, not a different one.
 */
const memorySession = new Map<string, unknown>();

const nativeSession = ((): chrome.storage.StorageArea | null => {
  try {
    return chrome.storage?.session ?? null;
  } catch {
    return null;
  }
})();

const sessionStore = {
  async get(key: string | null): Promise<Record<string, unknown>> {
    if (nativeSession) {
      try {
        return (await nativeSession.get(key)) as Record<string, unknown>;
      } catch {
        /* Present but failing: fall back to the mirror below. */
      }
    }
    if (key === null) return Object.fromEntries(memorySession);
    return memorySession.has(key) ? { [key]: memorySession.get(key) } : {};
  },
  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      memorySession.set(key, value);
    }
    if (nativeSession) {
      try {
        await nativeSession.set(items);
      } catch {
        /* The mirror already holds it. */
      }
    }
  },
  async remove(key: string): Promise<void> {
    memorySession.delete(key);
    if (nativeSession) {
      try {
        await nativeSession.remove(key);
      } catch {
        /* The mirror already dropped it. */
      }
    }
  },
};

/**
 * Mirror of the open-tab set for synchronous checks in webRequest listeners
 * (storage.session is async). Rehydrated on service-worker start; kept in
 * sync by the TRACK handler and tabs.onRemoved.
 */
const openTabIds = new Set<number>();
void sessionStore
  .get(null)
  .then((all) => {
    for (const key of Object.keys(all)) {
      if (key.startsWith("openTab:")) {
        const tabId = Number(key.slice("openTab:".length));
        if (Number.isInteger(tabId)) openTabIds.add(tabId);
      }
    }
  })
  .catch(() => undefined);

/**
 * Headers-only request log per inspected tab, fed by chrome.webRequest —
 * covers documents, styles, images, and fonts, which never pass through
 * fetch/XHR. In-memory: a service-worker restart drops history, which the
 * panel treats the same as rows that predate the inspector.
 */
const webRequestLog = new Map<number, Map<string, WebRequestEntry>>();
const WEB_REQUEST_CAP = 500;

function tabRequestLog(tabId: number): Map<string, WebRequestEntry> {
  let log = webRequestLog.get(tabId);
  if (!log) {
    log = new Map();
    webRequestLog.set(tabId, log);
  }
  return log;
}

function headerPairsFrom(
  headers?: chrome.webRequest.HttpHeader[],
): [string, string][] {
  return (headers ?? [])
    .slice(0, 100)
    .map((header) => [
      header.name,
      header.value ?? (header.binaryValue ? "(binary)" : ""),
    ]);
}

/**
 * Registers one event listener, tolerating browsers that ship a namespace
 * without the event on it. Orion on iOS exposes chrome.webRequest but supports
 * neither onCompleted nor onErrorOccurred, and reading `.addListener` off an
 * absent event throws at module scope. That no longer silences the whole file
 * (onMessage is registered on its first line), but an unguarded throw would
 * still skip every registration after it, so each one gets its own guard. Also
 * covers an extraInfoSpec the browser rejects.
 */
function registerListener(
  register: () => void,
  unsupportedNote?: string,
): void {
  try {
    register();
  } catch {
    /* Unsupported here. Each caller degrades on its own terms: the Network
       panel falls back to the page's fetch/XHR hook, and the tab listeners
       cost reload persistence, not the inspector itself. */
    if (unsupportedNote) {
      void appendDiagnosticOnce({
        source: "background",
        level: "info",
        message: unsupportedNote,
      }).catch(() => undefined);
    }
  }
}

// webRequest was briefly an optional permission in the hope of shrinking
// Orion's install-time compatibility warning; a real-device test showed the
// warning is not driven by the manifest's required permissions, so it went
// back to required — the simpler shape, with listeners registered
// synchronously at worker start.
if (chrome.webRequest) {
  registerListener(() => {
    chrome.webRequest.onSendHeaders.addListener(
      (details) => {
        if (!openTabIds.has(details.tabId)) return;
        const log = tabRequestLog(details.tabId);
        log.set(details.requestId, {
          url: details.url,
          method: details.method,
          resourceType: details.type,
          status: 0,
          startEpoch: details.timeStamp,
          duration: 0,
          fromCache: false,
          error: null,
          requestHeaders: headerPairsFrom(details.requestHeaders),
          responseHeaders: [],
        });
        while (log.size > WEB_REQUEST_CAP) {
          const oldest = log.keys().next().value;
          if (oldest === undefined) break;
          log.delete(oldest);
        }
      },
      { urls: ["<all_urls>"] },
      ["requestHeaders", "extraHeaders"],
    );
  });

  registerListener(() => {
    chrome.webRequest.onCompleted.addListener(
      (details) => {
        const entry = webRequestLog.get(details.tabId)?.get(details.requestId);
        if (!entry) return;
        entry.status = details.statusCode;
        entry.responseHeaders = headerPairsFrom(details.responseHeaders);
        entry.fromCache = details.fromCache;
        entry.duration = details.timeStamp - entry.startEpoch;
      },
      { urls: ["<all_urls>"] },
      ["responseHeaders", "extraHeaders"],
    );
  }, "This browser exposes chrome.webRequest without its completion events; the Network panel uses the in-page fetch/XHR capture only.");

  registerListener(() => {
    chrome.webRequest.onErrorOccurred.addListener(
      (details) => {
        const entry = webRequestLog.get(details.tabId)?.get(details.requestId);
        if (!entry) return;
        entry.error = details.error;
        entry.duration = details.timeStamp - entry.startEpoch;
      },
      { urls: ["<all_urls>"] },
    );
  });
}

/**
 * Session tombstones: every open inspector is recorded in storage.local,
 * which survives what storage.session cannot — browser restarts and process
 * kills. Clean closes (the X button, or the tab itself closing) remove the
 * record; whatever is left over for a tab that no longer exists is a session
 * that ended without one, and the sweep turns it into a diagnostics entry.
 * That is the only crash signal an iPad leaves behind.
 */
const OPEN_SESSIONS_KEY = "inspectorOpenSessions";

type OpenSessions = Record<string, { origin: string; startedAt: number }>;

/**
 * Serializes every read-modify-write of the record. The startup sweep and the
 * first TRACK open run concurrently on a cold worker, and unserialized the
 * sweep's write could drop the record the open just added — losing exactly
 * the tombstone this exists to produce.
 */
let openSessionsQueue: Promise<unknown> = Promise.resolve();

function withOpenSessions<T>(task: () => Promise<T>): Promise<T> {
  const run = openSessionsQueue.then(task, task);
  openSessionsQueue = run.catch(() => undefined);
  return run;
}

async function readOpenSessions(): Promise<OpenSessions> {
  const stored = await storageGet(OPEN_SESSIONS_KEY);
  const value = stored[OPEN_SESSIONS_KEY];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const sessions: OpenSessions = {};
  for (const [key, session] of Object.entries(value)) {
    const candidate = session as Partial<OpenSessions[string]> | null;
    if (
      typeof candidate?.origin === "string" &&
      typeof candidate.startedAt === "number"
    ) {
      sessions[key] = {
        origin: candidate.origin,
        startedAt: candidate.startedAt,
      };
    }
  }
  return sessions;
}

function recordSessionOpen(tabId: number, origin: string): Promise<void> {
  return withOpenSessions(async () => {
    const sessions = await readOpenSessions();
    sessions[String(tabId)] = { origin, startedAt: Date.now() };
    await storageSet({ [OPEN_SESSIONS_KEY]: sessions });
  });
}

function recordSessionClosed(tabId: number): Promise<void> {
  return withOpenSessions(async () => {
    const sessions = await readOpenSessions();
    if (!(String(tabId) in sessions)) return;
    delete sessions[String(tabId)];
    await storageSet({ [OPEN_SESSIONS_KEY]: sessions });
  });
}

/**
 * Flags leftover records whose tab id no longer exists. Tab ids are never
 * reused within a browser session and change across restarts, so a record
 * without a live tab is exactly a session that never closed cleanly. A quit
 * with the inspector open lands here too — the entry wording owns that
 * ambiguity, since the OS kill this exists to catch is indistinguishable
 * from the outside.
 */
function sweepAbandonedSessions(): Promise<void> {
  return withOpenSessions(async () => {
    try {
      const sessions = await readOpenSessions();
      const keys = Object.keys(sessions);
      if (keys.length === 0) return;

      const tabs = await chrome.tabs.query({});
      const liveTabIds = new Set(tabs.map((tab) => tab.id));
      let changed = false;
      for (const key of keys) {
        if (liveTabIds.has(Number(key))) continue;
        const { origin } = sessions[key];
        delete sessions[key];
        changed = true;
        void appendDiagnostic({
          source: "background",
          level: "error",
          message: `The inspector session on ${origin} ended without a clean close — browser exit, page crash, or a memory kill.`,
        }).catch(() => undefined);
      }
      if (changed) await storageSet({ [OPEN_SESSIONS_KEY]: sessions });
    } catch {
      /* tabs.query unavailable: the sweep is an aid, not a requirement. */
    }
  });
}

void sweepAbandonedSessions();

/** Drops an origin's prehook registration once no open tab needs it. */
async function unregisterPrehookIfUnused(origin: string): Promise<void> {
  const all = await sessionStore.get(null);
  const stillUsed = Object.entries(all).some(
    ([key, value]) => key.startsWith("openTab:") && value === origin,
  );
  if (stillUsed) return;
  await chrome.scripting
    .unregisterContentScripts({ ids: [prehookScriptId(origin)] })
    .catch(() => undefined); // never registered (no host grant) — fine
}

/**
 * Reload persistence: a tab whose inspector is open (not closed with X) gets
 * the bundle re-injected when the tab finishes loading again. Works under the
 * per-site host grant, or activeTab for same-origin reloads; when both are
 * unavailable executeScript rejects and the inspector simply stays closed.
 */
registerListener(() => {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== "complete") return;
    void (async () => {
      const key = openTabKey(tabId);
      const stored = await sessionStore.get(key);
      if (!stored[key]) return;
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [INSPECTOR_BUNDLE],
        });
      } catch {
        /* Grant expired (cross-origin navigation without a host grant). */
      }
    })();
  });
});

registerListener(() => {
  chrome.tabs.onRemoved.addListener((tabId) => {
    openTabIds.delete(tabId);
    webRequestLog.delete(tabId);
    // Closing the tab counts as a clean end, not a crash.
    void recordSessionClosed(tabId).catch(() => undefined);
    void (async () => {
      const key = openTabKey(tabId);
      const stored = await sessionStore.get(key);
      const origin = stored[key] as string | undefined;
      if (origin === undefined) return;
      await sessionStore.remove(key);
      await unregisterPrehookIfUnused(origin).catch(() => undefined);
    })();
  });
});

/**
 * Runs in the page's MAIN world. Points the already-installed console hook
 * (injected/console-prehook.ts — via the document_start registration or the
 * files-injection just before this call) at a fresh event channel, then
 * replays anything buffered before the inspector connected. Self-contained:
 * no imports, no closure over module scope.
 */
function connectConsoleHook(eventName: string): boolean {
  type HookState = { eventName: string | null; buffer: string[] };
  const holder = window as Window & { __inspectorLabConsoleHook?: HookState };
  const state = holder.__inspectorLabConsoleHook;
  if (!state) return false;

  state.eventName = eventName;
  const pending = Array.isArray(state.buffer) ? state.buffer.splice(0) : [];
  for (const detail of pending) {
    document.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
  return true;
}

/**
 * Runs in the page's MAIN world. Points the already-installed network hook
 * (injected/network-prehook.ts) at a fresh event channel and replays
 * anything buffered before the inspector connected. Self-contained.
 */
function connectNetworkHook(eventName: string): boolean {
  type HookState = { eventName: string | null; buffer: string[] };
  const holder = window as Window & { __inspectorLabNetworkHook?: HookState };
  const state = holder.__inspectorLabNetworkHook;
  if (!state) return false;

  state.eventName = eventName;
  const pending = Array.isArray(state.buffer) ? state.buffer.splice(0) : [];
  for (const detail of pending) {
    document.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
  return true;
}

/**
 * chrome.cookies checks host permissions per cookie URL; without the per-site
 * grant the popup requests at launch, calls reject with a host-permission
 * error that deserves a clearer message than Chrome's own.
 */
function describeCookieError(error: unknown, action: string): string {
  if (error instanceof Error && /host permission/i.test(error.message)) {
    return "Cookie access is not granted for this site. Relaunch the inspector from the toolbar popup and allow cookie access.";
  }
  return error instanceof Error
    ? `Could not ${action}: ${error.message}`
    : `Could not ${action}.`;
}

/**
 * True when `host` (the inspector tab's hostname) can see a cookie scoped to
 * `cookieDomain` — the domains chrome.cookies.getAll({url}) itself returns.
 */
function cookieVisibleToHost(host: string, cookieDomain: string): boolean {
  const bare = cookieDomain.replace(/^\./, "");
  return host === bare || host.endsWith(`.${bare}`);
}

/**
 * The URL that addresses a cookie via chrome.cookies — also the URL Chrome
 * checks host permissions against. Domain cookies visible to the tab are
 * addressed on the tab's own host so the per-site grant suffices (a parent
 * domain like example.com is not covered by an app.example.com grant);
 * anything else is addressed on the cookie's own domain, which the all-sites
 * grant covers.
 */
function cookieRequestUrl(
  tab: URL,
  domain: string,
  path: string,
  secure: boolean,
): string {
  const bare = (domain || tab.hostname).replace(/^\./, "");
  const host =
    domain.startsWith(".") && cookieVisibleToHost(tab.hostname, domain)
      ? tab.hostname
      : bare;
  const scheme =
    secure || (host === tab.hostname && tab.protocol === "https:")
      ? "https"
      : "http";
  return `${scheme}://${host}${path}`;
}

/** Structural check for a draft arriving over runtime messaging. */
function isCookieDraft(value: unknown): value is CookieDraft {
  const draft = value as Partial<CookieDraft> | null;
  return (
    typeof draft?.name === "string" &&
    typeof draft.value === "string" &&
    typeof draft.domain === "string" &&
    typeof draft.path === "string" &&
    (draft.expirationDate === undefined ||
      typeof draft.expirationDate === "number") &&
    typeof draft.httpOnly === "boolean" &&
    typeof draft.secure === "boolean" &&
    ["no_restriction", "lax", "strict", "unspecified"].includes(
      draft.sameSite as string,
    )
  );
}

/** Structural check for the original-cookie identity of an edit. */
function isCookieIdentity(value: unknown): value is CookieIdentity {
  const identity = value as Partial<CookieIdentity> | null;
  return (
    typeof identity?.name === "string" &&
    typeof identity.domain === "string" &&
    typeof identity.path === "string" &&
    identity.path.startsWith("/") &&
    typeof identity.secure === "boolean"
  );
}

/** RFC 6265 token characters — the only bytes legal in a cookie name. */
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]*$/;

/**
 * Rejects drafts Chrome would refuse or silently mangle, with messages the
 * panel can show verbatim. Returns null when the draft is settable.
 */
function validateCookieDraft(draft: CookieDraft): string | null {
  if (!COOKIE_NAME_PATTERN.test(draft.name)) {
    return "Cookie names can only use letters, digits, and RFC 6265 token characters.";
  }
  if (draft.name === "" && draft.value === "") {
    return "A cookie needs a name or a value.";
  }
  if (/[;\u0000-\u001f\u007f]/.test(draft.value)) {
    return "Cookie values cannot contain semicolons or control characters.";
  }
  if (draft.name.length + draft.value.length > 4096) {
    return "Cookies are limited to 4096 bytes of name plus value.";
  }
  if (!draft.path.startsWith("/")) {
    return "Cookie paths must start with /.";
  }
  if (draft.sameSite === "no_restriction" && !draft.secure) {
    return "SameSite=None cookies must also be Secure.";
  }
  if (
    draft.name.startsWith("__Host-") &&
    (!draft.secure || draft.path !== "/" || draft.domain.startsWith("."))
  ) {
    return "__Host- cookies must be Secure and host-only with path /.";
  }
  if (draft.name.startsWith("__Secure-") && !draft.secure) {
    return "__Secure- cookies must be Secure.";
  }
  if (
    draft.expirationDate !== undefined &&
    !Number.isFinite(draft.expirationDate)
  ) {
    return "The expiry date could not be parsed.";
  }
  return null;
}

function handleMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean | undefined {
  const request = message as
    | EvaluateRequest
    | InterceptConsoleRequest
    | GetCookiesRequest
    | DeleteCookieRequest
    | SetCookieRequest
    | ClearSiteCookiesRequest
    | TrackInspectorRequest
    | FetchSourceRequest
    | InterceptNetworkRequest
    | GetNetworkDetailsRequest
    | RequestCookieAccessRequest
    | PingRequest;

  // Answered before the sender check and without holding the reply channel
  // open: this is the probe the inspector uses to tell "the background never
  // ran" apart from "the background ran but its async reply was dropped",
  // which are indistinguishable from a tablet otherwise.
  if (request?.type === PING_MESSAGE) {
    sendResponse({ ok: true } satisfies PingResponse);
    return;
  }

  if (
    request?.type !== EVALUATE_MESSAGE &&
    request?.type !== INTERCEPT_CONSOLE_MESSAGE &&
    request?.type !== INTERCEPT_NETWORK_MESSAGE &&
    request?.type !== GET_NETWORK_DETAILS_MESSAGE &&
    request?.type !== GET_COOKIES_MESSAGE &&
    request?.type !== DELETE_COOKIE_MESSAGE &&
    request?.type !== SET_COOKIE_MESSAGE &&
    request?.type !== CLEAR_SITE_COOKIES_MESSAGE &&
    request?.type !== TRACK_INSPECTOR_MESSAGE &&
    request?.type !== FETCH_SOURCE_MESSAGE &&
    request?.type !== REQUEST_COOKIE_ACCESS_MESSAGE
  ) {
    return;
  }

  // Only act on the tab the inspector itself is running in — the tab id
  // comes from the sender, never from the message payload.
  const tabId = sender.tab?.id;
  if (sender.id !== chrome.runtime.id || tabId === undefined) {
    if (request.type === EVALUATE_MESSAGE) {
      sendResponse({
        ok: false,
        preview: "Evaluation request rejected: unknown sender.",
      } satisfies EvaluateResponse);
    } else if (request.type === GET_COOKIES_MESSAGE) {
      sendResponse({
        ok: false,
        cookies: [],
        error: "Request rejected: unknown sender.",
      } satisfies GetCookiesResponse);
    } else if (request.type === GET_NETWORK_DETAILS_MESSAGE) {
      sendResponse({
        ok: false,
        entries: [],
      } satisfies GetNetworkDetailsResponse);
    } else {
      sendResponse({ ok: false } satisfies
        | InterceptConsoleResponse
        | DeleteCookieResponse
        | SetCookieResponse
        | ClearSiteCookiesResponse
        | TrackInspectorResponse
        | FetchSourceResponse
        | InterceptNetworkResponse
        | RequestCookieAccessResponse);
    }
    return;
  }

  if (request.type === GET_COOKIES_MESSAGE) {
    const tabUrl = sender.tab?.url;
    if (!tabUrl || !/^https?:/.test(tabUrl)) {
      sendResponse({
        ok: false,
        cookies: [],
        error: "Cookies are only readable on http(s) pages.",
      } satisfies GetCookiesResponse);
      return;
    }

    void (async () => {
      try {
        const scope = request.scope === "all" ? "all" : "site";
        // Report a missing grant explicitly rather than relying on the
        // cookies API failure shape, so the panel can offer the fix.
        const granted = await chrome.permissions.contains({
          origins:
            scope === "all" ? ALL_HOSTS : [`${new URL(tabUrl).origin}/*`],
        });
        if (!granted) {
          sendResponse({
            ok: false,
            cookies: [],
            granted: false,
            error:
              scope === "all"
                ? "Access to all sites has not been granted."
                : "Cookie access has not been granted for this site.",
          } satisfies GetCookiesResponse);
          return;
        }

        // Unfiltered getAll lists every cookie the grant reaches — the
        // whole profile for "all", the page's own cookies for "site".
        const cookies =
          scope === "all"
            ? await chrome.cookies.getAll({})
            : await chrome.cookies.getAll({ url: tabUrl });
        sendResponse({
          ok: true,
          granted: true,
          cookies: cookies.map((cookie): CookieEntry => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            expirationDate: cookie.expirationDate,
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            sameSite: cookie.sameSite,
          })),
        } satisfies GetCookiesResponse);
      } catch (error) {
        sendResponse({
          ok: false,
          cookies: [],
          error: describeCookieError(error, "read cookies"),
        } satisfies GetCookiesResponse);
      }
    })();

    // Keep the message channel open for the async response.
    return true;
  }

  if (request.type === REQUEST_COOKIE_ACCESS_MESSAGE) {
    const tabUrl = sender.tab?.url;
    if (!tabUrl || !/^https?:/.test(tabUrl)) {
      sendResponse({
        ok: false,
        error: "Cookies are only available on http(s) pages.",
      } satisfies RequestCookieAccessResponse);
      return;
    }

    void (async () => {
      try {
        const granted = await chrome.permissions.request({
          origins:
            request.scope === "all"
              ? ALL_HOSTS
              : [`${new URL(tabUrl).origin}/*`],
        });
        sendResponse({
          ok: granted,
          error: granted ? undefined : "Permission was declined.",
        } satisfies RequestCookieAccessResponse);
      } catch (error) {
        // Most likely the click gesture did not survive the round-trip.
        sendResponse({
          ok: false,
          error:
            error instanceof Error
              ? `Could not request access: ${error.message}. Try relaunching from the toolbar popup instead.`
              : "Could not request cookie access. Try relaunching from the toolbar popup instead.",
        } satisfies RequestCookieAccessResponse);
      }
    })();

    // Keep the message channel open for the async response.
    return true;
  }

  if (request.type === DELETE_COOKIE_MESSAGE) {
    const tabUrl = sender.tab?.url;
    const tab = tabUrl && /^https?:/.test(tabUrl) ? new URL(tabUrl) : null;
    const host = tab?.hostname ?? "";
    const valid =
      typeof request.name === "string" &&
      typeof request.domain === "string" &&
      typeof request.path === "string" &&
      request.path.startsWith("/") &&
      typeof request.secure === "boolean";
    if (!valid || tab === null) {
      sendResponse({
        ok: false,
        error: "Cookie deletion rejected.",
      } satisfies DeleteCookieResponse);
      return;
    }

    void (async () => {
      try {
        // Cookies the page itself sees are always fair game; anything
        // beyond that needs the explicit all-sites grant.
        const allowed =
          cookieVisibleToHost(host, request.domain) ||
          (await chrome.permissions.contains({ origins: ALL_HOSTS }));
        if (!allowed) {
          sendResponse({
            ok: false,
            error: "Cookie deletion rejected.",
          } satisfies DeleteCookieResponse);
          return;
        }

        const cookieUrl = cookieRequestUrl(
          tab,
          request.domain,
          request.path,
          request.secure,
        );
        const details = await chrome.cookies.remove({
          url: cookieUrl,
          name: request.name,
        });
        sendResponse({
          ok: details !== null,
          error:
            details === null ? "The cookie could not be deleted." : undefined,
        } satisfies DeleteCookieResponse);
      } catch (error) {
        sendResponse({
          ok: false,
          error: describeCookieError(error, "delete the cookie"),
        } satisfies DeleteCookieResponse);
      }
    })();

    // Keep the message channel open for the async response.
    return true;
  }

  if (request.type === SET_COOKIE_MESSAGE) {
    const tabUrl = sender.tab?.url;
    const tab = tabUrl && /^https?:/.test(tabUrl) ? new URL(tabUrl) : null;
    if (tab === null) {
      sendResponse({
        ok: false,
        error: "Cookies can only be edited on http(s) pages.",
      } satisfies SetCookieResponse);
      return;
    }
    if (
      !isCookieDraft(request.next) ||
      (request.original !== null && !isCookieIdentity(request.original))
    ) {
      sendResponse({
        ok: false,
        error: "Cookie edit rejected.",
      } satisfies SetCookieResponse);
      return;
    }
    const invalid = validateCookieDraft(request.next);
    if (invalid) {
      sendResponse({ ok: false, error: invalid } satisfies SetCookieResponse);
      return;
    }

    const { original, next } = request;
    void (async () => {
      try {
        // Same rule as deletion: cookies the page itself sees are fair
        // game under the per-site grant; anything else — including the
        // cookie being moved away from — needs the all-sites grant.
        const touched = [next.domain || tab.hostname].concat(
          original ? [original.domain] : [],
        );
        const allowed =
          touched.every((domain) =>
            cookieVisibleToHost(tab.hostname, domain),
          ) || (await chrome.permissions.contains({ origins: ALL_HOSTS }));
        if (!allowed) {
          sendResponse({
            ok: false,
            error: "Cookie edit rejected.",
          } satisfies SetCookieResponse);
          return;
        }

        // Renames and re-scopes change the cookie's identity: capture the
        // old cookie for rollback, remove it, then write the replacement.
        const identityChanged =
          original !== null &&
          (original.name !== next.name ||
            original.domain !== next.domain ||
            original.path !== next.path);
        let backup: chrome.cookies.Cookie | null = null;
        if (identityChanged && original) {
          const originalUrl = cookieRequestUrl(
            tab,
            original.domain,
            original.path,
            original.secure,
          );
          backup = await chrome.cookies.get({
            url: originalUrl,
            name: original.name,
          });
          await chrome.cookies.remove({
            url: originalUrl,
            name: original.name,
          });
        }

        try {
          const written = await chrome.cookies.set({
            url: cookieRequestUrl(tab, next.domain, next.path, next.secure),
            name: next.name,
            value: next.value,
            path: next.path,
            // A leading dot means a domain cookie; omitting `domain`
            // makes the cookie host-only for the URL's host.
            ...(next.domain.startsWith(".")
              ? { domain: next.domain.replace(/^\./, "") }
              : {}),
            ...(next.expirationDate !== undefined
              ? { expirationDate: next.expirationDate }
              : {}),
            httpOnly: next.httpOnly,
            secure: next.secure,
            sameSite: next.sameSite,
          });
          if (!written) throw new Error("Chrome rejected the cookie.");
          sendResponse({ ok: true } satisfies SetCookieResponse);
        } catch (error) {
          // Restore the removed original so a failed rename never turns
          // into a silent delete.
          if (backup) {
            await chrome.cookies
              .set({
                url: cookieRequestUrl(
                  tab,
                  backup.domain,
                  backup.path,
                  backup.secure,
                ),
                name: backup.name,
                value: backup.value,
                path: backup.path,
                ...(backup.hostOnly
                  ? {}
                  : { domain: backup.domain.replace(/^\./, "") }),
                ...(backup.session || backup.expirationDate === undefined
                  ? {}
                  : { expirationDate: backup.expirationDate }),
                httpOnly: backup.httpOnly,
                secure: backup.secure,
                sameSite: backup.sameSite,
              })
              .catch(() => undefined);
          }
          sendResponse({
            ok: false,
            error: describeCookieError(error, "save the cookie"),
          } satisfies SetCookieResponse);
        }
      } catch (error) {
        sendResponse({
          ok: false,
          error: describeCookieError(error, "save the cookie"),
        } satisfies SetCookieResponse);
      }
    })();

    // Keep the message channel open for the async response.
    return true;
  }

  if (request.type === CLEAR_SITE_COOKIES_MESSAGE) {
    const tabUrl = sender.tab?.url;
    const tab = tabUrl && /^https?:/.test(tabUrl) ? new URL(tabUrl) : null;
    if (tab === null) {
      sendResponse({
        ok: false,
        error: "Cookies can only be cleared on http(s) pages.",
      } satisfies ClearSiteCookiesResponse);
      return;
    }

    void (async () => {
      try {
        const granted = await chrome.permissions.contains({
          origins: [`${tab.origin}/*`],
        });
        if (!granted) {
          sendResponse({
            ok: false,
            error: "Cookie access has not been granted for this site.",
          } satisfies ClearSiteCookiesResponse);
          return;
        }

        // Always scoped to what this page can see, never the whole profile.
        const cookies = await chrome.cookies.getAll({ url: tab.href });
        let removed = 0;
        for (const cookie of cookies) {
          const result = await chrome.cookies
            .remove({
              url: cookieRequestUrl(
                tab,
                cookie.domain,
                cookie.path,
                cookie.secure,
              ),
              name: cookie.name,
            })
            .catch(() => null);
          if (result) removed += 1;
        }
        sendResponse({
          ok: true,
          removed,
        } satisfies ClearSiteCookiesResponse);
      } catch (error) {
        sendResponse({
          ok: false,
          error: describeCookieError(error, "clear cookies"),
        } satisfies ClearSiteCookiesResponse);
      }
    })();

    // Keep the message channel open for the async response.
    return true;
  }

  if (request.type === INTERCEPT_NETWORK_MESSAGE) {
    if (
      typeof request.eventName !== "string" ||
      !isNetworkEventName(request.eventName)
    ) {
      sendResponse({ ok: false } satisfies InterceptNetworkResponse);
      return;
    }

    const eventName = request.eventName;
    void (async () => {
      try {
        // Idempotent: installs the wrapper unless the document_start
        // registration (or an earlier launch) already has.
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          injectImmediately: true,
          files: [NETWORK_PREHOOK],
        });
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          injectImmediately: true,
          func: connectNetworkHook,
          args: [eventName],
        });
        sendResponse({
          ok: injection?.result === true,
        } satisfies InterceptNetworkResponse);
      } catch {
        sendResponse({ ok: false } satisfies InterceptNetworkResponse);
      }
    })();

    // Keep the message channel open for the async response.
    return true;
  }

  if (request.type === GET_NETWORK_DETAILS_MESSAGE) {
    const log = webRequestLog.get(tabId);
    sendResponse({
      ok: true,
      entries: log ? Array.from(log.values()) : [],
    } satisfies GetNetworkDetailsResponse);
    return;
  }

  if (request.type === FETCH_SOURCE_MESSAGE) {
    if (typeof request.url !== "string" || !/^https?:\/\//.test(request.url)) {
      sendResponse({
        ok: false,
        error: "Only http(s) resources can be fetched.",
      } satisfies FetchSourceResponse);
      return;
    }

    const url = request.url;
    void (async () => {
      try {
        // Prefer the HTTP cache (the page already loaded this resource)
        // and never attach credentials: source viewing needs no cookies.
        const response = await fetch(url, {
          cache: "force-cache",
          credentials: "omit",
        });
        if (!response.ok) {
          sendResponse({
            ok: false,
            error: `The server responded with ${response.status}.`,
          } satisfies FetchSourceResponse);
          return;
        }
        const { text, truncated } = await readBodyCapped(
          response,
          SOURCE_FETCH_LIMIT,
        );
        sendResponse({
          ok: true,
          content: text,
          truncated,
        } satisfies FetchSourceResponse);
      } catch {
        sendResponse({
          ok: false,
          error:
            "The file could not be fetched — its host blocks cross-origin reads and no host permission covers it.",
        } satisfies FetchSourceResponse);
      }
    })();

    // Keep the message channel open for the async response.
    return true;
  }

  if (request.type === INTERCEPT_CONSOLE_MESSAGE) {
    if (
      typeof request.eventName !== "string" ||
      !isConsoleEventName(request.eventName)
    ) {
      sendResponse({ ok: false } satisfies InterceptConsoleResponse);
      return;
    }

    const eventName = request.eventName;
    void (async () => {
      try {
        // Idempotent: installs the wrapper unless the document_start
        // registration (or an earlier launch) already has.
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          injectImmediately: true,
          files: [CONSOLE_PREHOOK],
        });
        const [injection] = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          injectImmediately: true,
          func: connectConsoleHook,
          args: [eventName],
        });
        sendResponse({
          ok: injection?.result === true,
        } satisfies InterceptConsoleResponse);
      } catch {
        sendResponse({ ok: false } satisfies InterceptConsoleResponse);
      }
    })();

    // Keep the message channel open for the async response.
    return true;
  }

  if (request.type === TRACK_INSPECTOR_MESSAGE) {
    const tabUrl = sender.tab?.url;
    void (async () => {
      try {
        if (request.open === true) {
          if (!tabUrl || !/^https?:/.test(tabUrl)) {
            sendResponse({ ok: false } satisfies TrackInspectorResponse);
            return;
          }
          const origin = new URL(tabUrl).origin;
          openTabIds.add(tabId);
          await sessionStore.set({ [openTabKey(tabId)]: origin });
          await recordSessionOpen(tabId, origin).catch(() => undefined);
          await ensurePrehookRegistered(origin).catch(() => undefined);

          // Panel-tab memory, per origin: a panel switch stores the name;
          // a plain open gets the remembered one echoed back.
          if (
            typeof request.activeTab === "string" &&
            request.activeTab.length <= 32
          ) {
            await sessionStore.set({
              [panelKey(origin)]: request.activeTab,
            });
            sendResponse({ ok: true } satisfies TrackInspectorResponse);
          } else {
            const stored = await sessionStore.get(panelKey(origin));
            const activeTab = stored[panelKey(origin)];
            sendResponse({
              ok: true,
              ...(typeof activeTab === "string" ? { activeTab } : {}),
            } satisfies TrackInspectorResponse);
          }
        } else {
          openTabIds.delete(tabId);
          await recordSessionClosed(tabId).catch(() => undefined);
          const key = openTabKey(tabId);
          const stored = await sessionStore.get(key);
          const origin = stored[key] as string | undefined;
          await sessionStore.remove(key);
          if (origin !== undefined) await unregisterPrehookIfUnused(origin);
          sendResponse({ ok: true } satisfies TrackInspectorResponse);
        }
      } catch {
        sendResponse({ ok: false } satisfies TrackInspectorResponse);
      }
    })();

    // Keep the message channel open for the async response.
    return true;
  }

  if (typeof request.expression !== "string") {
    return;
  }

  chrome.scripting
    .executeScript({
      target: { tabId },
      world: "MAIN",
      func: evaluateInPage,
      args: [request.expression, PREVIEW_LIMIT],
    })
    .then(([injection]) => {
      sendResponse(
        (injection?.result as EvaluateResponse | undefined) ?? {
          ok: false,
          preview: "The page did not return a result.",
        },
      );
    })
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        preview:
          error instanceof Error
            ? `Could not evaluate: ${error.message}`
            : "Could not evaluate in this tab.",
      } satisfies EvaluateResponse);
    });

  // Keep the message channel open for the async response.
  return true;
}
