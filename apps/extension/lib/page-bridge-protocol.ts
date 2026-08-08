/**
 * The contract between ~injected/page-bridge (page realm) and
 * ~lib/page-bridge-client (the inspector's own realm).
 *
 * Kept in its own module because it has no side effects: importing the bridge
 * itself from the inspector would run its installer in the wrong world.
 */

/** Id the client puts on the script element, and the bridge's fallback handle
 *  on it when `document.currentScript` is unavailable. */
export const BRIDGE_ELEMENT_ID = "inspector-lab-page-bridge";

/** `data-inspector-lab-bridge`, the attribute the config travels on. */
export const BRIDGE_CONFIG_ATTRIBUTE = "data-inspector-lab-bridge";

export type PageBridgeConfig = {
  /** Channel the client asks for a capture hook to be connected on. */
  connectEvent: string;
  /** Channel the client sends evaluation requests on. */
  evalRequestEvent: string;
  /** Channel the bridge answers evaluation requests on. */
  evalReplyEvent: string;
  /** Dispatched once, to tell the client the bridge is live. */
  readyEvent: string;
};

/** Which page hook a connect request is about. */
export type PageBridgeHook = "console" | "network";

/**
 * Connect requests arrive after install rather than as config, because the
 * console and network panels each mint their own channel and each connects
 * whenever its effect runs — which is not necessarily before the bridge loads.
 */
export type PageBridgeConnectRequest = {
  hook: PageBridgeHook;
  eventName: string;
};

/** One evaluation request, JSON-encoded in the CustomEvent detail. */
export type PageBridgeEvalRequest = {
  id: string;
  expression: string;
  limit: number;
};
