import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import styled, {
  StyleSheetManager,
  ThemeProvider,
  css,
} from "styled-components";
import { Icon, IconButton } from "cherry-styled-components";
import { theme as lightTheme, themeDark } from "~lib/theme";
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
} from "~injected/inspector-dom";
import {
  DELETE_COOKIE_MESSAGE,
  EVALUATE_MESSAGE,
  GET_COOKIES_MESSAGE,
  INTERCEPT_CONSOLE_MESSAGE,
  REQUEST_COOKIE_ACCESS_MESSAGE,
  randomConsoleEventName,
  type CapturedConsolePayload,
  type CookieEntry,
  type DeleteCookieRequest,
  type DeleteCookieResponse,
  type EvaluateRequest,
  type EvaluateResponse,
  type GetCookiesRequest,
  type GetCookiesResponse,
  type InterceptConsoleRequest,
  type InterceptConsoleResponse,
  type RequestCookieAccessRequest,
  type RequestCookieAccessResponse,
} from "~lib/messages";
import { ElementsPanel } from "~injected/panels/elements-panel";
import {
  ConsolePanel,
  type ConsoleEntry,
  type ConsoleLevel,
} from "~injected/panels/console-panel";
import { SourcesPanel } from "~injected/panels/sources-panel";
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
async function loadCookies(): Promise<GetCookiesResponse> {
  try {
    const request: GetCookiesRequest = { type: GET_COOKIES_MESSAGE };
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

async function requestCookieAccess(): Promise<RequestCookieAccessResponse> {
  try {
    const request: RequestCookieAccessRequest = {
      type: REQUEST_COOKIE_ACCESS_MESSAGE,
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
  const [tab, setTab] = useState<TabName>("Elements");
  const [snapshot, setSnapshot] = useState<ElementSnapshot | null>(null);
  const [selectedElement, setSelectedElement] = useState<HTMLElement | null>(
    null,
  );
  const [entries, setEntries] = useState<ConsoleEntry[]>([
    {
      id: 0,
      level: "info",
      text: "Inspector Lab ready. Pick an element or browse the Elements tree.",
    },
  ]);
  const nextEntryId = useRef(1);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const log = useCallback((level: ConsoleLevel, text: string) => {
    setEntries((current) => {
      const next = [...current, { id: nextEntryId.current++, level, text }];
      return next.length > MAX_CONSOLE_ENTRIES
        ? next.slice(next.length - MAX_CONSOLE_ENTRIES)
        : next;
    });
  }, []);

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
      log(level, payload.text);
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
    const show = () => {
      host.style.display = "block";
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

  useEffect(() => {
    if (!picking) return;

    const highlight = document.createElement("div");
    highlight.id = HIGHLIGHT_ID;
    Object.assign(highlight.style, {
      position: "fixed",
      zIndex: "2147483646",
      pointerEvents: "none",
      background: "rgba(111, 168, 220, 0.66)",
      border: "1px solid rgba(255, 229, 153, 0.9)",
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
      setTab("Elements");
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
  }, [host, picking, selectElement]);

  function beginDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest("button")) return;

    event.preventDefault();
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
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
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
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  }

  /** Drags the page-facing edge of a docked window to change the split. */
  function beginDockResize(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || dock === "floating") return;
    event.preventDefault();
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
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
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
    setTab(TABS[next]);
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

  function hideInspector() {
    setPicking(false);
    highlightElement(null);
    host.style.display = "none";
  }

  return (
    <InspectorWindow aria-label="Inspector Lab in-page inspector">
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
              onClick={() => setTab(name)}
            >
              {name}
            </Tab>
          ))}
        </TabStrip>

        <ToolbarSpacer />

        <ToolbarControls>
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
          <IconButton aria-label="Close Inspector Lab" onClick={hideInspector}>
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
            onHoverElement={highlightElement}
            onApplyStyle={applyStyle}
            onRemoveStyle={removeStyle}
          />
        )}
        {tab === "Console" && (
          <ConsolePanel
            entries={entries}
            onSubmit={(expression) => {
              log("input", expression);
              void evaluateExpression(expression).then((response) => {
                log(response.ok ? "result" : "error", response.preview);
              });
            }}
            onClear={() => setEntries([])}
          />
        )}
        {tab === "Sources" && <SourcesPanel />}
        {tab === "Network" && <NetworkPanel />}
        {tab === "Cookies" && (
          <CookiesPanel
            loadCookies={loadCookies}
            deleteCookie={deleteCookie}
            requestAccess={requestCookieAccess}
          />
        )}
        {tab === "Storage" && <StoragePanel />}
      </PanelHost>

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
 * Resolves light or dark once, from the OS preference only.
 *
 * Cherry's own providers persist the choice by toggling a `dark` class on
 * <html> and writing localStorage — on the host page, which the inspector must
 * never modify. So the theme object is picked here and handed straight to
 * styled-components.
 */
function resolveTheme() {
  const prefersDark = window.matchMedia?.(
    "(prefers-color-scheme: dark)",
  ).matches;
  return prefersDark ? themeDark : lightTheme;
}

function bootstrap() {
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.dispatchEvent(new Event(SHOW_EVENT));
    return;
  }

  const activeTheme = resolveTheme();

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
    colorScheme: activeTheme.isDark ? "dark" : "light",
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
      <ThemeProvider theme={activeTheme}>
        <Inspector host={host} />
      </ThemeProvider>
    </StyleSheetManager>,
  );
}

bootstrap();
