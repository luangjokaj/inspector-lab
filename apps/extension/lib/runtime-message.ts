/**
 * One way to talk to the background, for every browser the inspector runs in.
 *
 * The promise form of `chrome.runtime.sendMessage` is a Chrome extension to the
 * WebExtensions API. On WebKit-family runtimes — Orion on iOS and iPadOS, where
 * the inspector is the only DevTools a user has — the `chrome.*` namespace is
 * callback-based, so `await chrome.runtime.sendMessage(request)` resolves to
 * `undefined` and the reply is dropped even though the background received the
 * message and answered it. The callback form works everywhere, so it is the one
 * this module uses; a returned thenable is honored too, in case a runtime
 * ignores the callback and answers the Chrome way instead.
 *
 * Failures carry their reason. Every caller used to collapse them into a single
 * "lost its connection" line, which on a tablet with no console left nothing to
 * debug with.
 */

import {
  FETCH_SOURCE_MESSAGE,
  GET_COOKIES_MESSAGE,
  GET_NETWORK_DETAILS_MESSAGE,
  INTERCEPT_CONSOLE_MESSAGE,
  INTERCEPT_NETWORK_MESSAGE,
  PING_MESSAGE,
  REQUEST_COOKIE_ACCESS_MESSAGE,
  TRACK_INSPECTOR_MESSAGE,
} from "~lib/messages";

/** How a send failed, in words the panels can show verbatim. */
export class RuntimeMessageError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "RuntimeMessageError";
  }
}

const RUNTIME_UNAVAILABLE = "the extension link is gone";
const NO_RESPONSE = "the background did not respond";
const TIMED_OUT = "the background did not answer in time";

/**
 * True when the extension link itself is gone rather than merely unanswered —
 * the shape a content script is left in when the extension is reloaded or
 * updated underneath it. Worth distinguishing: relaunching fixes this one, and
 * no fallback can restore what the background alone can do.
 */
export function isRuntimeGone(error: unknown): boolean {
  if (!(error instanceof RuntimeMessageError)) return false;
  return (
    error.reason === RUNTIME_UNAVAILABLE ||
    /extension context invalidated|context invalidated/i.test(error.reason)
  );
}

/**
 * Reasons that prove the message was never delivered. Only these are worth a
 * retry: "message port closed" and a timeout both mean the background did
 * receive the message and only the reply went missing, so retrying would run a
 * cookie write or deletion a second time.
 */
function wasNeverDelivered(reason: string): boolean {
  return (
    reason === RUNTIME_UNAVAILABLE ||
    /receiving end does not exist|could not establish connection/i.test(reason)
  );
}

export type SendOptions = {
  /**
   * Milliseconds to wait before giving up, or `null` to wait indefinitely.
   * A timeout keeps a runtime that never calls back from leaving a spinner up
   * forever, but it must never cancel a message that is waiting on a person:
   * the cookie-access prompt blocks on the browser's own permission dialog.
   */
  timeoutMs?: number | null;
  /**
   * Safe to send twice. Read-only messages set this; anything that mutates
   * cookies leaves it false so a lost reply is reported instead of re-applied.
   */
  retryable?: boolean;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 250;

/**
 * Which messages may be sent a second time, kept in one place rather than at
 * nine call sites. Everything here either reads, or writes state that is the
 * same after one send as after two: tracking a tab, or installing a hook that
 * checks for itself first.
 *
 * Deliberately absent: EVALUATE (an arbitrary expression may have side
 * effects), and the cookie writes DELETE / SET / CLEAR_SITE, where a repeat
 * could delete a cookie the user recreated in between, or re-run the rename
 * path that removes the original before writing its replacement.
 */
const RETRYABLE_MESSAGES = new Set<string>([
  GET_COOKIES_MESSAGE,
  GET_NETWORK_DETAILS_MESSAGE,
  FETCH_SOURCE_MESSAGE,
  INTERCEPT_CONSOLE_MESSAGE,
  INTERCEPT_NETWORK_MESSAGE,
  PING_MESSAGE,
  TRACK_INSPECTOR_MESSAGE,
]);

/** Per-message deadlines; anything unlisted takes DEFAULT_TIMEOUT_MS. */
const TIMEOUTS: Record<string, number | null> = {
  // Waits on a person deciding in the browser's own permission dialog.
  [REQUEST_COOKIE_ACCESS_MESSAGE]: null,
  // A cold cross-origin fetch of a large source file.
  [FETCH_SOURCE_MESSAGE]: 30_000,
};

function policyFor(type: unknown): Required<SendOptions> {
  const name = typeof type === "string" ? type : "";
  return {
    timeoutMs: name in TIMEOUTS ? TIMEOUTS[name] : DEFAULT_TIMEOUT_MS,
    retryable: RETRYABLE_MESSAGES.has(name),
  };
}

type SendMessageFn = (
  message: unknown,
  callback?: (response: unknown) => void,
) => unknown;

/**
 * The messaging entry point this runtime actually implements. Firefox and
 * WebKit expose the promise-native API on `browser`, so it is the better target
 * when `chrome.runtime.sendMessage` is missing entirely.
 */
function resolveSender(): {
  send: SendMessageFn;
  lastError: () => string;
} | null {
  const scope = globalThis as typeof globalThis & {
    chrome?: typeof chrome;
    browser?: typeof chrome;
  };

  for (const namespace of [scope.chrome, scope.browser]) {
    try {
      const runtime = namespace?.runtime;
      // `runtime.id` is undefined once the extension has been reloaded out
      // from under this content script.
      if (typeof runtime?.sendMessage !== "function" || !runtime.id) continue;
      return {
        send: runtime.sendMessage.bind(runtime) as SendMessageFn,
        lastError: () => runtime.lastError?.message ?? "",
      };
    } catch {
      /* Namespace absent or throwing on access: try the next one. */
    }
  }
  return null;
}

/** One attempt, resolving on whichever of callback or promise settles first. */
function sendOnce<TResponse>(
  request: unknown,
  timeoutMs: number | null,
): Promise<TResponse> {
  const sender = resolveSender();
  if (!sender) {
    return Promise.reject(new RuntimeMessageError(RUNTIME_UNAVAILABLE));
  }

  return new Promise<TResponse>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      run();
    };

    const accept = (response: unknown) => {
      // An undefined response is not a value here: every handler in the
      // background answers with an object, so undefined means the reply was
      // lost on the way back.
      if (response === undefined || response === null) {
        finish(() => reject(new RuntimeMessageError(NO_RESPONSE)));
        return;
      }
      finish(() => resolve(response as TResponse));
    };

    if (timeoutMs !== null) {
      timer = setTimeout(
        () => finish(() => reject(new RuntimeMessageError(TIMED_OUT))),
        timeoutMs,
      );
    }

    try {
      const returned = sender.send(request, (response) => {
        // Reading lastError is what marks it handled; leaving it unread logs
        // an "Unchecked runtime.lastError" warning in Chrome.
        const message = sender.lastError();
        if (message) {
          finish(() => reject(new RuntimeMessageError(message)));
          return;
        }
        accept(response);
      });

      // A runtime that ignores the callback and answers with a promise (the
      // Chrome-style API on a namespace that only implements that half).
      if (typeof (returned as Promise<unknown>)?.then === "function") {
        (returned as Promise<unknown>).then(accept, (error: unknown) =>
          finish(() =>
            reject(
              new RuntimeMessageError(
                error instanceof Error ? error.message : NO_RESPONSE,
              ),
            ),
          ),
        );
      }
    } catch (error) {
      // A runtime that has gone away throws synchronously instead of
      // rejecting, which no `.catch()` would ever see.
      finish(() =>
        reject(
          new RuntimeMessageError(
            error instanceof Error ? error.message : RUNTIME_UNAVAILABLE,
          ),
        ),
      );
    }
  });
}

/**
 * Sends `request` to the background and resolves with its response, or rejects
 * with a {@link RuntimeMessageError} naming the reason. Timeout and retry
 * policy come from the request's own `type` (see {@link policyFor}).
 *
 * Retryable messages get one more attempt when the first proves the message was
 * never delivered, which is the standard mitigation for a background that was
 * suspended and had to be woken.
 */
export async function sendRuntimeMessage<TResponse>(
  request: { type: string },
  options: SendOptions = {},
): Promise<TResponse> {
  const policy = policyFor(request?.type);
  const timeoutMs =
    options.timeoutMs === undefined ? policy.timeoutMs : options.timeoutMs;
  const retryable = options.retryable ?? policy.retryable;

  try {
    return await sendOnce<TResponse>(request, timeoutMs);
  } catch (error) {
    const reason =
      error instanceof RuntimeMessageError ? error.reason : String(error);
    if (!retryable || !wasNeverDelivered(reason)) throw error;

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return sendOnce<TResponse>(request, timeoutMs);
  }
}

/**
 * The reason text a panel shows, phrased for someone who cannot open a console
 * to look further. Falls back to a generic line for non-messaging errors.
 */
export function describeSendFailure(error: unknown): string {
  if (isRuntimeGone(error)) {
    return "The extension was reloaded since this inspector opened. Relaunch it from the toolbar popup.";
  }
  if (error instanceof RuntimeMessageError) {
    return `Could not reach the extension background (${error.reason}).`;
  }
  return "Could not reach the extension background.";
}
