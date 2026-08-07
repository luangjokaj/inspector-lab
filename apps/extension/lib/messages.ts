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

export type EvaluateResponse = {
  ok: boolean;
  /** Already-serialized, human-readable preview of the result or error. */
  preview: string;
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
};

export const GET_COOKIES_MESSAGE = "inspector-lab/get-cookies" as const;

/** Asks the background for the cookies visible to the inspector's tab. */
export type GetCookiesRequest = {
  type: typeof GET_COOKIES_MESSAGE;
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

const CONSOLE_EVENT_PREFIX = "inspector-lab-console:";

/**
 * The event name doubles as an unguessable channel token: page scripts that
 * never see it can neither eavesdrop on captured entries nor spoof them.
 */
export function randomConsoleEventName(): string {
  const token =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
  return `${CONSOLE_EVENT_PREFIX}${token}`;
}

/** Background-side check that a requested event name is one of ours. */
export function isConsoleEventName(value: string): boolean {
  return /^inspector-lab-console:[0-9a-f-]{32,36}$/.test(value);
}
