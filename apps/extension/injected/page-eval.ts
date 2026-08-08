import type { EvaluateResponse } from "~lib/messages";

/**
 * Evaluates `expression` in whatever realm this function is running in, and
 * returns a plain-text preview, never a live value.
 *
 * Used two ways, which is why it lives in its own file:
 *
 * - the background passes it to chrome.scripting.executeScript as `func`, which
 *   serializes it with Function.prototype.toString() and re-parses it inside
 *   the page's MAIN world;
 * - injected/page-bridge.ts calls it directly, for runtimes where that
 *   injection is unavailable.
 *
 * The serialization is why every helper is declared inside the function body:
 * a reference to anything in module scope would survive `toString()` as a name
 * that does not exist in the page. Nothing here may be hoisted out, however
 * tempting.
 *
 * It evaluates with the same authority page scripts already have — no extension
 * APIs leak in.
 */
export function evaluateInPage(
  expression: string,
  limit: number,
): EvaluateResponse {
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
    // Primitive results carry a tone so the panel can color them by type,
    // the way DevTools renders evaluation results.
    const tone =
      result === null || result === undefined
        ? ("nullish" as const)
        : typeof result === "number" || typeof result === "bigint"
          ? ("number" as const)
          : typeof result === "boolean"
            ? ("boolean" as const)
            : typeof result === "string"
              ? ("string" as const)
              : undefined;
    return {
      ok: true,
      preview: preview.length > limit ? `${preview.slice(0, limit)}…` : preview,
      ...(tone ? { tone } : {}),
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
