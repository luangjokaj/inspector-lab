/**
 * Network interceptor for the page's MAIN world. Wraps fetch and
 * XMLHttpRequest so every JS-initiated request is captured with method, URL,
 * request/response headers, status, timing, and capped bodies — the details
 * DevTools shows — and either dispatched as a CustomEvent (once the inspector
 * connects a channel) or buffered for replay, mirroring console-prehook.ts.
 *
 * Each request emits phased payloads (`start` → `response` → `body`, or
 * `error`) that the inspector reduces by id, so slow bodies never delay rows.
 *
 * Runs in the page's world: fully self-contained, idempotent, and it must
 * never break the page — every capture path is wrapped, and the original
 * call always proceeds. One observable caveat, noted for honesty: attaching
 * our completion handlers marks the page's own fetch promise as handled, so
 * a page that ignores a rejected fetch won't fire unhandledrejection.
 */

export type NetworkHookState = {
  eventName: string | null;
  buffer: string[];
};

(() => {
  const BUFFER_LIMIT = 300;
  const BODY_LIMIT = 20000;
  const HEADER_LIMIT = 100;
  const HEADER_VALUE_LIMIT = 2000;
  const BODY_READ_TIMEOUT = 5000;

  const holder = window as Window & {
    __inspectorLabNetworkHook?: NetworkHookState;
  };
  if (holder.__inspectorLabNetworkHook) return;

  const state: NetworkHookState = { eventName: null, buffer: [] };
  holder.__inspectorLabNetworkHook = state;

  let sequence = 0;
  const nextId = () => `net-${Date.now().toString(36)}-${(sequence += 1)}`;

  const clip = (value: string, limit: number): string =>
    value.length > limit ? value.slice(0, limit) : value;

  const emit = (entry: Record<string, unknown>) => {
    try {
      const payload = JSON.stringify(entry);
      if (state.eventName) {
        document.dispatchEvent(
          new CustomEvent(state.eventName, { detail: payload }),
        );
      } else if (state.buffer.length < BUFFER_LIMIT) {
        state.buffer.push(payload);
      }
    } catch {
      /* Capture is best-effort; the request itself already ran. */
    }
  };

  const headerPairs = (headers: Headers): [string, string][] => {
    const pairs: [string, string][] = [];
    try {
      headers.forEach((value, name) => {
        if (pairs.length < HEADER_LIMIT) {
          pairs.push([name, clip(value, HEADER_VALUE_LIMIT)]);
        }
      });
    } catch {
      /* ignore */
    }
    return pairs;
  };

  const initHeaderPairs = (init?: HeadersInit): [string, string][] => {
    try {
      return headerPairs(new Headers(init));
    } catch {
      return [];
    }
  };

  const describeBody = (
    body: unknown,
  ): { text: string | null; truncated: boolean } => {
    try {
      if (body === undefined || body === null) {
        return { text: null, truncated: false };
      }
      if (typeof body === "string") {
        return {
          text: clip(body, BODY_LIMIT),
          truncated: body.length > BODY_LIMIT,
        };
      }
      if (body instanceof URLSearchParams) {
        const text = body.toString();
        return {
          text: clip(text, BODY_LIMIT),
          truncated: text.length > BODY_LIMIT,
        };
      }
      if (body instanceof FormData)
        return { text: "(form data)", truncated: false };
      if (body instanceof Blob) {
        return { text: `(binary blob, ${body.size} bytes)`, truncated: false };
      }
      if (body instanceof ArrayBuffer) {
        return { text: `(binary, ${body.byteLength} bytes)`, truncated: false };
      }
      return { text: "(stream or non-text body)", truncated: false };
    } catch {
      return { text: null, truncated: false };
    }
  };

  /**
   * Reads up to BODY_LIMIT chars of a cloned response. Capped AND time-boxed
   * so streams that trickle forever (SSE, long polls) can never hold the
   * reader open — the timer cancels the stream and we keep what arrived.
   */
  const readResponseBody = async (
    response: Response,
  ): Promise<{ text: string | null; truncated: boolean }> => {
    try {
      const reader = response.body?.getReader();
      if (!reader) return { text: null, truncated: false };

      const decoder = new TextDecoder();
      let text = "";
      let truncated = false;
      const timer = setTimeout(() => {
        truncated = true;
        void reader.cancel().catch(() => undefined);
      }, BODY_READ_TIMEOUT);

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          if (text.length >= BODY_LIMIT) {
            truncated = true;
            await reader.cancel().catch(() => undefined);
            break;
          }
        }
      } finally {
        clearTimeout(timer);
      }
      return { text: clip(text, BODY_LIMIT), truncated };
    } catch {
      return { text: null, truncated: false };
    }
  };

  const skipBodyCapture = (status: number, contentType: string): boolean =>
    status === 204 ||
    status === 304 ||
    /^(image|audio|video|font)\//.test(contentType) ||
    contentType.includes("octet-stream");

  /* ------------------------------------------------------------- fetch */

  const originalFetch = window.fetch.bind(window);
  window.fetch = function wrappedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    const id = nextId();
    const start = performance.now();
    let url = "";
    let method = "GET";
    let requestHeaders: [string, string][] = [];
    let requestBody: { text: string | null; truncated: boolean } = {
      text: null,
      truncated: false,
    };
    try {
      if (typeof input === "string" || input instanceof URL) {
        url = String(input);
      } else {
        url = input.url;
        method = input.method || "GET";
        requestHeaders = headerPairs(input.headers);
      }
      if (init?.method) method = init.method;
      if (init?.headers) requestHeaders = initHeaderPairs(init.headers);
      if (init?.body !== undefined) requestBody = describeBody(init.body);
      url = new URL(url, location.href).href;
      method = method.toUpperCase();
    } catch {
      /* capture only */
    }

    emit({
      id,
      phase: "start",
      source: "fetch",
      url,
      method,
      startTime: start,
      requestHeaders,
      requestBody: requestBody.text,
      requestBodyTruncated: requestBody.truncated,
    });

    const promise = originalFetch(input as RequestInfo, init);
    promise.then(
      (response) => {
        void (async () => {
          try {
            const contentType = response.headers.get("content-type") ?? "";
            emit({
              id,
              phase: "response",
              status: response.status,
              statusText: response.statusText,
              responseHeaders: headerPairs(response.headers),
              contentType,
              duration: performance.now() - start,
            });
            const body = skipBodyCapture(response.status, contentType)
              ? {
                  text: `(${contentType || "empty"} body not captured)`,
                  truncated: false,
                }
              : await readResponseBody(response.clone());
            emit({
              id,
              phase: "body",
              responseBody: body.text,
              responseBodyTruncated: body.truncated,
            });
          } catch {
            /* never break the page */
          }
        })();
      },
      (error) => {
        try {
          emit({
            id,
            phase: "error",
            duration: performance.now() - start,
            error: error instanceof Error ? error.message : String(error),
          });
        } catch {
          /* never break the page */
        }
      },
    );
    return promise;
  };

  /* --------------------------------------------------------------- xhr */

  type XhrMeta = {
    method: string;
    url: string;
    requestHeaders: [string, string][];
  };
  const xhrMeta = new WeakMap<XMLHttpRequest, XhrMeta>();
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSetHeader = proto.setRequestHeader;
  const originalSend = proto.send;

  proto.open = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: [boolean?, (string | null)?, (string | null)?]
  ) {
    try {
      xhrMeta.set(this, {
        method: String(method).toUpperCase(),
        url: new URL(String(url), location.href).href,
        requestHeaders: [],
      });
    } catch {
      /* capture only */
    }
    return originalOpen.call(this, method, url, ...(rest as [boolean]));
  };

  proto.setRequestHeader = function setRequestHeader(
    this: XMLHttpRequest,
    name: string,
    value: string,
  ) {
    try {
      const meta = xhrMeta.get(this);
      if (meta && meta.requestHeaders.length < HEADER_LIMIT) {
        meta.requestHeaders.push([
          name,
          clip(String(value), HEADER_VALUE_LIMIT),
        ]);
      }
    } catch {
      /* capture only */
    }
    return originalSetHeader.call(this, name, value);
  };

  proto.send = function send(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const meta = xhrMeta.get(this);
    if (meta) {
      const id = nextId();
      const start = performance.now();
      try {
        const requestBody = describeBody(body);
        emit({
          id,
          phase: "start",
          source: "xhr",
          url: meta.url,
          method: meta.method,
          startTime: start,
          requestHeaders: meta.requestHeaders,
          requestBody: requestBody.text,
          requestBodyTruncated: requestBody.truncated,
        });
        this.addEventListener("loadend", () => {
          try {
            const duration = performance.now() - start;
            if (this.status === 0) {
              emit({
                id,
                phase: "error",
                duration,
                error: "Request failed (network error or blocked).",
              });
              return;
            }
            const responseHeaders = (this.getAllResponseHeaders() || "")
              .trim()
              .split(/\r?\n/)
              .filter(Boolean)
              .slice(0, HEADER_LIMIT)
              .map((line): [string, string] => {
                const colon = line.indexOf(":");
                return [
                  line.slice(0, colon).trim(),
                  clip(line.slice(colon + 1).trim(), HEADER_VALUE_LIMIT),
                ];
              });
            emit({
              id,
              phase: "response",
              status: this.status,
              statusText: this.statusText,
              responseHeaders,
              contentType: this.getResponseHeader("content-type") ?? "",
              duration,
            });
            let responseBody: string | null;
            let truncated = false;
            if (this.responseType === "" || this.responseType === "text") {
              const text = this.responseText ?? "";
              responseBody = clip(text, BODY_LIMIT);
              truncated = text.length > BODY_LIMIT;
            } else {
              responseBody = `(${this.responseType} response not captured)`;
            }
            emit({
              id,
              phase: "body",
              responseBody,
              responseBodyTruncated: truncated,
            });
          } catch {
            /* never break the page */
          }
        });
      } catch {
        /* never break the page */
      }
    }
    return originalSend.call(this, body);
  };
})();
