import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import styled, { StyleSheetManager, ThemeProvider } from "styled-components";
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
  isInspectorNode,
  snapshotElement,
  type ElementSnapshot,
} from "~injected/inspector-dom";
import { ElementsPanel } from "~injected/panels/elements-panel";
import {
  ConsolePanel,
  type ConsoleEntry,
  type ConsoleLevel,
} from "~injected/panels/console-panel";
import { SourcesPanel } from "~injected/panels/sources-panel";
import { NetworkPanel } from "~injected/panels/network-panel";

const MIN_WIDTH = 480;
const MIN_HEIGHT = 320;
const VIEWPORT_GUTTER = 12;

/** Tab order matches Chrome DevTools: Elements is always first. */
const TABS = ["Elements", "Console", "Sources", "Network"] as const;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
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
    setEntries((current) => [
      ...current,
      { id: nextEntryId.current++, level, text },
    ]);
  }, []);

  useLayoutEffect(() => {
    host.style.left = `${frame.left}px`;
    host.style.top = `${frame.top}px`;
    host.style.width = `${frame.width}px`;
    host.style.height = `${frame.height}px`;
  }, [frame, host]);

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
    const start = { x: event.clientX, y: event.clientY, frame };

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

  function beginResize(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY, frame };

    const move = (moveEvent: PointerEvent) => {
      setFrame((current) => ({
        ...current,
        width: clamp(
          start.frame.width + moveEvent.clientX - start.x,
          Math.min(MIN_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2),
          window.innerWidth - current.left - VIEWPORT_GUTTER,
        ),
        height: clamp(
          start.frame.height + moveEvent.clientY - start.y,
          Math.min(MIN_HEIGHT, window.innerHeight - VIEWPORT_GUTTER * 2),
          window.innerHeight - current.top - VIEWPORT_GUTTER,
        ),
      }));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
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

  function hideInspector() {
    setPicking(false);
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
            onApplyStyle={applyStyle}
          />
        )}
        {tab === "Console" && (
          <ConsolePanel
            entries={entries}
            onSubmit={(expression) => {
              log("input", expression);
              log(
                "result",
                "Expression evaluation is disabled in the in-page inspector.",
              );
            }}
            onClear={() => setEntries([])}
          />
        )}
        {tab === "Sources" && <SourcesPanel />}
        {tab === "Network" && <NetworkPanel />}
      </PanelHost>

      <ResizeHandle
        role="separator"
        aria-label="Resize inspector"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={beginResize}
        onKeyDown={resizeWithKeyboard}
      />
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
