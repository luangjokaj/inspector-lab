import {
  DELETE_COOKIE_MESSAGE,
  EVALUATE_MESSAGE,
  GET_COOKIES_MESSAGE,
  INTERCEPT_CONSOLE_MESSAGE,
  REQUEST_COOKIE_ACCESS_MESSAGE,
  isConsoleEventName,
  type CookieEntry,
  type DeleteCookieRequest,
  type DeleteCookieResponse,
  type EvaluateRequest,
  type EvaluateResponse,
  type GetCookiesResponse,
  type GetCookiesRequest,
  type InterceptConsoleRequest,
  type InterceptConsoleResponse,
  type RequestCookieAccessRequest,
  type RequestCookieAccessResponse,
} from "~lib/messages";

const PREVIEW_LIMIT = 2000;

/** The optional grant that unlocks reading every profile cookie. */
const ALL_HOSTS = ["http://*/*", "https://*/*"];

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
 * Runs in the page's MAIN world. Wraps the console methods so every call is
 * re-broadcast as a CustomEvent whose detail is a JSON string (plain strings
 * cross the MAIN/ISOLATED world boundary reliably), which the injected
 * inspector listens for under a random per-launch event name. Idempotent:
 * re-injection only rotates the event name, it never double-wraps.
 *
 * Like `evaluateInPage`, it must be fully self-contained — no imports, no
 * closure over module scope — which is why the serializer is duplicated.
 */
function installConsoleInterceptor(eventName: string, limit: number): boolean {
  type HookState = { eventName: string };
  const holder = window as Window & { __inspectorLabConsoleHook?: HookState };

  const installed = holder.__inspectorLabConsoleHook;
  if (installed) {
    installed.eventName = eventName;
    return true;
  }

  const state: HookState = { eventName };
  holder.__inspectorLabConsoleHook = state;

  const describe = (value: unknown, depth: number): string => {
    if (value === null) return "null";
    if (value === undefined) return "undefined";

    const type = typeof value;
    // Top-level strings print bare, the way the real console renders them.
    if (type === "string") {
      return depth === 0 ? (value as string) : JSON.stringify(value);
    }
    if (
      type === "number" ||
      type === "boolean" ||
      type === "bigint" ||
      type === "symbol"
    ) {
      return String(value);
    }
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
    // Never enumerate window — hundreds of properties, some cross-origin.
    if (value === window) return "Window";
    if (typeof (value as { then?: unknown }).then === "function") {
      return "Promise";
    }

    if (Array.isArray(value)) {
      if (depth >= 2) return `Array(${value.length})`;
      const items = value
        .slice(0, 10)
        .map((item) => describe(item, depth + 1))
        .join(", ");
      const more = value.length > 10 ? `, … ${value.length - 10} more` : "";
      return `(${value.length}) [${items}${more}]`;
    }
    if (depth >= 2) return "{…}";

    try {
      const entries = Object.entries(value as Record<string, unknown>)
        .slice(0, 10)
        .map(([key, item]) => `${key}: ${describe(item, depth + 1)}`);
      const ctor = (value as object).constructor?.name;
      const tag = ctor && ctor !== "Object" ? `${ctor} ` : "";
      return `${tag}{${entries.join(", ")}}`;
    } catch {
      return Object.prototype.toString.call(value);
    }
  };

  /** `String(value)` that can never throw (revoked proxies, hostile toString). */
  const toStringSafe = (value: unknown): string => {
    try {
      return String(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  };

  /**
   * Chrome's format specifiers: they apply only when the first argument is a
   * string, each specifier consumes one following argument, unmatched
   * specifiers stay literal, `%%` escapes, and leftover arguments are
   * appended space-separated. `%c` consumes its CSS argument but styles
   * cannot be rendered in a text-only feed, so it contributes nothing.
   */
  const format = (args: unknown[]): string => {
    const first = args[0];
    if (typeof first !== "string" || !/%[sdifoOc%]/.test(first)) {
      return args.map((argument) => describe(argument, 0)).join(" ");
    }

    const rest = args.slice(1);
    let cursor = 0;

    const formatted = first.replace(/%[sdifoOc%]/g, (specifier) => {
      if (specifier === "%%") return "%";
      if (cursor >= rest.length) return specifier;
      const value = rest[cursor++];

      if (specifier === "%s") {
        return typeof value === "string" ? value : toStringSafe(value);
      }
      if (specifier === "%d" || specifier === "%i") {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? "NaN" : String(Math.trunc(parsed));
      }
      if (specifier === "%f") {
        return String(Number(value));
      }
      if (specifier === "%c") return "";
      // %o / %O: object formatting; depth 1 keeps nested strings quoted.
      return describe(value, 1);
    });

    const leftover = rest
      .slice(cursor)
      .map((argument) => describe(argument, 0));
    return [formatted, ...leftover].join(" ");
  };

  const forward = (level: string, args: unknown[]) => {
    // A console patch must never be able to break the page.
    try {
      let text = format(args);
      if (text.length > limit) text = `${text.slice(0, limit)}…`;
      document.dispatchEvent(
        new CustomEvent(state.eventName, {
          detail: JSON.stringify({ level, text }),
        }),
      );
    } catch {
      /* Serialization is best-effort; the original call already ran. */
    }
  };

  (["log", "info", "warn", "error", "debug"] as const).forEach((method) => {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      forward(method, args);
    };
  });

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

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    const request = message as
      | EvaluateRequest
      | InterceptConsoleRequest
      | GetCookiesRequest
      | DeleteCookieRequest
      | RequestCookieAccessRequest;
    if (
      request?.type !== EVALUATE_MESSAGE &&
      request?.type !== INTERCEPT_CONSOLE_MESSAGE &&
      request?.type !== GET_COOKIES_MESSAGE &&
      request?.type !== DELETE_COOKIE_MESSAGE &&
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
      } else {
        sendResponse({ ok: false } satisfies
          | InterceptConsoleResponse
          | DeleteCookieResponse
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
      const host =
        tabUrl && /^https?:/.test(tabUrl) ? new URL(tabUrl).hostname : "";
      const valid =
        typeof request.name === "string" &&
        typeof request.domain === "string" &&
        typeof request.path === "string" &&
        request.path.startsWith("/") &&
        typeof request.secure === "boolean" &&
        host !== "";
      if (!valid) {
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

          const bareDomain = request.domain.replace(/^\./, "");
          const cookieUrl = `${request.secure ? "https" : "http"}://${bareDomain}${request.path}`;
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

    if (request.type === INTERCEPT_CONSOLE_MESSAGE) {
      if (
        typeof request.eventName !== "string" ||
        !isConsoleEventName(request.eventName)
      ) {
        sendResponse({ ok: false } satisfies InterceptConsoleResponse);
        return;
      }

      chrome.scripting
        .executeScript({
          target: { tabId },
          world: "MAIN",
          injectImmediately: true,
          func: installConsoleInterceptor,
          args: [request.eventName, PREVIEW_LIMIT],
        })
        .then(() => {
          sendResponse({ ok: true } satisfies InterceptConsoleResponse);
        })
        .catch(() => {
          sendResponse({ ok: false } satisfies InterceptConsoleResponse);
        });

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
