import {
  CLEAR_SITE_COOKIES_MESSAGE,
  DELETE_COOKIE_MESSAGE,
  EVALUATE_MESSAGE,
  GET_COOKIES_MESSAGE,
  INTERCEPT_CONSOLE_MESSAGE,
  REQUEST_COOKIE_ACCESS_MESSAGE,
  SET_COOKIE_MESSAGE,
  isConsoleEventName,
  type ClearSiteCookiesRequest,
  type ClearSiteCookiesResponse,
  type CookieDraft,
  type CookieEntry,
  type CookieIdentity,
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
  type SetCookieRequest,
  type SetCookieResponse,
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
      | RequestCookieAccessRequest;
    if (
      request?.type !== EVALUATE_MESSAGE &&
      request?.type !== INTERCEPT_CONSOLE_MESSAGE &&
      request?.type !== GET_COOKIES_MESSAGE &&
      request?.type !== DELETE_COOKIE_MESSAGE &&
      request?.type !== SET_COOKIE_MESSAGE &&
      request?.type !== CLEAR_SITE_COOKIES_MESSAGE &&
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
          | SetCookieResponse
          | ClearSiteCookiesResponse
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
