/**
 * Everything the background normally does inside the page's MAIN world, done
 * from the page itself instead.
 *
 * The background reaches the MAIN world through chrome.scripting: it installs
 * the console and network hooks there, and evaluates console input there. Where
 * that route is unavailable — a background that never answers, an extension
 * runtime that has gone away, or a browser whose chrome.scripting cannot target
 * the MAIN world at all, which is the case that makes the inspector the only
 * DevTools an iPad has — this file is loaded as an ordinary page script by
 * ~lib/page-bridge-client and provides the same three services over DOM events.
 *
 * It is a page script, so it must never be able to break the page, and it holds
 * no extension privileges: evaluation here has exactly the authority the page
 * already has. What it cannot do is bypass the page's own Content Security
 * Policy, which chrome.scripting can; the client reports that when it happens.
 *
 * Importing the prehooks for their side effects inlines them into this bundle.
 * Both guard against a second installation, so this is a no-op when the
 * document_start registration or an earlier launch already ran them.
 */
import "~injected/console-prehook";
import "~injected/network-prehook";
import { evaluateInPage } from "~injected/page-eval";
import {
  BRIDGE_ELEMENT_ID,
  type PageBridgeConfig,
  type PageBridgeConnectRequest,
  type PageBridgeEvalRequest,
} from "~lib/page-bridge-protocol";

(() => {
  type HookState = { eventName: string | null; buffer: string[] };

  /**
   * Config travels on the script element's dataset because a page script has
   * no other channel to be configured through. The element is removed by the
   * client as soon as this file has run.
   */
  const readConfig = (): PageBridgeConfig | null => {
    try {
      // currentScript is the element during synchronous execution; the id
      // lookup covers a bundler that ever defers this file instead.
      const script = (document.currentScript ??
        document.getElementById(BRIDGE_ELEMENT_ID)) as HTMLScriptElement | null;
      const raw = script?.dataset.inspectorLabBridge;
      return raw ? (JSON.parse(raw) as PageBridgeConfig) : null;
    } catch {
      return null;
    }
  };

  /**
   * Points an installed hook at a channel and replays what it buffered while
   * unconnected, mirroring connectConsoleHook / connectNetworkHook in
   * background.ts. Does nothing when the hook is not installed, which means the
   * page realm rejected the prehook import above.
   */
  const connect = (key: string, eventName: string): void => {
    const holder = window as unknown as Record<string, unknown>;
    const state = holder[key] as HookState | undefined;
    if (!state) return;

    state.eventName = eventName;
    const pending = Array.isArray(state.buffer) ? state.buffer.splice(0) : [];
    for (const detail of pending) {
      document.dispatchEvent(new CustomEvent(eventName, { detail }));
    }
  };

  const config = readConfig();
  if (!config) return;

  document.addEventListener(config.connectEvent, (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== "string") return;

    let request: PageBridgeConnectRequest;
    try {
      request = JSON.parse(detail) as PageBridgeConnectRequest;
    } catch {
      return;
    }
    if (typeof request?.eventName !== "string") return;

    connect(
      request.hook === "network"
        ? "__inspectorLabNetworkHook"
        : "__inspectorLabConsoleHook",
      request.eventName,
    );
  });

  document.addEventListener(config.evalRequestEvent, (event: Event) => {
    // Details cross the isolated/main world boundary as JSON strings, the way
    // the prehooks already send theirs.
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== "string") return;

    let request: PageBridgeEvalRequest;
    try {
      request = JSON.parse(detail) as PageBridgeEvalRequest;
    } catch {
      return;
    }
    if (typeof request?.id !== "string") return;

    const response = evaluateInPage(
      String(request.expression ?? ""),
      typeof request.limit === "number" ? request.limit : 2000,
    );
    document.dispatchEvent(
      new CustomEvent(config.evalReplyEvent, {
        detail: JSON.stringify({ id: request.id, response }),
      }),
    );
  });

  document.dispatchEvent(new CustomEvent(config.readyEvent));
})();
