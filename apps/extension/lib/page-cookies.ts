/**
 * The Cookies panel, served from the page instead of the cookie store.
 *
 * chrome.cookies lives in the background and needs a host grant; where that is
 * unreachable, `document.cookie` still answers, and a content script shares the
 * page's cookie jar so nothing has to cross a realm to read it. This is a
 * strictly smaller view, and the panel says so rather than dressing it up:
 *
 * - HttpOnly cookies are invisible here. That is the whole point of the flag,
 *   and it means a session cookie the user is looking for may simply not be
 *   listed.
 * - `document.cookie` returns names and values only. Domain, path, expiry and
 *   the flags are unknown, so entries are marked `partial` and the panel leaves
 *   those columns blank instead of printing a default it cannot vouch for.
 *
 * Nothing here widens access: it reads exactly what the page's own scripts can
 * already read, and writes exactly what they could already write.
 */
import type { CookieDraft, CookieEntry } from "~lib/messages";

/** RFC 6265 token characters — the only bytes legal in a cookie name. */
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]*$/;

const SAME_SITE_ATTRIBUTE: Record<CookieEntry["sameSite"], string> = {
  no_restriction: "None",
  lax: "Lax",
  strict: "Strict",
  unspecified: "",
};

/**
 * Every cookie the page can see, as far as `document.cookie` reveals it.
 * Values stay percent-encoded exactly as stored, matching what chrome.cookies
 * returns for the same cookie.
 */
export function readPageCookies(): CookieEntry[] {
  const raw = document.cookie;
  if (!raw) return [];

  return raw
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const separator = pair.indexOf("=");
      // A cookie stored with an empty name serializes as its bare value.
      const name = separator === -1 ? "" : pair.slice(0, separator);
      const value = separator === -1 ? pair : pair.slice(separator + 1);
      return {
        name,
        value,
        domain: location.hostname,
        path: "",
        httpOnly: false,
        secure: false,
        sameSite: "unspecified" as const,
        partial: true,
      };
    });
}

/** Rejects what the page realm cannot express, with messages to show as-is. */
function validate(draft: CookieDraft): string | null {
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
  if (draft.httpOnly) {
    return "HttpOnly cannot be set from the page. That needs the extension background, which is unreachable here.";
  }
  if (draft.sameSite === "no_restriction" && !draft.secure) {
    return "SameSite=None cookies must also be Secure.";
  }
  return null;
}

/** One `document.cookie` assignment string for `draft`. */
function serialize(draft: CookieDraft, expires?: string): string {
  const parts = [`${draft.name}=${draft.value}`];
  parts.push(`path=${draft.path || "/"}`);

  // A leading dot means a domain cookie. Anything else is left host-only:
  // the browser scopes it to the current host on its own, and naming a host
  // the page is not on would simply be dropped.
  if (draft.domain.startsWith(".")) {
    parts.push(`domain=${draft.domain}`);
  }
  if (expires !== undefined) {
    parts.push(`expires=${expires}`);
  } else if (draft.expirationDate !== undefined) {
    parts.push(
      `expires=${new Date(draft.expirationDate * 1000).toUTCString()}`,
    );
  }
  if (draft.secure) parts.push("secure");

  const sameSite = SAME_SITE_ATTRIBUTE[draft.sameSite];
  if (sameSite) parts.push(`samesite=${sameSite}`);

  return parts.join("; ");
}

function hasCookie(name: string, value?: string): boolean {
  return readPageCookies().some(
    (cookie) =>
      cookie.name === name && (value === undefined || cookie.value === value),
  );
}

/**
 * How many cookies of this name the page can see. More than one means the same
 * name exists at different paths or domains, which is the one thing that makes
 * an edit from here ambiguous: `document.cookie` never says which path a cookie
 * came from, so a write lands wherever the assignment says rather than on the
 * row the user clicked.
 */
function countCookies(name: string): number {
  return readPageCookies().filter((cookie) => cookie.name === name).length;
}

export type PageCookieResult = { ok: boolean; error?: string };

/**
 * Creates or rewrites a cookie. When the edit renames it, the original is
 * removed first, and restored if writing the replacement does not take.
 */
export function writePageCookie(
  originalName: string | null,
  next: CookieDraft,
): PageCookieResult {
  const invalid = validate(next);
  if (invalid) return { ok: false, error: invalid };

  const renamed = originalName !== null && originalName !== next.name;
  const previous = renamed
    ? readPageCookies().find((cookie) => cookie.name === originalName)
    : undefined;
  const before = countCookies(next.name);

  try {
    if (previous) expire(previous.name, "");
    document.cookie = serialize(next);

    // The browser drops a cookie it dislikes without saying so; the only way
    // to know a write took is to read it back.
    if (!hasCookie(next.name, next.value)) {
      if (previous) document.cookie = serialize(toDraft(previous));
      return {
        ok: false,
        error:
          "The page refused the cookie. A Secure cookie needs an https page, and a domain outside this site cannot be set from here.",
      };
    }

    // Editing an existing cookie should replace it, not add a second one.
    // A duplicate means the original lives at a path this page cannot name,
    // so the edit went somewhere the user did not ask for: undo it and say so
    // rather than leaving two cookies where the panel shows one change.
    if (!renamed && originalName !== null && countCookies(next.name) > before) {
      expire(next.name, next.path || "/");
      return {
        ok: false,
        error:
          "This cookie is scoped to a path the page cannot address, so editing it here would have created a second cookie instead. Relaunch the inspector to edit it through the extension.",
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Could not save the cookie: ${error.message}`
          : "Could not save the cookie.",
    };
  }
}

/** Backdates a cookie so the browser drops it. */
function expire(name: string, path: string): void {
  const stamp = "Thu, 01 Jan 1970 00:00:01 GMT";
  const paths = new Set([path || "/", "/", location.pathname]);
  for (const candidate of paths) {
    if (!candidate) continue;
    document.cookie = `${name}=; path=${candidate}; expires=${stamp}`;
    // Also try the registrable-domain form, which is how a cookie set by a
    // parent domain has to be removed.
    document.cookie = `${name}=; path=${candidate}; domain=.${location.hostname}; expires=${stamp}`;
  }
}

export function deletePageCookie(cookie: CookieEntry): PageCookieResult {
  try {
    expire(cookie.name, cookie.path);
    if (hasCookie(cookie.name)) {
      return {
        ok: false,
        error:
          "The cookie survived deletion from the page. It is likely scoped to a path or domain that only the extension background can address.",
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Could not delete the cookie: ${error.message}`
          : "Could not delete the cookie.",
    };
  }
}

/** Deletes every cookie the page can see. HttpOnly ones are not among them. */
export function clearPageCookies(): { ok: boolean; removed: number } {
  const before = readPageCookies();
  for (const cookie of before) expire(cookie.name, cookie.path);
  const after = readPageCookies();
  return { ok: true, removed: before.length - after.length };
}

function toDraft(cookie: CookieEntry): CookieDraft {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expirationDate: cookie.expirationDate,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
  };
}
