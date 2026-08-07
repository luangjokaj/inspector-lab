import {
  CLEAR_SITE_COOKIES_MESSAGE,
  DELETE_COOKIE_MESSAGE,
  EVALUATE_MESSAGE,
  FETCH_SOURCE_MESSAGE,
  GET_COOKIES_MESSAGE,
  GET_NETWORK_DETAILS_MESSAGE,
  INTERCEPT_CONSOLE_MESSAGE,
  INTERCEPT_NETWORK_MESSAGE,
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
  type RequestCookieAccessRequest,
  type RequestCookieAccessResponse,
  type SetCookieRequest,
  type SetCookieResponse,
  type TrackInspectorRequest,
  type TrackInspectorResponse,
  type WebRequestEntry,
} from "~lib/messages";
import { readBodyCapped } from "~lib/source-fetch";
import inspectorBundleUrl from "url:./injected/inspector-entry.tsx";
import consolePrehookUrl from "url:./injected/console-prehook.ts";
import networkPrehookUrl from "url:./injected/network-prehook.ts";

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
 * Mirror of the open-tab set for synchronous checks in webRequest listeners
 * (storage.session is async). Rehydrated on service-worker start; kept in
 * sync by the TRACK handler and tabs.onRemoved.
 */
const openTabIds = new Set<number>();
void chrome.storage.session
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

if (chrome.webRequest) {
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

  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      const entry = webRequestLog.get(details.tabId)?.get(details.requestId);
      if (!entry) return;
      entry.error = details.error;
      entry.duration = details.timeStamp - entry.startEpoch;
    },
    { urls: ["<all_urls>"] },
  );
}

/** Drops an origin's prehook registration once no open tab needs it. */
async function unregisterPrehookIfUnused(origin: string): Promise<void> {
  const all = await chrome.storage.session.get(null);
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
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  void (async () => {
    const key = openTabKey(tabId);
    const stored = await chrome.storage.session.get(key);
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

chrome.tabs.onRemoved.addListener((tabId) => {
  openTabIds.delete(tabId);
  webRequestLog.delete(tabId);
  void (async () => {
    const key = openTabKey(tabId);
    const stored = await chrome.storage.session.get(key);
    const origin = stored[key] as string | undefined;
    if (origin === undefined) return;
    await chrome.storage.session.remove(key);
    await unregisterPrehookIfUnused(origin).catch(() => undefined);
  })();
});

/**
 * Runs inside the page's MAIN world via chrome.scripting, so it must be fully
 * self-contained: no imports, no closure over module scope. It evaluates with
 * the same authority page scripts already have — no extension APIs leak in —
 * and returns a plain-text preview, never a live value.
 */
function evaluateInPage(expression: string, limit: number): EvaluateResponse {
  const describe = (value: unknown, depth: number): string => {
    if (value === null) return "null";
    if (value === undefined) return "undefined";

    const type = typeof value;
    if (type === "string") return JSON.stringify(value);
    if (type === "number" || type === "boolean" || type === "bigint") {
      return String(value);
    }
    if (type === "symbol") return String(value);
    if (type === "function") {
      const name = (value as { name?: string }).name;
      return `ƒ ${name || "anonymous"}()`;
    }
    if (value instanceof Error) {
      return `${value.name}: ${value.message}`;
    }
    if (value instanceof Element) {
      const id = value.id ? `#${value.id}` : "";
      const cls =
        typeof value.className === "string" && value.className
          ? `.${value.className.trim().split(/\s+/).join(".")}`
          : "";
      return `<${value.tagName.toLowerCase()}${id}${cls}>`;
    }
    if (typeof (value as { then?: unknown }).then === "function") {
      return "Promise (value not awaited)";
    }
    if (depth >= 2) return Array.isArray(value) ? "Array(…)" : "{…}";

    if (Array.isArray(value)) {
      const items = value
        .slice(0, 10)
        .map((item) => describe(item, depth + 1))
        .join(", ");
      const more = value.length > 10 ? `, … ${value.length - 10} more` : "";
      return `(${value.length}) [${items}${more}]`;
    }

    try {
      const entries = Object.entries(value as Record<string, unknown>)
        .slice(0, 10)
        .map(([key, item]) => `${key}: ${describe(item, depth + 1)}`);
      const tag =
        (value as object).constructor?.name &&
        (value as object).constructor.name !== "Object"
          ? `${(value as object).constructor.name} `
          : "";
      return `${tag}{${entries.join(", ")}}`;
    } catch {
      return Object.prototype.toString.call(value);
    }
  };

  try {
    // Indirect eval: global scope, same privileges as any page script.
    const result = (0, eval)(expression);
    const preview = describe(result, 0);
    return {
      ok: true,
      preview: preview.length > limit ? `${preview.slice(0, limit)}…` : preview,
    };
  } catch (error) {
    if (
      error instanceof EvalError ||
      (error instanceof Error &&
        /unsafe-eval|Content Security Policy/i.test(error.message))
    ) {
      return {
        ok: false,
        preview:
          "This site's Content Security Policy blocks eval. Browser DevTools can bypass CSP; an in-page inspector cannot.",
      };
    }
    return {
      ok: false,
      preview:
        error instanceof Error
          ? `Uncaught ${error.name}: ${error.message}`
          : `Uncaught ${String(error)}`,
    };
  }
}

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

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
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
      | RequestCookieAccessRequest;
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
      if (
        typeof request.url !== "string" ||
        !/^https?:\/\//.test(request.url)
      ) {
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
            await chrome.storage.session.set({ [openTabKey(tabId)]: origin });
            await ensurePrehookRegistered(origin).catch(() => undefined);

            // Panel-tab memory, per origin: a panel switch stores the name;
            // a plain open gets the remembered one echoed back.
            if (
              typeof request.activeTab === "string" &&
              request.activeTab.length <= 32
            ) {
              await chrome.storage.session.set({
                [panelKey(origin)]: request.activeTab,
              });
              sendResponse({ ok: true } satisfies TrackInspectorResponse);
            } else {
              const stored = await chrome.storage.session.get(panelKey(origin));
              const activeTab = stored[panelKey(origin)];
              sendResponse({
                ok: true,
                ...(typeof activeTab === "string" ? { activeTab } : {}),
              } satisfies TrackInspectorResponse);
            }
          } else {
            openTabIds.delete(tabId);
            const key = openTabKey(tabId);
            const stored = await chrome.storage.session.get(key);
            const origin = stored[key] as string | undefined;
            await chrome.storage.session.remove(key);
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
  },
);
