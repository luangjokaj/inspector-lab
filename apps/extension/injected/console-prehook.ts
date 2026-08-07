/**
 * Console interceptor for the page's MAIN world. Wraps the console methods so
 * every call is serialized to a plain string payload and either dispatched as
 * a CustomEvent (once the inspector has connected an event channel) or held
 * in a bounded buffer so logs from before the inspector opened — including
 * page boot, when this file is registered as a document_start content
 * script — can be replayed later.
 *
 * Runs in the page's world, so it must be fully self-contained and must never
 * be able to break the page. Idempotent: a second injection is a no-op.
 *
 * The background connects a channel by setting `eventName` on the hook state
 * and flushing `buffer` (see `connectConsoleHook` in background.ts). The
 * event name is an unguessable per-launch token, so page scripts cannot
 * eavesdrop on or spoof the channel.
 */

export type ConsoleHookState = {
  eventName: string | null;
  buffer: string[];
};

(() => {
  /** Serialized-entry cap while unconnected; matches the panel's own cap. */
  const BUFFER_LIMIT = 1000;
  /** Per-entry text cap; matches the background's PREVIEW_LIMIT. */
  const TEXT_LIMIT = 2000;

  const holder = window as Window & {
    __inspectorLabConsoleHook?: ConsoleHookState;
  };
  if (holder.__inspectorLabConsoleHook) return;

  const state: ConsoleHookState = { eventName: null, buffer: [] };
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

  /** DevTools colors primitives by type; one tone tag per top-level arg. */
  const toneOf = (value: unknown): string => {
    if (value === null || value === undefined) return "nullish";
    const type = typeof value;
    if (type === "number" || type === "bigint") return "number";
    if (type === "boolean") return "boolean";
    return "text";
  };

  /**
   * Chrome's format specifiers: they apply only when the first argument is a
   * string, each specifier consumes one following argument, unmatched
   * specifiers stay literal, `%%` escapes, and leftover arguments are
   * appended space-separated. `%c` consumes its CSS argument but styles
   * cannot be rendered in a text-only feed, so it contributes nothing.
   */
  const interpolate = (
    first: string,
    rest: unknown[],
  ): { text: string; consumed: number } => {
    let cursor = 0;

    const text = first.replace(/%[sdifoOc%]/g, (specifier) => {
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

    return { text, consumed: cursor };
  };

  /**
   * One toned part per top-level argument, so the panel can color primitives
   * the way DevTools does. Values interpolated into a format string render
   * inside it as plain text, exactly like Chrome.
   */
  const buildParts = (args: unknown[]): { text: string; tone: string }[] => {
    const first = args[0];
    if (typeof first === "string" && /%[sdifoOc%]/.test(first)) {
      const { text, consumed } = interpolate(first, args.slice(1));
      return [
        { text, tone: "text" },
        ...args.slice(1 + consumed).map((argument) => ({
          text: describe(argument, 0),
          tone: toneOf(argument),
        })),
      ];
    }
    return args.map((argument) => ({
      text: describe(argument, 0),
      tone: toneOf(argument),
    }));
  };

  /**
   * `file:line` of the page frame that called console. Only http(s)/file
   * frames qualify — the wrapper's own frames carry the extension's URL (or
   * none), so the first page-scheme frame is the caller.
   */
  const sourceFrom = (): string | undefined => {
    try {
      const stack = new Error().stack;
      if (!stack) return undefined;
      for (const frame of stack.split("\n")) {
        const match =
          /((?:https?|file):\/\/[^\s()@]+?):(\d+)(?::\d+)?\)?$/.exec(
            frame.trim(),
          );
        if (!match) continue;
        const path = match[1].split("?")[0].split("#")[0];
        const name = path.split("/").filter(Boolean).pop() || path;
        return `${name}:${match[2]}`;
      }
    } catch {
      /* Source attribution is best-effort. */
    }
    return undefined;
  };

  const forward = (level: string, args: unknown[]) => {
    // A console patch must never be able to break the page.
    try {
      const parts = buildParts(args);
      let text = parts.map((part) => part.text).join(" ");
      let toned: { text: string; tone: string }[] | undefined = parts;
      if (text.length > TEXT_LIMIT) {
        // Pathological entries ship truncated and untoned rather than trying
        // to slice tone boundaries.
        text = `${text.slice(0, TEXT_LIMIT)}…`;
        toned = undefined;
      }
      const payload = JSON.stringify({
        level,
        text,
        parts: toned,
        source: sourceFrom(),
      });

      if (state.eventName) {
        document.dispatchEvent(
          new CustomEvent(state.eventName, { detail: payload }),
        );
      } else if (state.buffer.length < BUFFER_LIMIT) {
        state.buffer.push(payload);
      }
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
})();
