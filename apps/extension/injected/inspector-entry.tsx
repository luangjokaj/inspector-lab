import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import styled, {
  StyleSheetManager,
  ThemeProvider,
  css,
  useTheme,
} from "styled-components";
import { Icon, IconButton } from "cherry-styled-components";
import { resolveInspectorTheme } from "~lib/theme";
import {
  readColorSchemeSetting,
  readCustomThemeSetting,
  watchColorSchemeSetting,
  watchCustomThemeSetting,
  type InspectorColorScheme,
} from "~lib/settings";
import {
  InspectorWindow,
  PanelHost,
  Tab,
  TabStrip,
  ToolbarControls,
  ToolbarDivider,
  ToolbarSpacer,
  WindowToolbar,
} from "~injected/devtools.styled";
import {
  HIGHLIGHT_ID,
  HOST_ID,
  SHOW_EVENT,
  describeElement,
  highlightElement,
  isInspectorNode,
  snapshotElement,
  type ElementSnapshot,
  type MatchedRule,
} from "~injected/inspector-dom";
import {
  applyStateStyles,
  clearStateStyles,
  emptyStateStyles,
  noStatesForced,
  type ForcedStateMap,
  type PseudoState,
  type StateStyleMap,
} from "~injected/state-styles";
import {
  CLEAR_SITE_COOKIES_MESSAGE,
  DELETE_COOKIE_MESSAGE,
  EVALUATE_MESSAGE,
  GET_COOKIES_MESSAGE,
  GET_NETWORK_DETAILS_MESSAGE,
  INTERCEPT_CONSOLE_MESSAGE,
  INTERCEPT_NETWORK_MESSAGE,
  REQUEST_COOKIE_ACCESS_MESSAGE,
  SET_COOKIE_MESSAGE,
  TRACK_INSPECTOR_MESSAGE,
  randomConsoleEventName,
  randomNetworkEventName,
  type CapturedConsolePayload,
  type CapturedNetworkRequest,
  type ClearSiteCookiesRequest,
  type ClearSiteCookiesResponse,
  type CookieDraft,
  type CookieEntry,
  type CookieScope,
  type DeleteCookieRequest,
  type DeleteCookieResponse,
  type EvaluateRequest,
  type EvaluateResponse,
  type GetCookiesRequest,
  type GetCookiesResponse,
  type GetNetworkDetailsRequest,
  type GetNetworkDetailsResponse,
  type InterceptConsoleRequest,
  type InterceptConsoleResponse,
  type InterceptNetworkRequest,
  type InterceptNetworkResponse,
  type NetworkCapturePhase,
  type RequestCookieAccessRequest,
  type RequestCookieAccessResponse,
  type SetCookieRequest,
  type SetCookieResponse,
  type TrackInspectorRequest,
  type TrackInspectorResponse,
  type WebRequestEntry,
} from "~lib/messages";
import { ElementsPanel } from "~injected/panels/elements-panel";
import {
  ConsolePanel,
  type ConsoleEntry,
  type ConsoleLevel,
} from "~injected/panels/console-panel";
import {
  SourcesPanel,
  type SourceRevealRequest,
} from "~injected/panels/sources-panel";
import { NetworkPanel } from "~injected/panels/network-panel";
import { CookiesPanel } from "~injected/panels/cookies-panel";
import { StoragePanel } from "~injected/panels/storage-panel";

const MIN_WIDTH = 480;
const MIN_HEIGHT = 320;
const VIEWPORT_GUTTER = 12;
/** Oldest console entries are dropped past this point, as DevTools also caps. */
const MAX_CONSOLE_ENTRIES = 1000;

const MIN_DOCK_WIDTH = 320;
const MIN_DOCK_HEIGHT = 160;
/** Room always left for the page when the inspector is docked to an edge. */
const DOCK_VIEWPORT_MARGIN = 48;

/** Where the window sits: pinned to a viewport edge, or free-floating. */
type DockSide = "floating" | "bottom" | "left" | "right";
/** Compass edge/corner being dragged while resizing the floating window. */
type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Tab order matches Chrome DevTools: Elements is always first. */
const TABS = [
  "Elements",
  "Console",
  "Sources",
  "Network",
  "Cookies",
  "Storage",
] as const;
type TabName = (typeof TABS)[number];

type Frame = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const ResizeHandle = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  touch-action: none;

  &::after {
    content: "";
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 7px;
    height: 7px;
    border-right: solid 1px ${({ theme }) => theme.devtools.textSubtle};
    border-bottom: solid 1px ${({ theme }) => theme.devtools.textSubtle};
  }

  &:focus-visible {
    outline: solid 1px ${({ theme }) => theme.devtools.focusRing};
    outline-offset: -1px;
  }
`;

/** Hit area for one edge or corner of the floating window. */
const edgeStyle = (direction: ResizeDirection) => {
  switch (direction) {
    case "n":
      return css`
        top: 0;
        right: 10px;
        left: 10px;
        height: 6px;
        cursor: ns-resize;
      `;
    case "s":
      return css`
        right: 10px;
        bottom: 0;
        left: 10px;
        height: 6px;
        cursor: ns-resize;
      `;
    case "e":
      return css`
        top: 10px;
        right: 0;
        bottom: 10px;
        width: 6px;
        cursor: ew-resize;
      `;
    case "w":
      return css`
        top: 10px;
        bottom: 10px;
        left: 0;
        width: 6px;
        cursor: ew-resize;
      `;
    case "ne":
      return css`
        top: 0;
        right: 0;
        width: 12px;
        height: 12px;
        cursor: nesw-resize;
      `;
    case "nw":
      return css`
        top: 0;
        left: 0;
        width: 12px;
        height: 12px;
        cursor: nwse-resize;
      `;
    case "sw":
      return css`
        bottom: 0;
        left: 0;
        width: 12px;
        height: 12px;
        cursor: nesw-resize;
      `;
    case "se":
      return css`
        right: 0;
        bottom: 0;
        width: 16px;
        height: 16px;
        cursor: nwse-resize;
      `;
  }
};

/** Invisible strips along the floating window's edges and corners. */
const FloatResizeHandle = styled.div<{ $direction: ResizeDirection }>`
  position: absolute;
  z-index: 2;
  touch-action: none;
  ${({ $direction }) => edgeStyle($direction)};
`;

/** The split-drag strip along a docked window's page-facing edge. */
const DockResizer = styled.div<{ $side: "bottom" | "left" | "right" }>`
  position: absolute;
  z-index: 2;
  touch-action: none;
  ${({ $side }) =>
    $side === "bottom"
      ? css`
          top: 0;
          right: 0;
          left: 0;
          height: 5px;
          cursor: ns-resize;
        `
      : $side === "right"
        ? css`
            top: 0;
            bottom: 0;
            left: 0;
            width: 5px;
            cursor: ew-resize;
          `
        : css`
            top: 0;
            right: 0;
            bottom: 0;
            width: 5px;
            cursor: ew-resize;
          `};

  &:focus-visible {
    outline: solid 1px ${({ theme }) => theme.devtools.focusRing};
    outline-offset: -1px;
  }
`;

/* ------------------------------------------------------------ about card */

const AboutBackdrop = styled.div`
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Same hardcoded-scrim precedent as the picker highlight overlay. */
  background: rgba(0, 0, 0, 0.4);
`;

const AboutCard = styled.section`
  width: 280px;
  padding: 12px 14px;
  color: ${({ theme }) => theme.devtools.text};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSize};
  line-height: ${({ theme }) => theme.devtools.lineHeight};
  background: ${({ theme }) => theme.devtools.surface};
  border: solid 1px ${({ theme }) => theme.devtools.border};
  box-shadow: ${({ theme }) => theme.shadows.lg};
`;

const AboutHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

const AboutBody = styled.div`
  display: grid;
  gap: 4px;

  p {
    margin: 0;
  }
`;

const AboutMuted = styled.span`
  color: ${({ theme }) => theme.devtools.textSubtle};
`;

const AboutLink = styled.a`
  color: ${({ theme }) => theme.devtools.accent};
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }

  &:focus-visible {
    outline: solid 1px ${({ theme }) => theme.devtools.focusRing};
    outline-offset: 1px;
  }
`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function maxDockHeight(): number {
  return Math.max(MIN_DOCK_HEIGHT, window.innerHeight - DOCK_VIEWPORT_MARGIN);
}

function maxDockWidth(): number {
  return Math.max(MIN_DOCK_WIDTH, window.innerWidth - DOCK_VIEWPORT_MARGIN);
}

/**
 * Preventing the pointerdown default does not stop the mousedown that follows
 * it from starting a text selection, so moving or resizing the window used to
 * smear a highlight across whatever page content the cursor passed over. Lock
 * selection off at the document root for the length of the gesture instead —
 * the page keeps whatever it had selected, it just cannot grow it. Returns the
 * undo, which the pointerup handler calls.
 */
function suppressPageSelection(): () => void {
  const root = document.documentElement;
  const previous = ["user-select", "-webkit-user-select"].map((property) => ({
    property,
    value: root.style.getPropertyValue(property),
    priority: root.style.getPropertyPriority(property),
  }));

  for (const { property } of previous) {
    root.style.setProperty(property, "none", "important");
  }

  return () => {
    for (const { property, value, priority } of previous) {
      if (value) root.style.setProperty(property, value, priority);
      else root.style.removeProperty(property);
    }
  };
}

/**
 * Console evaluation runs in the page's MAIN world, which only the background
 * service worker can reach (chrome.scripting is not available here). If the
 * extension was reloaded since injection, the runtime link is dead and
 * sendMessage throws — surface that instead of failing silently.
 */
async function evaluateExpression(
  expression: string,
): Promise<EvaluateResponse> {
  try {
    const request: EvaluateRequest = { type: EVALUATE_MESSAGE, expression };
    const response = (await chrome.runtime.sendMessage(request)) as
      EvaluateResponse | undefined;
    if (!response || typeof response.preview !== "string") {
      throw new Error("empty response");
    }
    return response;
  } catch {
    return {
      ok: false,
      preview:
        "The inspector lost its connection to the extension. Reload the page and launch it again.",
    };
  }
}

/**
 * Cookie access lives behind chrome.cookies in the background (only it holds
 * the "cookies" permission); the same dead-runtime caveat as evaluation
 * applies, so failures surface as messages instead of silent empty lists.
 */
async function loadCookies(scope: CookieScope): Promise<GetCookiesResponse> {
  try {
    const request: GetCookiesRequest = { type: GET_COOKIES_MESSAGE, scope };
    const response = (await chrome.runtime.sendMessage(request)) as
      GetCookiesResponse | undefined;
    if (!response || !Array.isArray(response.cookies)) {
      throw new Error("empty response");
    }
    return response;
  } catch {
    return {
      ok: false,
      cookies: [],
      error:
        "The inspector lost its connection to the extension. Reload the page and launch it again.",
    };
  }
}

async function deleteCookie(
  cookie: CookieEntry,
): Promise<DeleteCookieResponse> {
  try {
    const request: DeleteCookieRequest = {
      type: DELETE_COOKIE_MESSAGE,
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
    };
    const response = (await chrome.runtime.sendMessage(request)) as
      DeleteCookieResponse | undefined;
    if (!response) throw new Error("empty response");
    return response;
  } catch {
    return {
      ok: false,
      error:
        "The inspector lost its connection to the extension. Reload the page and launch it again.",
    };
  }
}

async function saveCookie(
  original: CookieEntry | null,
  next: CookieDraft,
): Promise<SetCookieResponse> {
  try {
    const request: SetCookieRequest = {
      type: SET_COOKIE_MESSAGE,
      // Only the identity fields travel; the background re-validates them.
      original: original && {
        name: original.name,
        domain: original.domain,
        path: original.path,
        secure: original.secure,
      },
      next,
    };
    const response = (await chrome.runtime.sendMessage(request)) as
      SetCookieResponse | undefined;
    if (!response) throw new Error("empty response");
    return response;
  } catch {
    return {
      ok: false,
      error:
        "The inspector lost its connection to the extension. Reload the page and launch it again.",
    };
  }
}

async function clearSiteCookies(): Promise<ClearSiteCookiesResponse> {
  try {
    const request: ClearSiteCookiesRequest = {
      type: CLEAR_SITE_COOKIES_MESSAGE,
    };
    const response = (await chrome.runtime.sendMessage(request)) as
      ClearSiteCookiesResponse | undefined;
    if (!response) throw new Error("empty response");
    return response;
  } catch {
    return {
      ok: false,
      error:
        "The inspector lost its connection to the extension. Reload the page and launch it again.",
    };
  }
}

/**
 * Tells the background this tab's inspector opened or closed (X button).
 * Open tabs are re-injected after reloads and get the document_start console
 * prehook registered. `activeTab` persists the active panel per site; an
 * open call without it gets the site's remembered panel echoed back.
 * Best-effort: a dead extension runtime resolves to undefined, never throws.
 * The try/catch is not redundant with `.catch()` — a runtime that has gone away
 * can make sendMessage throw synchronously instead of rejecting, and every
 * caller here is a React effect, where an escaping throw unmounts the whole
 * inspector rather than costing one message.
 */
function trackInspector(
  open: boolean,
  activeTab?: TabName,
): Promise<TrackInspectorResponse | undefined> {
  const request: TrackInspectorRequest = {
    type: TRACK_INSPECTOR_MESSAGE,
    open,
    ...(activeTab !== undefined ? { activeTab } : {}),
  };
  try {
    return chrome.runtime
      .sendMessage(request)
      .catch(() => undefined) as Promise<TrackInspectorResponse | undefined>;
  } catch {
    return Promise.resolve(undefined);
  }
}

/** Oldest network captures are dropped past this point, as rows are cheap
 *  but bodies are not. */
const MAX_NETWORK_CAPTURES = 500;

/** Folds one phased interceptor payload into the capture list by id. */
function reduceNetworkCapture(
  current: CapturedNetworkRequest[],
  phase: NetworkCapturePhase,
): CapturedNetworkRequest[] {
  const index = current.findIndex((entry) => entry.id === phase.id);

  if (phase.phase === "start") {
    if (index >= 0) return current;
    const entry: CapturedNetworkRequest = {
      id: phase.id,
      source: phase.source ?? "fetch",
      url: phase.url ?? "",
      method: phase.method ?? "GET",
      startTime: phase.startTime ?? 0,
      requestHeaders: phase.requestHeaders ?? [],
      requestBody: phase.requestBody ?? null,
      requestBodyTruncated: phase.requestBodyTruncated === true,
      status: 0,
      statusText: "",
      responseHeaders: [],
      contentType: "",
      duration: 0,
      responseBody: null,
      responseBodyTruncated: false,
      pending: true,
      error: null,
    };
    const next = [...current, entry];
    return next.length > MAX_NETWORK_CAPTURES
      ? next.slice(next.length - MAX_NETWORK_CAPTURES)
      : next;
  }

  if (index < 0) return current;
  const updated = { ...current[index] };
  if (phase.phase === "response") {
    updated.status = phase.status ?? 0;
    updated.statusText = phase.statusText ?? "";
    updated.responseHeaders = phase.responseHeaders ?? [];
    updated.contentType = phase.contentType ?? "";
    updated.duration = phase.duration ?? 0;
    updated.pending = false;
  } else if (phase.phase === "body") {
    updated.responseBody = phase.responseBody ?? null;
    updated.responseBodyTruncated = phase.responseBodyTruncated === true;
  } else {
    updated.error = phase.error ?? "failed";
    updated.pending = false;
    updated.duration = phase.duration ?? updated.duration;
  }
  const next = [...current];
  next[index] = updated;
  return next;
}

/** Pulls the background's headers-only webRequest log for this tab. */
async function loadHeaderDetails(): Promise<WebRequestEntry[]> {
  try {
    const request: GetNetworkDetailsRequest = {
      type: GET_NETWORK_DETAILS_MESSAGE,
    };
    const response = (await chrome.runtime.sendMessage(request)) as
      GetNetworkDetailsResponse | undefined;
    return response?.ok && Array.isArray(response.entries)
      ? response.entries
      : [];
  } catch {
    return [];
  }
}

async function requestCookieAccess(
  scope: CookieScope,
): Promise<RequestCookieAccessResponse> {
  try {
    const request: RequestCookieAccessRequest = {
      type: REQUEST_COOKIE_ACCESS_MESSAGE,
      scope,
    };
    const response = (await chrome.runtime.sendMessage(request)) as
      RequestCookieAccessResponse | undefined;
    if (!response) throw new Error("empty response");
    return response;
  } catch {
    return {
      ok: false,
      error:
        "The inspector lost its connection to the extension. Reload the page and launch it again.",
    };
  }
}

/**
 * The manifest version for the About card, or empty on a runtime that has gone
 * away. This one is read during render, where a throw is as fatal as one in an
 * effect.
 */
function manifestVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "";
  }
}

function initialFrame(): Frame {
  const width = Math.min(860, window.innerWidth - VIEWPORT_GUTTER * 2);
  const height = Math.min(560, window.innerHeight - VIEWPORT_GUTTER * 2);

  return {
    left: Math.max(VIEWPORT_GUTTER, window.innerWidth - width - 24),
    top: 24,
    width,
    height,
  };
}

function Inspector({ host }: { host: HTMLElement }) {
  const themeTokens = useTheme();
  const [frame, setFrame] = useState<Frame>(initialFrame);
  // Docked to the bottom by default, like DevTools' own default dock side.
  const [dock, setDock] = useState<DockSide>("bottom");
  const [dockHeight, setDockHeight] = useState(() =>
    clamp(
      Math.round(window.innerHeight * 0.4),
      MIN_DOCK_HEIGHT,
      maxDockHeight(),
    ),
  );
  const [dockWidth, setDockWidth] = useState(() =>
    clamp(Math.round(window.innerWidth * 0.35), MIN_DOCK_WIDTH, maxDockWidth()),
  );
  const [dragging, setDragging] = useState(false);
  const [picking, setPicking] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [tab, setTab] = useState<TabName>("Elements");
  const [snapshot, setSnapshot] = useState<ElementSnapshot | null>(null);
  const [selectedElement, setSelectedElement] = useState<HTMLElement | null>(
    null,
  );
  const [forcedStates, setForcedStates] =
    useState<ForcedStateMap>(noStatesForced);
  const [stateStylesByElement, setStateStylesByElement] = useState<
    Map<HTMLElement, StateStyleMap>
  >(() => new Map());
  const [sourceReveal, setSourceReveal] = useState<SourceRevealRequest | null>(
    null,
  );
  const [networkCaptures, setNetworkCaptures] = useState<
    CapturedNetworkRequest[]
  >([]);
  /** Bumped on every re-show so the state stylesheet is rebuilt after hide. */
  const [shownTick, setShownTick] = useState(0);
  const revealSeq = useRef(0);
  /** Once the user picks a panel, the restored per-site panel never wins. */
  const userPickedTab = useRef(false);
  const [entries, setEntries] = useState<ConsoleEntry[]>([
    {
      id: 0,
      level: "info",
      text: "Inspector Lab ready. Pick an element or browse the Elements tree.",
    },
  ]);
  const nextEntryId = useRef(1);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const log = useCallback(
    (
      level: ConsoleLevel,
      text: string,
      extra?: Pick<ConsoleEntry, "parts" | "source">,
    ) => {
      setEntries((current) => {
        const next = [
          ...current,
          { id: nextEntryId.current++, level, text, ...extra },
        ];
        return next.length > MAX_CONSOLE_ENTRIES
          ? next.slice(next.length - MAX_CONSOLE_ENTRIES)
          : next;
      });
    },
    [],
  );

  /*
   * Console capture: ask the background to patch the page's console in the
   * MAIN world, then listen for the entries it re-broadcasts. The event name
   * is a random per-launch token, so page scripts cannot find the channel.
   * Capture starts at launch — earlier logs live only in the browser console.
   */
  useEffect(() => {
    const eventName = randomConsoleEventName();

    const onCaptured = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== "string") return;

      let payload: CapturedConsolePayload;
      try {
        payload = JSON.parse(detail) as CapturedConsolePayload;
      } catch {
        return;
      }
      if (typeof payload?.text !== "string") return;

      const level: ConsoleLevel =
        payload.level === "warn"
          ? "warning"
          : payload.level === "error"
            ? "error"
            : payload.level === "info"
              ? "info"
              : "log";
      log(level, payload.text, {
        parts: payload.parts,
        source: payload.source,
      });
    };

    document.addEventListener(eventName, onCaptured);

    const request: InterceptConsoleRequest = {
      type: INTERCEPT_CONSOLE_MESSAGE,
      eventName,
    };
    void (async () => {
      try {
        const response = (await chrome.runtime.sendMessage(request)) as
          InterceptConsoleResponse | undefined;
        if (!response?.ok) throw new Error("rejected");
      } catch {
        log(
          "warning",
          "console.log capture is unavailable; page logs stay in the browser console.",
        );
      }
    })();

    return () => document.removeEventListener(eventName, onCaptured);
  }, [log]);

  /*
   * Network capture mirrors the console flow: the background installs the
   * fetch/XHR wrapper in the MAIN world, entries stream over a random
   * per-launch event channel, and anything buffered before launch (the
   * document_start registration on granted origins) is replayed on connect.
   */
  useEffect(() => {
    const eventName = randomNetworkEventName();

    const onCaptured = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== "string") return;

      let phase: NetworkCapturePhase;
      try {
        phase = JSON.parse(detail) as NetworkCapturePhase;
      } catch {
        return;
      }
      if (typeof phase?.id !== "string") return;
      setNetworkCaptures((current) => reduceNetworkCapture(current, phase));
    };

    document.addEventListener(eventName, onCaptured);

    const request: InterceptNetworkRequest = {
      type: INTERCEPT_NETWORK_MESSAGE,
      eventName,
    };
    void (async () => {
      try {
        const response = (await chrome.runtime.sendMessage(request)) as
          InterceptNetworkResponse | undefined;
        if (!response?.ok) throw new Error("rejected");
      } catch {
        log(
          "warning",
          "Live network capture is unavailable; the Network tab will show the Performance timeline only.",
        );
      }
    })();

    return () => document.removeEventListener(eventName, onCaptured);
  }, [log]);

  const clearNetworkCaptures = useCallback(() => setNetworkCaptures([]), []);

  useLayoutEffect(() => {
    if (dock === "bottom") {
      Object.assign(host.style, {
        left: "0px",
        right: "0px",
        top: "auto",
        bottom: "0px",
        width: "100%",
        height: `${dockHeight}px`,
      });
      return;
    }
    if (dock === "left" || dock === "right") {
      Object.assign(host.style, {
        top: "0px",
        bottom: "0px",
        height: "100%",
        width: `${dockWidth}px`,
        left: dock === "left" ? "0px" : "auto",
        right: dock === "left" ? "auto" : "0px",
      });
      return;
    }
    Object.assign(host.style, {
      left: `${frame.left}px`,
      top: `${frame.top}px`,
      right: "auto",
      bottom: "auto",
      width: `${frame.width}px`,
      height: `${frame.height}px`,
    });
  }, [dock, dockHeight, dockWidth, frame, host]);

  useEffect(() => {
    const show = (event: Event) => {
      // Answering the event is also the liveness signal bootstrap() and the
      // popup use to tell a running inspector from an empty host element.
      event.preventDefault();
      host.style.display = "block";
      // Re-opening re-arms persistence and rebuilds the state stylesheet.
      trackInspector(true);
      setShownTick((current) => current + 1);
      setFrame((current) => ({
        ...current,
        left: clamp(
          current.left,
          VIEWPORT_GUTTER,
          window.innerWidth - current.width - VIEWPORT_GUTTER,
        ),
        top: clamp(
          current.top,
          VIEWPORT_GUTTER,
          window.innerHeight - current.height - VIEWPORT_GUTTER,
        ),
      }));
    };
    const keepInViewport = () => {
      setFrame((current) => {
        const width = Math.min(
          current.width,
          window.innerWidth - VIEWPORT_GUTTER * 2,
        );
        const height = Math.min(
          current.height,
          window.innerHeight - VIEWPORT_GUTTER * 2,
        );
        return {
          width,
          height,
          left: clamp(
            current.left,
            VIEWPORT_GUTTER,
            window.innerWidth - width - VIEWPORT_GUTTER,
          ),
          top: clamp(
            current.top,
            VIEWPORT_GUTTER,
            window.innerHeight - height - VIEWPORT_GUTTER,
          ),
        };
      });
      setDockHeight((current) =>
        clamp(current, MIN_DOCK_HEIGHT, maxDockHeight()),
      );
      setDockWidth((current) => clamp(current, MIN_DOCK_WIDTH, maxDockWidth()));
    };

    host.addEventListener(SHOW_EVENT, show);
    window.addEventListener("resize", keepInViewport);
    return () => {
      host.removeEventListener(SHOW_EVENT, show);
      window.removeEventListener("resize", keepInViewport);
    };
  }, [host]);

  const selectElement = useCallback(
    (element: HTMLElement) => {
      setSelectedElement(element);
      setSnapshot(snapshotElement(element));
      log("log", `Selected ${describeElement(element)}`);
    },
    [log],
  );

  /* Tree-row hover overlay, painted with the active theme's highlight pair. */
  const hoverHighlight = useCallback(
    (element: Element | null) =>
      highlightElement(element, {
        fill: themeTokens.devtools.highlightFill,
        border: themeTokens.devtools.highlightBorder,
      }),
    [themeTokens],
  );

  /* ---------------------------------------------------- forced states */

  /* Forcing is per-selection, as in DevTools; authored styles persist. */
  useEffect(() => setForcedStates(noStatesForced()), [selectedElement]);

  const selectedStateStyles = useMemo(
    () =>
      (selectedElement
        ? stateStylesByElement.get(selectedElement)
        : undefined) ?? emptyStateStyles(),
    [selectedElement, stateStylesByElement],
  );

  /* Rebuild the page-side forced-state stylesheet on any relevant change. */
  useEffect(() => {
    if (!selectedElement) {
      clearStateStyles();
      return;
    }
    applyStateStyles(selectedElement, forcedStates, selectedStateStyles);
  }, [selectedElement, forcedStates, selectedStateStyles, shownTick]);

  /* The stylesheet must never outlive the inspector. */
  useEffect(() => () => clearStateStyles(), []);

  const toggleForcedState = useCallback(
    (state: PseudoState, forced: boolean) => {
      setForcedStates((current) => ({ ...current, [state]: forced }));
    },
    [],
  );

  function addStateStyle(state: PseudoState, property: string, value: string) {
    const element = selectedElement;
    const trimmedProperty = property.trim();
    const trimmedValue = value.trim();

    if (!element || !trimmedProperty || !trimmedValue) {
      const message = "Choose an element and enter a CSS rule.";
      log("error", message);
      return { error: true, message };
    }
    if (!CSS.supports(trimmedProperty, trimmedValue)) {
      const message = "That property/value pair is not valid CSS.";
      log("error", message);
      return { error: true, message };
    }

    setStateStylesByElement((current) => {
      const next = new Map(current);
      const styles = next.get(element) ?? emptyStateStyles();
      next.set(element, {
        ...styles,
        [state]: [
          ...styles[state].filter((entry) => entry.name !== trimmedProperty),
          { name: trimmedProperty, value: trimmedValue },
        ],
      });
      return next;
    });

    const message = `${trimmedProperty}: ${trimmedValue} added to :${state} on ${describeElement(element)}`;
    log("log", message);
    return { error: false, message };
  }

  function removeStateStyle(state: PseudoState, propertyName: string) {
    const element = selectedElement;
    if (!element) return;
    setStateStylesByElement((current) => {
      const styles = current.get(element);
      if (!styles) return current;
      const next = new Map(current);
      next.set(element, {
        ...styles,
        [state]: styles[state].filter((entry) => entry.name !== propertyName),
      });
      return next;
    });
  }

  /** User-driven panel switch: applied, marked, and persisted per site. */
  const selectTab = useCallback((name: TabName) => {
    userPickedTab.current = true;
    setTab(name);
    void trackInspector(true, name);
  }, []);

  /* Styles-pane source links jump to the rule's file in the Sources tab. */
  const openSource = useCallback(
    (rule: MatchedRule) => {
      revealSeq.current += 1;
      setSourceReveal({
        href: rule.sourceHref,
        inlineIndex: rule.inlineIndex,
        seq: revealSeq.current,
      });
      selectTab("Sources");
    },
    [selectTab],
  );

  /* Mark this tab as open so reloads bring the inspector back until X, and
     restore the site's remembered panel unless the user already picked one. */
  useEffect(() => {
    void trackInspector(true).then((response) => {
      const saved = response?.activeTab;
      if (
        !userPickedTab.current &&
        typeof saved === "string" &&
        (TABS as readonly string[]).includes(saved)
      ) {
        setTab(saved as TabName);
      }
    });
  }, []);

  /* Launch with <body> selected so the panels are never empty on arrival. */
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (didAutoSelect.current) return;
    didAutoSelect.current = true;
    if (document.body) selectElement(document.body);
  }, [selectElement]);

  useEffect(() => {
    if (!aboutOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAboutOpen(false);
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [aboutOpen]);

  useEffect(() => {
    if (!picking) return;

    const highlight = document.createElement("div");
    highlight.id = HIGHLIGHT_ID;
    Object.assign(highlight.style, {
      position: "fixed",
      zIndex: "2147483646",
      pointerEvents: "none",
      background: themeTokens.devtools.highlightFill,
      border: `1px solid ${themeTokens.devtools.highlightBorder}`,
      boxSizing: "border-box",
      transition: "all 40ms linear",
    });
    document.documentElement.append(highlight);

    const candidateFromEvent = (event: Event): HTMLElement | null => {
      const candidate = event.composedPath()[0];
      if (!(candidate instanceof HTMLElement)) return null;
      if (candidate === host || host.contains(candidate)) return null;
      if (isInspectorNode(candidate)) return null;
      return candidate;
    };

    const move = (event: PointerEvent) => {
      const candidate = candidateFromEvent(event);
      if (!candidate) return;
      const rect = candidate.getBoundingClientRect();
      Object.assign(highlight.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    };

    const choose = (event: MouseEvent) => {
      const candidate = candidateFromEvent(event);
      if (!candidate) return;
      event.preventDefault();
      event.stopPropagation();
      selectElement(candidate);
      selectTab("Elements");
      setPicking(false);
    };

    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicking(false);
    };

    document.addEventListener("pointermove", move, true);
    document.addEventListener("click", choose, true);
    document.addEventListener("keydown", cancel, true);
    return () => {
      highlight.remove();
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("click", choose, true);
      document.removeEventListener("keydown", cancel, true);
    };
  }, [host, picking, selectElement, selectTab, themeTokens]);

  function beginDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest("button")) return;

    event.preventDefault();
    const releaseSelection = suppressPageSelection();
    setDragging(true);

    // Dragging a docked window tears it off into floating mode, re-centered
    // under the cursor so the toolbar stays in hand; the dock buttons snap it
    // back. Floating windows just move as before.
    let startFrame = frame;
    if (dock !== "floating") {
      startFrame = {
        width: frame.width,
        height: frame.height,
        left: clamp(
          event.clientX - frame.width / 2,
          VIEWPORT_GUTTER,
          Math.max(
            VIEWPORT_GUTTER,
            window.innerWidth - frame.width - VIEWPORT_GUTTER,
          ),
        ),
        top: clamp(
          event.clientY - 14,
          VIEWPORT_GUTTER,
          Math.max(
            VIEWPORT_GUTTER,
            window.innerHeight - frame.height - VIEWPORT_GUTTER,
          ),
        ),
      };
      setDock("floating");
      setFrame(startFrame);
    }

    const start = { x: event.clientX, y: event.clientY, frame: startFrame };

    const move = (moveEvent: PointerEvent) => {
      setFrame((current) => ({
        ...current,
        left: clamp(
          start.frame.left + moveEvent.clientX - start.x,
          VIEWPORT_GUTTER,
          window.innerWidth - current.width - VIEWPORT_GUTTER,
        ),
        top: clamp(
          start.frame.top + moveEvent.clientY - start.y,
          VIEWPORT_GUTTER,
          window.innerHeight - current.height - VIEWPORT_GUTTER,
        ),
      }));
    };
    const end = () => {
      setDragging(false);
      releaseSelection();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
  }

  /**
   * Resizing from any edge or corner: east/south move the far edge, while
   * west/north move the origin and keep the opposite edge pinned in place.
   */
  function beginEdgeResize(
    direction: ResizeDirection,
    event: React.PointerEvent<HTMLElement>,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const releaseSelection = suppressPageSelection();
    const start = { x: event.clientX, y: event.clientY, frame };
    const minWidth = Math.min(
      MIN_WIDTH,
      window.innerWidth - VIEWPORT_GUTTER * 2,
    );
    const minHeight = Math.min(
      MIN_HEIGHT,
      window.innerHeight - VIEWPORT_GUTTER * 2,
    );

    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;

      setFrame(() => {
        let { left, top, width, height } = start.frame;
        const right = start.frame.left + start.frame.width;
        const bottom = start.frame.top + start.frame.height;

        if (direction.includes("e")) {
          width = clamp(
            start.frame.width + dx,
            minWidth,
            window.innerWidth - left - VIEWPORT_GUTTER,
          );
        }
        if (direction.includes("s")) {
          height = clamp(
            start.frame.height + dy,
            minHeight,
            window.innerHeight - top - VIEWPORT_GUTTER,
          );
        }
        if (direction.includes("w")) {
          left = clamp(
            start.frame.left + dx,
            VIEWPORT_GUTTER,
            right - minWidth,
          );
          width = right - left;
        }
        if (direction.includes("n")) {
          top = clamp(
            start.frame.top + dy,
            VIEWPORT_GUTTER,
            bottom - minHeight,
          );
          height = bottom - top;
        }

        return { left, top, width, height };
      });
    };
    const end = () => {
      releaseSelection();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
  }

  /** Drags the page-facing edge of a docked window to change the split. */
  function beginDockResize(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || dock === "floating") return;
    event.preventDefault();
    const releaseSelection = suppressPageSelection();
    const side = dock;
    const start = {
      x: event.clientX,
      y: event.clientY,
      width: dockWidth,
      height: dockHeight,
    };

    const move = (moveEvent: PointerEvent) => {
      if (side === "bottom") {
        setDockHeight(
          clamp(
            start.height + (start.y - moveEvent.clientY),
            MIN_DOCK_HEIGHT,
            maxDockHeight(),
          ),
        );
      } else if (side === "right") {
        setDockWidth(
          clamp(
            start.width + (start.x - moveEvent.clientX),
            MIN_DOCK_WIDTH,
            maxDockWidth(),
          ),
        );
      } else {
        setDockWidth(
          clamp(
            start.width + (moveEvent.clientX - start.x),
            MIN_DOCK_WIDTH,
            maxDockWidth(),
          ),
        );
      }
    };
    const end = () => {
      releaseSelection();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
  }

  function dockResizeWithKeyboard(event: React.KeyboardEvent<HTMLElement>) {
    if (dock === "floating") return;
    const amount = event.shiftKey ? 40 : 10;
    let handled = true;

    if (dock === "bottom") {
      if (event.key === "ArrowUp") {
        setDockHeight((current) =>
          clamp(current + amount, MIN_DOCK_HEIGHT, maxDockHeight()),
        );
      } else if (event.key === "ArrowDown") {
        setDockHeight((current) =>
          clamp(current - amount, MIN_DOCK_HEIGHT, maxDockHeight()),
        );
      } else handled = false;
    } else {
      // Growing always means moving the drag edge toward the page.
      const grow = dock === "right" ? "ArrowLeft" : "ArrowRight";
      const shrink = dock === "right" ? "ArrowRight" : "ArrowLeft";
      if (event.key === grow) {
        setDockWidth((current) =>
          clamp(current + amount, MIN_DOCK_WIDTH, maxDockWidth()),
        );
      } else if (event.key === shrink) {
        setDockWidth((current) =>
          clamp(current - amount, MIN_DOCK_WIDTH, maxDockWidth()),
        );
      } else handled = false;
    }

    if (handled) event.preventDefault();
  }

  /** Clicking the active dock button again releases the window to float. */
  function toggleDock(side: Exclude<DockSide, "floating">) {
    setDock((current) => (current === side ? "floating" : side));
  }

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLElement>) {
    const amount = event.shiftKey ? 40 : 10;
    if (
      !["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      return;
    }
    event.preventDefault();
    setFrame((current) => ({
      ...current,
      width:
        event.key === "ArrowRight"
          ? Math.min(
              current.width + amount,
              window.innerWidth - current.left - 12,
            )
          : event.key === "ArrowLeft"
            ? Math.max(MIN_WIDTH, current.width - amount)
            : current.width,
      height:
        event.key === "ArrowDown"
          ? Math.min(
              current.height + amount,
              window.innerHeight - current.top - 12,
            )
          : event.key === "ArrowUp"
            ? Math.max(MIN_HEIGHT, current.height - amount)
            : current.height,
    }));
  }

  /** Roving focus across the tab strip, the way a tablist should behave. */
  function onTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = TABS.indexOf(tab);
    let next = index;

    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;

    event.preventDefault();
    selectTab(TABS[next]);
    tabRefs.current[next]?.focus();
  }

  function applyStyle(property: string, value: string) {
    const element = selectedElement;

    if (!element || !property.trim() || !value.trim()) {
      const message = "Choose an element and enter a CSS rule.";
      log("error", message);
      return { error: true, message };
    }

    if (!CSS.supports(property.trim(), value.trim())) {
      const message = "That property/value pair is not valid CSS.";
      log("error", message);
      return { error: true, message };
    }

    element.style.setProperty(property.trim(), value.trim());
    setSnapshot(snapshotElement(element));
    const message = `${property.trim()}: ${value.trim()} applied to ${describeElement(element)}`;
    log("log", message);
    return { error: false, message };
  }

  function removeStyle(property: string) {
    const element = selectedElement;

    if (!element) {
      const message = "Choose an element first.";
      log("error", message);
      return { error: true, message };
    }

    element.style.removeProperty(property);
    // removeProperty leaves an empty style="" behind; drop it from the tree.
    if (!element.getAttribute("style")) element.removeAttribute("style");
    setSnapshot(snapshotElement(element));
    const message = `${property} removed from ${describeElement(element)}`;
    log("log", message);
    return { error: false, message };
  }

  /**
   * One attribute edit from the Elements tree. `previousName` null adds a
   * new attribute, an empty `name` removes `previousName`, and a null
   * `value` keeps the attribute's current value (a pure rename).
   */
  function editAttribute(
    element: Element,
    previousName: string | null,
    name: string,
    value: string | null,
  ) {
    const trimmedName = name.trim();

    if (previousName && !trimmedName) {
      element.removeAttribute(previousName);
      if (selectedElement && element === selectedElement)
        setSnapshot(snapshotElement(selectedElement));
      const message = `${previousName} removed from ${describeElement(element)}`;
      log("log", message);
      return { error: false, message };
    }

    if (!trimmedName) {
      return { error: true, message: "Enter an attribute name." };
    }

    // Validates the name without touching the element: setAttribute would
    // throw the same InvalidCharacterError after the old attribute was
    // already removed.
    try {
      document.createAttribute(trimmedName);
    } catch {
      const message = `"${trimmedName}" is not a valid attribute name.`;
      log("error", message);
      return { error: true, message };
    }

    const nextValue =
      value ?? (previousName ? (element.getAttribute(previousName) ?? "") : "");
    if (previousName && previousName !== trimmedName) {
      element.removeAttribute(previousName);
    }
    element.setAttribute(trimmedName, nextValue);

    if (selectedElement && element === selectedElement)
      setSnapshot(snapshotElement(selectedElement));
    const message = previousName
      ? `${trimmedName} updated on ${describeElement(element)}`
      : `${trimmedName} added to ${describeElement(element)}`;
    log("log", message);
    return { error: false, message };
  }

  /** Replaces a leaf element's text from the tree, as Chrome's editing does. */
  function editText(element: Element, text: string) {
    // A tree leaf can still hold element children on the page when they are
    // all the inspector's own filtered-out nodes (a text-only <body> hosts
    // the inspector itself); writing textContent would destroy them.
    if (element.children.length > 0) {
      const message = "Only text-only elements can be edited here.";
      log("error", message);
      return { error: true, message };
    }

    element.textContent = text;
    if (selectedElement && element === selectedElement)
      setSnapshot(snapshotElement(selectedElement));
    const message = `Text updated on ${describeElement(element)}`;
    log("log", message);
    return { error: false, message };
  }

  /** The X button: hides the window AND ends reload persistence. */
  function hideInspector() {
    setPicking(false);
    highlightElement(null);
    setForcedStates(noStatesForced());
    clearStateStyles();
    trackInspector(false);
    host.style.display = "none";
  }

  return (
    <InspectorWindow
      $floating={dock === "floating"}
      aria-label="Inspector Lab - DevTools in-page inspector"
    >
      <WindowToolbar $dragging={dragging} onPointerDown={beginDrag}>
        <ToolbarControls>
          <IconButton
            aria-label={picking ? "Cancel element picker" : "Pick an element"}
            $active={picking}
            onClick={() => setPicking((active) => !active)}
          >
            <Icon name="MousePointer2" size={14} />
          </IconButton>
          <IconButton aria-label="Toggle device toolbar" disabled>
            <Icon name="Smartphone" size={14} />
          </IconButton>
        </ToolbarControls>
        <ToolbarDivider />

        <TabStrip
          role="tablist"
          aria-label="DevTools panels"
          onKeyDown={onTabKeyDown}
        >
          {TABS.map((name, index) => (
            <Tab
              key={name}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`inspector-tab-${name}`}
              aria-selected={tab === name}
              aria-controls={`inspector-panel-${name}`}
              tabIndex={tab === name ? 0 : -1}
              $selected={tab === name}
              onClick={() => selectTab(name)}
            >
              {name}
            </Tab>
          ))}
        </TabStrip>

        <ToolbarSpacer />

        <ToolbarControls>
          <IconButton
            aria-label="About Inspector Lab - DevTools"
            onClick={() => setAboutOpen(true)}
          >
            <Icon name="CircleQuestionMark" size={14} />
          </IconButton>
          <ToolbarDivider />
          <IconButton
            aria-label="Float the inspector to move it freely"
            $active={dock === "floating"}
            onClick={() => setDock("floating")}
          >
            <Icon name="Move" size={14} />
          </IconButton>
          <IconButton
            aria-label="Dock to bottom"
            $active={dock === "bottom"}
            onClick={() => toggleDock("bottom")}
          >
            <Icon name="PanelBottom" size={14} />
          </IconButton>
          <IconButton
            aria-label="Dock to right"
            $active={dock === "right"}
            onClick={() => toggleDock("right")}
          >
            <Icon name="PanelRight" size={14} />
          </IconButton>
          <IconButton
            aria-label="Dock to left"
            $active={dock === "left"}
            onClick={() => toggleDock("left")}
          >
            <Icon name="PanelLeft" size={14} />
          </IconButton>
          <ToolbarDivider />
          <IconButton
            aria-label="Close Inspector Lab - DevTools"
            onClick={hideInspector}
          >
            <Icon name="X" size={14} />
          </IconButton>
        </ToolbarControls>
      </WindowToolbar>

      <PanelHost
        role="tabpanel"
        id={`inspector-panel-${tab}`}
        aria-labelledby={`inspector-tab-${tab}`}
      >
        {tab === "Elements" && (
          <ElementsPanel
            root={document.documentElement}
            selectedElement={selectedElement}
            snapshot={snapshot}
            onSelectElement={selectElement}
            onHoverElement={hoverHighlight}
            onApplyStyle={applyStyle}
            onRemoveStyle={removeStyle}
            onEditAttribute={editAttribute}
            onEditText={editText}
            forcedStates={forcedStates}
            onToggleForcedState={toggleForcedState}
            stateStyles={selectedStateStyles}
            onAddStateStyle={addStateStyle}
            onRemoveStateStyle={removeStateStyle}
            onOpenSource={openSource}
          />
        )}
        {tab === "Console" && (
          <ConsolePanel
            entries={entries}
            onSubmit={(expression) => {
              log("input", expression);
              void evaluateExpression(expression).then((response) => {
                log(
                  response.ok ? "result" : "error",
                  response.preview,
                  response.ok && response.tone
                    ? {
                        parts: [
                          { text: response.preview, tone: response.tone },
                        ],
                      }
                    : undefined,
                );
              });
            }}
            onClear={() => setEntries([])}
          />
        )}
        {tab === "Sources" && <SourcesPanel reveal={sourceReveal} />}
        {tab === "Network" && (
          <NetworkPanel
            captured={networkCaptures}
            onClearCaptured={clearNetworkCaptures}
            loadHeaderDetails={loadHeaderDetails}
          />
        )}
        {tab === "Cookies" && (
          <CookiesPanel
            loadCookies={loadCookies}
            deleteCookie={deleteCookie}
            saveCookie={saveCookie}
            clearCookies={clearSiteCookies}
            requestAccess={requestCookieAccess}
          />
        )}
        {tab === "Storage" && <StoragePanel />}
      </PanelHost>

      {aboutOpen && (
        <AboutBackdrop onClick={() => setAboutOpen(false)}>
          <AboutCard
            role="dialog"
            aria-modal="true"
            aria-label="About Inspector Lab - DevTools"
            onClick={(event) => event.stopPropagation()}
          >
            <AboutHeader>
              <strong>
                Inspector Lab - DevTools{" "}
                {manifestVersion() && (
                  <AboutMuted>v{manifestVersion()}</AboutMuted>
                )}
              </strong>
              <ToolbarControls>
                <IconButton
                  aria-label="Close about"
                  onClick={() => setAboutOpen(false)}
                >
                  <Icon name="X" size={14} />
                </IconButton>
              </ToolbarControls>
            </AboutHeader>
            <AboutBody>
              <p>Created by Luan Gjokaj</p>
              <p>
                <AboutLink
                  href="https://riangle.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  riangle.com
                </AboutLink>
              </p>
              <p>
                <AboutLink href="mailto:luan@riangle.com">
                  luan@riangle.com
                </AboutLink>
              </p>
            </AboutBody>
          </AboutCard>
        </AboutBackdrop>
      )}

      {dock === "floating" ? (
        <>
          {(["n", "s", "e", "w", "ne", "nw", "sw"] as const).map(
            (direction) => (
              <FloatResizeHandle
                key={direction}
                $direction={direction}
                aria-hidden="true"
                onPointerDown={(event) => beginEdgeResize(direction, event)}
              />
            ),
          )}
          <ResizeHandle
            role="separator"
            aria-label="Resize inspector"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={(event) => beginEdgeResize("se", event)}
            onKeyDown={resizeWithKeyboard}
          />
        </>
      ) : (
        <DockResizer
          $side={dock}
          role="separator"
          aria-label="Resize inspector"
          aria-orientation={dock === "bottom" ? "horizontal" : "vertical"}
          tabIndex={0}
          onPointerDown={beginDockResize}
          onKeyDown={dockResizeWithKeyboard}
        />
      )}
    </InspectorWindow>
  );
}

/**
 * Owns the theme choice: the popup's light/dark toggle when a choice was
 * made (live, mirrored through chrome.storage), the OS preference until
 * then, crossed with the "custom inspector theme" toggle (branded is the
 * default; off mirrors Chrome DevTools' own look).
 *
 * Cherry's own providers persist the choice by toggling a `dark` class on
 * <html> and writing localStorage — on the host page, which the inspector must
 * never modify. So the theme object is resolved here and handed straight to
 * styled-components.
 */
function InspectorRoot({ host }: { host: HTMLElement }) {
  const [osPrefersDark, setOsPrefersDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  const [schemeChoice, setSchemeChoice] = useState<InspectorColorScheme | null>(
    null,
  );
  const [branded, setBranded] = useState(true);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) =>
      setOsPrefersDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void readCustomThemeSetting().then((enabled) => {
      if (!cancelled) setBranded(enabled);
    });
    void readColorSchemeSetting().then((scheme) => {
      if (!cancelled) setSchemeChoice(scheme);
    });
    const unwatchTheme = watchCustomThemeSetting(setBranded);
    const unwatchScheme = watchColorSchemeSetting(setSchemeChoice);
    return () => {
      cancelled = true;
      unwatchTheme();
      unwatchScheme();
    };
  }, []);

  const isDark =
    schemeChoice !== null ? schemeChoice === "dark" : osPrefersDark;
  const activeTheme = resolveInspectorTheme(isDark, branded);

  /* Native controls (selects, scrollbars) in the shadow root follow this. */
  useEffect(() => {
    host.style.colorScheme = activeTheme.isDark ? "dark" : "light";
  }, [host, activeTheme]);

  return (
    <ThemeProvider theme={activeTheme}>
      <Inspector host={host} />
    </ThemeProvider>
  );
}

/**
 * Keeps one unsupported browser API from taking the window down with it.
 * React unmounts the entire root when an error escapes render or an effect and
 * no boundary catches it, so on a reduced-API browser a single missing
 * namespace turns "this panel cannot work here" into an inspector that paints
 * once and vanishes — with the host element left behind as an empty shell.
 *
 * The fallback is deliberately inline-styled: it has to render even when the
 * failure was in resolving the theme itself.
 */
class InspectorErrorBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  state: { message: string | null } = { message: null };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return {
      message:
        error instanceof Error && error.message
          ? error.message
          : "An unexpected error stopped the inspector.",
    };
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          boxSizing: "border-box",
          width: "100%",
          height: "100%",
          padding: "12px 14px",
          overflow: "auto",
          color: "#e8eaed",
          font: "13px/1.5 system-ui, -apple-system, sans-serif",
          background: "#202124",
          border: "solid 1px #3c4043",
        }}
      >
        <strong>Inspector Lab could not start on this page.</strong>
        <p style={{ margin: "8px 0 0" }}>{this.state.message}</p>
        <p style={{ margin: "8px 0 0", color: "#9aa0a6" }}>
          This browser may not support something the inspector needs. Reload the
          page and launch it again to retry.
        </p>
      </div>
    );
  }
}

function bootstrap() {
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    // A live tree answers by calling preventDefault (see the SHOW_EVENT
    // handler). An unanswered dispatch means the React root is gone while its
    // host element survives — an empty shell that would otherwise make the
    // inspector impossible to reopen on this page, because every relaunch path
    // stops at "the host exists, so it must be running". Rebuild instead.
    const handled = !existing.dispatchEvent(
      new Event(SHOW_EVENT, { cancelable: true }),
    );
    if (handled) return;
    existing.remove();
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: "fixed",
    zIndex: "2147483647",
    display: "block",
    margin: "0",
    padding: "0",
    border: "0",
    background: "transparent",
  });
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "open" });
  const styleTarget = document.createElement("div");
  const mount = document.createElement("div");
  Object.assign(mount.style, { width: "100%", height: "100%" });
  shadow.append(styleTarget, mount);

  const root = createRoot(mount);

  root.render(
    <StyleSheetManager target={styleTarget}>
      <InspectorErrorBoundary>
        <InspectorRoot host={host} />
      </InspectorErrorBoundary>
    </StyleSheetManager>,
  );
}

bootstrap();
