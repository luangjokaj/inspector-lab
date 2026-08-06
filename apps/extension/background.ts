import {
  EVALUATE_MESSAGE,
  type EvaluateRequest,
  type EvaluateResponse,
} from "~lib/messages";

const PREVIEW_LIMIT = 2000;

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

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    const request = message as EvaluateRequest;
    if (
      request?.type !== EVALUATE_MESSAGE ||
      typeof request.expression !== "string"
    ) {
      return;
    }

    // Only evaluate in the tab the inspector itself is running in — the tab id
    // comes from the sender, never from the message payload.
    const tabId = sender.tab?.id;
    if (sender.id !== chrome.runtime.id || tabId === undefined) {
      sendResponse({
        ok: false,
        preview: "Evaluation request rejected: unknown sender.",
      } satisfies EvaluateResponse);
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
