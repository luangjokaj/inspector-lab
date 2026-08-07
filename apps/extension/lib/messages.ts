/**
 * Messages between the injected inspector (content-script world) and the
 * background service worker. The inspector cannot touch the page's JS realm
 * itself, so console evaluation and console capture round-trip through the
 * background, which re-injects into the MAIN world.
 */

export const EVALUATE_MESSAGE = "inspector-lab/evaluate" as const;

export type EvaluateRequest = {
  type: typeof EVALUATE_MESSAGE;
  expression: string;
};

/**
 * Tone tag for a serialized console value, mapped onto the theme's syntax
 * colors by the Console panel — DevTools colors primitives by type.
 */
export type ConsoleTone = "text" | "number" | "boolean" | "nullish" | "string";

/** One argument's slice of a console message, carrying its tone. */
export type ConsolePart = { text: string; tone: ConsoleTone };

export type EvaluateResponse = {
  ok: boolean;
  /** Already-serialized, human-readable preview of the result or error. */
  preview: string;
  /** Tone of the whole preview, present when the result is a primitive. */
  tone?: ConsoleTone;
};

export const INTERCEPT_CONSOLE_MESSAGE =
  "inspector-lab/intercept-console" as const;

/** Asks the background to patch the page's console in the MAIN world. */
export type InterceptConsoleRequest = {
  type: typeof INTERCEPT_CONSOLE_MESSAGE;
  /** Per-injection DOM event name the interceptor dispatches entries on. */
  eventName: string;
};

export type InterceptConsoleResponse = {
  ok: boolean;
};

/** Console method the page called; the panel maps it to a ConsoleLevel. */
export type CapturedConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

/** Payload carried — JSON-stringified — in the interceptor's CustomEvent. */
export type CapturedConsolePayload = {
  level: CapturedConsoleMethod;
  text: string;
  /** Per-argument toned segments; `text` stays the joined fallback. */
  parts?: ConsolePart[];
  /** `file:line` of the page call site, when a page frame was identifiable. */
  source?: string;
};

export const GET_COOKIES_MESSAGE = "inspector-lab/get-cookies" as const;

/**
 * "site" lists the cookies the inspector's page itself receives; "all" lists
 * every cookie in the profile, which needs the all-sites host grant.
 */
export type CookieScope = "site" | "all";

/** Asks the background for the cookies visible to the inspector's tab. */
export type GetCookiesRequest = {
  type: typeof GET_COOKIES_MESSAGE;
  scope?: CookieScope;
};

/** One cookie, mirroring the chrome.cookies fields the panel renders. */
export type CookieEntry = {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds; absent for session cookies. */
  expirationDate?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "no_restriction" | "lax" | "strict" | "unspecified";
};

export type GetCookiesResponse = {
  ok: boolean;
  cookies: CookieEntry[];
  /** False when the per-site host permission has not been granted. */
  granted?: boolean;
  error?: string;
};

export const REQUEST_COOKIE_ACCESS_MESSAGE =
  "inspector-lab/request-cookie-access" as const;

/**
 * Asks the background to prompt for the sender tab's host permission. The
 * user's click on the panel button carries through runtime messaging as the
 * gesture chrome.permissions.request requires.
 */
export type RequestCookieAccessRequest = {
  type: typeof REQUEST_COOKIE_ACCESS_MESSAGE;
  scope?: CookieScope;
};

export type RequestCookieAccessResponse = {
  ok: boolean;
  error?: string;
};

export const DELETE_COOKIE_MESSAGE = "inspector-lab/delete-cookie" as const;

/**
 * Identifies the cookie by the fields chrome.cookies.remove needs to build
 * its URL. The background still validates the domain against the sender tab.
 */
export type DeleteCookieRequest = {
  type: typeof DELETE_COOKIE_MESSAGE;
  name: string;
  domain: string;
  path: string;
  secure: boolean;
};

export type DeleteCookieResponse = {
  ok: boolean;
  error?: string;
};

export const SET_COOKIE_MESSAGE = "inspector-lab/set-cookie" as const;

/** The fields that identify an existing cookie to chrome.cookies. */
export type CookieIdentity = Pick<
  CookieEntry,
  "name" | "domain" | "path" | "secure"
>;

/**
 * A cookie as the editor wants it to exist. `domain` follows the cookie
 * store's own convention: a leading dot means a domain cookie, a bare value
 * (or "" for the tab's host) means host-only.
 */
export type CookieDraft = {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds; absent for session cookies. */
  expirationDate?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: CookieEntry["sameSite"];
};

/**
 * Creates (original: null) or rewrites a cookie. When the edit changes the
 * cookie's identity (name/domain/path), the background removes the original
 * and restores it if writing the replacement fails.
 */
export type SetCookieRequest = {
  type: typeof SET_COOKIE_MESSAGE;
  original: CookieIdentity | null;
  next: CookieDraft;
};

export type SetCookieResponse = {
  ok: boolean;
  error?: string;
};

export const CLEAR_SITE_COOKIES_MESSAGE =
  "inspector-lab/clear-site-cookies" as const;

/**
 * Deletes every cookie the sender tab's page can see. Deliberately scoped to
 * the site even when the panel lists all domains — a one-click wipe of the
 * whole profile is a footgun DevTools does not offer either.
 */
export type ClearSiteCookiesRequest = {
  type: typeof CLEAR_SITE_COOKIES_MESSAGE;
};

export type ClearSiteCookiesResponse = {
  ok: boolean;
  removed?: number;
  error?: string;
};

export const TRACK_INSPECTOR_MESSAGE = "inspector-lab/track-inspector" as const;

/**
 * Marks the sender's tab as having the inspector open (or closed). Open tabs
 * are re-injected after a reload, and their origin gets the document_start
 * console prehook registered so capture starts before page scripts run.
 *
 * `activeTab` piggybacks the panel-tab memory: sent when the user switches
 * panels, it is stored per-origin; an open request without it gets the
 * origin's last panel echoed back so a reloaded inspector reopens there.
 */
export type TrackInspectorRequest = {
  type: typeof TRACK_INSPECTOR_MESSAGE;
  open: boolean;
  activeTab?: string;
};

export type TrackInspectorResponse = {
  ok: boolean;
  /** The origin's remembered panel tab, echoed on open requests. */
  activeTab?: string;
};

export const FETCH_SOURCE_MESSAGE = "inspector-lab/fetch-source" as const;

/**
 * Fetches an external source file's text for the Sources panel — only ever
 * sent after the user clicks the file. The panel tries a page-context fetch
 * first; this background fallback covers cross-origin resources that reject
 * CORS but fall under a host grant.
 */
export type FetchSourceRequest = {
  type: typeof FETCH_SOURCE_MESSAGE;
  url: string;
};

export type FetchSourceResponse = {
  ok: boolean;
  content?: string;
  truncated?: boolean;
  error?: string;
};

export const INTERCEPT_NETWORK_MESSAGE =
  "inspector-lab/intercept-network" as const;

/** Asks the background to install the fetch/XHR interceptor and connect it
 *  to a per-launch event channel, mirroring the console flow. */
export type InterceptNetworkRequest = {
  type: typeof INTERCEPT_NETWORK_MESSAGE;
  eventName: string;
};

export type InterceptNetworkResponse = {
  ok: boolean;
};

/**
 * One phased payload from the network interceptor. A request emits `start`,
 * then `response` and `body` (or `error`); the inspector reduces them by id
 * so a slow body read never delays the row.
 */
export type NetworkCapturePhase = {
  id: string;
  phase: "start" | "response" | "body" | "error";
  source?: "fetch" | "xhr";
  url?: string;
  method?: string;
  startTime?: number;
  requestHeaders?: [string, string][];
  requestBody?: string | null;
  requestBodyTruncated?: boolean;
  status?: number;
  statusText?: string;
  responseHeaders?: [string, string][];
  contentType?: string;
  duration?: number;
  responseBody?: string | null;
  responseBodyTruncated?: boolean;
  error?: string;
};

/** A fully reduced fetch/XHR capture, as the Network panel consumes it. */
export type CapturedNetworkRequest = {
  id: string;
  source: "fetch" | "xhr";
  url: string;
  method: string;
  startTime: number;
  requestHeaders: [string, string][];
  requestBody: string | null;
  requestBodyTruncated: boolean;
  status: number;
  statusText: string;
  responseHeaders: [string, string][];
  contentType: string;
  duration: number;
  responseBody: string | null;
  responseBodyTruncated: boolean;
  pending: boolean;
  error: string | null;
};

export const GET_NETWORK_DETAILS_MESSAGE =
  "inspector-lab/get-network-details" as const;

/** Asks the background for the webRequest header log of the sender's tab. */
export type GetNetworkDetailsRequest = {
  type: typeof GET_NETWORK_DETAILS_MESSAGE;
};

/**
 * Headers-only record of one request observed via chrome.webRequest — the
 * tier that covers documents, styles, images, and fonts, which never pass
 * through fetch/XHR. Bodies are not available at this layer in MV3.
 */
export type WebRequestEntry = {
  url: string;
  method: string;
  resourceType: string;
  status: number;
  /** Epoch ms when the request started. */
  startEpoch: number;
  duration: number;
  fromCache: boolean;
  error: string | null;
  requestHeaders: [string, string][];
  responseHeaders: [string, string][];
};

export type GetNetworkDetailsResponse = {
  ok: boolean;
  entries: WebRequestEntry[];
};

const CONSOLE_EVENT_PREFIX = "inspector-lab-console:";
const NETWORK_EVENT_PREFIX = "inspector-lab-network:";

/**
 * The event name doubles as an unguessable channel token: page scripts that
 * never see it can neither eavesdrop on captured entries nor spoof them.
 */
function randomChannelToken(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
}

export function randomConsoleEventName(): string {
  return `${CONSOLE_EVENT_PREFIX}${randomChannelToken()}`;
}

/** Background-side check that a requested event name is one of ours. */
export function isConsoleEventName(value: string): boolean {
  return /^inspector-lab-console:[0-9a-f-]{32,36}$/.test(value);
}

export function randomNetworkEventName(): string {
  return `${NETWORK_EVENT_PREFIX}${randomChannelToken()}`;
}

/** Background-side check that a requested event name is one of ours. */
export function isNetworkEventName(value: string): boolean {
  return /^inspector-lab-network:[0-9a-f-]{32,36}$/.test(value);
}
