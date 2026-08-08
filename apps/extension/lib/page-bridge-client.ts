/**
 * The inspector's side of ~injected/page-bridge: loads that file into the page
 * as an ordinary script and talks to it over DOM events.
 *
 * This is the fallback path. Everything here is also available through the
 * background, which does it better — chrome.scripting reaches the MAIN world
 * without the page's Content Security Policy having a say. This route exists
 * for when the background cannot be reached at all, which on Orion for iOS is
 * the difference between a Console panel that works and one that only
 * apologizes.
 *
 * Both realms belong to the page, so nothing here is a privilege boundary. The
 * random channel names keep incidental page code from stumbling into the
 * inspector's traffic; they are not a defense against a page that deliberately
 * instruments its own DOM, which could always observe or forge what the page
 * realm sends. Nothing the bridge returns is treated as more than text.
 */
import bridgeSource from "bundle-text:../injected/page-bridge.ts";
import { randomChannelToken } from "~lib/messages";
import {
  BRIDGE_CONFIG_ATTRIBUTE,
  BRIDGE_ELEMENT_ID,
  type PageBridgeConfig,
  type PageBridgeConnectRequest,
  type PageBridgeEvalRequest,
  type PageBridgeHook,
} from "~lib/page-bridge-protocol";
import type { EvaluateResponse } from "~lib/messages";

/** How long to wait for the script to load and answer its ready event. */
const INSTALL_TIMEOUT_MS = 5_000;
/** How long to wait for one evaluation to come back. */
const EVAL_TIMEOUT_MS = 10_000;

export type PageBridge = {
  evaluate: (expression: string, limit: number) => Promise<EvaluateResponse>;
  /** Points a page capture hook at `eventName` and flushes what it buffered. */
  connect: (hook: PageBridgeHook, eventName: string) => void;
};

/** Why an install failed, phrased for someone who cannot open a console. */
export class PageBridgeError extends Error {}

const CSP_BLOCKED =
  "This browser or this site's Content Security Policy blocks the in-page fallback, and the extension background is unreachable. Browser DevTools can bypass CSP; an in-page inspector cannot.";

let installed: Promise<PageBridge> | null = null;

/**
 * Loads the bridge once per page and resolves with its client. Repeat calls
 * return the same promise, including a failed one: a page whose CSP rejected
 * the script will reject it again, and retrying per keystroke would only add
 * console noise to the page the user is debugging.
 */
export function installPageBridge(): Promise<PageBridge> {
  installed ??= install();
  return installed;
}

function install(): Promise<PageBridge> {
  const config: PageBridgeConfig = {
    connectEvent: `inspector-lab-bridge-connect:${randomChannelToken()}`,
    evalRequestEvent: `inspector-lab-eval-request:${randomChannelToken()}`,
    evalReplyEvent: `inspector-lab-eval-reply:${randomChannelToken()}`,
    readyEvent: `inspector-lab-bridge-ready:${randomChannelToken()}`,
  };

  return new Promise<PageBridge>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener(config.readyEvent, onReady);
      document.removeEventListener("securitypolicyviolation", onViolation);
      // Leaving 12 KB of source in the page would be rude, and by now the
      // bridge has either run or been refused.
      script.remove();
      run();
    };

    function onReady() {
      finish(() => resolve(makeClient(config)));
    }

    // A page CSP that forbids inline scripts blocks this silently, but it
    // reports itself first: fail on the violation rather than on the timeout,
    // so the console says why instead of just stalling for five seconds.
    function onViolation(event: SecurityPolicyViolationEvent) {
      if (event.violatedDirective.startsWith("script-src")) {
        finish(() => reject(new PageBridgeError(CSP_BLOCKED)));
      }
    }

    document.addEventListener(config.readyEvent, onReady, { once: true });
    document.addEventListener("securitypolicyviolation", onViolation);

    const script = document.createElement("script");
    script.id = BRIDGE_ELEMENT_ID;
    script.setAttribute(BRIDGE_CONFIG_ATTRIBUTE, JSON.stringify(config));
    // The source travels inside this bundle rather than being fetched from an
    // extension URL. A content script injected with chrome.scripting cannot
    // resolve those addresses at runtime, and inlining also keeps the bridge
    // working when the extension runtime has gone away entirely — the case
    // where it is needed most.
    script.textContent = bridgeSource;

    timer = setTimeout(
      () => finish(() => reject(new PageBridgeError(CSP_BLOCKED))),
      INSTALL_TIMEOUT_MS,
    );

    try {
      // An inline script runs synchronously on insertion, so the ready event
      // has already fired by the time this returns — unless the page refused
      // it, which the violation handler or the timeout picks up.
      (document.head ?? document.documentElement).appendChild(script);
    } catch {
      finish(() => reject(new PageBridgeError(CSP_BLOCKED)));
    }
  });
}

function makeClient(config: PageBridgeConfig): PageBridge {
  let nextId = 0;

  return {
    connect(hook, eventName) {
      const request: PageBridgeConnectRequest = { hook, eventName };
      document.dispatchEvent(
        new CustomEvent(config.connectEvent, {
          detail: JSON.stringify(request),
        }),
      );
    },

    evaluate(expression, limit) {
      const id = `${nextId++}`;

      return new Promise<EvaluateResponse>((resolve) => {
        let settled = false;

        const onReply = (event: Event) => {
          const detail = (event as CustomEvent<unknown>).detail;
          if (typeof detail !== "string") return;

          let payload: { id?: string; response?: EvaluateResponse };
          try {
            payload = JSON.parse(detail) as typeof payload;
          } catch {
            return;
          }
          if (payload?.id !== id) return;

          settled = true;
          document.removeEventListener(config.evalReplyEvent, onReply);
          clearTimeout(timer);
          resolve(
            payload.response && typeof payload.response.preview === "string"
              ? payload.response
              : { ok: false, preview: "The page did not return a result." },
          );
        };

        const timer = setTimeout(() => {
          if (settled) return;
          document.removeEventListener(config.evalReplyEvent, onReply);
          resolve({
            ok: false,
            preview: "The page did not answer in time.",
          });
        }, EVAL_TIMEOUT_MS);

        document.addEventListener(config.evalReplyEvent, onReply);

        const request: PageBridgeEvalRequest = { id, expression, limit };
        document.dispatchEvent(
          new CustomEvent(config.evalRequestEvent, {
            detail: JSON.stringify(request),
          }),
        );
      });
    },
  };
}
