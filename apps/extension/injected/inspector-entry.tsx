import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import styled, { StyleSheetManager } from "styled-components";
import {
  Button,
  CherryThemeProvider,
  Flex,
  Icon,
  IconButton,
  Input,
  alpha,
  styledCode,
  styledSmall,
  styledStrong,
  styledText,
} from "cherry-styled-components";
import { themeDark } from "~lib/theme";

const HOST_ID = "inspector-lab-extension-root";
const HIGHLIGHT_ID = "inspector-lab-element-highlight";
const SHOW_EVENT = "inspector-lab:show";
const MIN_WIDTH = 420;
const MIN_HEIGHT = 300;
const VIEWPORT_GUTTER = 12;

type Frame = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type AttributeEntry = { name: string; value: string };

type ElementSnapshot = {
  selector: string;
  tagName: string;
  id: string;
  className: string;
  attributes: AttributeEntry[];
  parentSelector: string | null;
  childSelectors: string[];
  text: string;
  rect: { width: number; height: number; x: number; y: number };
  styles: Record<string, string>;
};

const PanelShell = styled.section`
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: ${({ theme }) => theme.colors.dark};
  background:
    linear-gradient(
      135deg,
      ${({ theme }) => alpha(theme.colors.primary, 10)},
      transparent 38%
    ),
    ${({ theme }) => theme.colors.light};
  border: solid 1px ${({ theme }) => theme.colors.gray};
  border-radius: ${({ theme }) => theme.spacing.radius.lg};
  box-shadow: ${({ theme }) => theme.shadows.xl};
  box-sizing: border-box;
`;

const InstrumentBar = styled.header<{ $dragging: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  padding: 0 ${({ theme }) => theme.spacing.radius.lg};
  background: ${({ theme }) => alpha(theme.colors.light, 92)};
  border-bottom: solid 1px ${({ theme }) => theme.colors.grayLight};
  cursor: ${({ $dragging }) => ($dragging ? "grabbing" : "grab")};
  user-select: none;
  touch-action: none;
`;

const BrandMark = styled.span`
  display: inline-flex;
  width: ${({ theme }) => theme.spacing.radius.xs};
  height: ${({ theme }) => theme.spacing.radius.xs};
  border-radius: ${({ theme }) => theme.spacing.radius.xl};
  background: ${({ theme }) => theme.colors.primary};
  box-shadow: 0 0 0 ${({ theme }) => theme.spacing.radius.xs}
    ${({ theme }) => alpha(theme.colors.primary, 12)};
`;

const InstrumentName = styled.strong`
  ${({ theme }) => styledStrong(theme)};
  font-family: ${({ theme }) => theme.fonts.head};
  letter-spacing: 0.03em;
`;

const InstrumentMeta = styled.span`
  ${({ theme }) => styledSmall(theme)};
  color: ${({ theme }) => theme.colors.grayDark};
  font-family: ${({ theme }) => theme.fonts.mono};
`;

const Workspace = styled.div`
  display: grid;
  grid-template-columns: minmax(220px, 0.9fr) minmax(240px, 1.1fr);
  flex: 1;
  min-height: 0;
`;

const Pane = styled.div<{ $secondary?: boolean }>`
  min-width: 0;
  overflow: auto;
  padding: ${({ theme }) => theme.spacing.radius.lg};
  background: ${({ theme, $secondary }) =>
    $secondary ? alpha(theme.colors.grayLight, 26) : "transparent"};
  border-left: ${({ theme, $secondary }) =>
    $secondary ? `solid 1px ${theme.colors.grayLight}` : "none"};
`;

const SectionLabel = styled.h2`
  ${({ theme }) => styledSmall(theme)};
  margin: 0 0 ${({ theme }) => theme.spacing.radius.lg};
  color: ${({ theme }) => theme.colors.grayDark};
  font-family: ${({ theme }) => theme.fonts.mono};
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const EmptyState = styled.div`
  display: grid;
  place-items: center;
  min-height: 180px;
  padding: ${({ theme }) => theme.spacing.gridGap.xs};
  color: ${({ theme }) => theme.colors.grayDark};
  text-align: center;

  p {
    ${({ theme }) => styledText(theme)};
    margin: ${({ theme }) => theme.spacing.radius.lg} 0 0;
  }
`;

const Selector = styled.code`
  ${({ theme }) => styledCode(theme)};
  display: block;
  padding: ${({ theme }) => theme.spacing.radius.lg};
  overflow-wrap: anywhere;
  color: ${({ theme }) => theme.colors.primary};
  background: ${({ theme }) => alpha(theme.colors.primary, 9)};
  border: solid 1px ${({ theme }) => alpha(theme.colors.primary, 28)};
  border-radius: ${({ theme }) => theme.spacing.radius.xs};
`;

const MetricGrid = styled.dl`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${({ theme }) => theme.spacing.radius.xs};
  margin: ${({ theme }) => theme.spacing.radius.lg} 0;

  div {
    padding: ${({ theme }) => theme.spacing.radius.xs};
    background: ${({ theme }) => alpha(theme.colors.grayLight, 40)};
    border-radius: ${({ theme }) => theme.spacing.radius.xs};
  }

  dt {
    ${({ theme }) => styledSmall(theme)};
    color: ${({ theme }) => theme.colors.grayDark};
  }

  dd {
    ${({ theme }) => styledStrong(theme)};
    margin: 0;
    font-family: ${({ theme }) => theme.fonts.mono};
  }
`;

const DataList = styled.dl`
  display: grid;
  gap: ${({ theme }) => theme.spacing.radius.xs};
  margin: 0;

  div {
    display: grid;
    grid-template-columns: minmax(90px, 0.45fr) minmax(0, 1fr);
    gap: ${({ theme }) => theme.spacing.radius.xs};
    padding-bottom: ${({ theme }) => theme.spacing.radius.xs};
    border-bottom: solid 1px ${({ theme }) => theme.colors.grayLight};
  }

  dt,
  dd {
    ${({ theme }) => styledSmall(theme)};
    margin: 0;
    overflow-wrap: anywhere;
  }

  dt {
    color: ${({ theme }) => theme.colors.grayDark};
    font-family: ${({ theme }) => theme.fonts.mono};
  }
`;

const RelationList = styled.ul`
  display: grid;
  gap: ${({ theme }) => theme.spacing.radius.xs};
  margin: ${({ theme }) => theme.spacing.radius.lg} 0 0;
  padding: 0;
  list-style: none;

  li {
    ${({ theme }) => styledSmall(theme)};
    padding-left: ${({ theme }) => theme.spacing.radius.lg};
    color: ${({ theme }) => theme.colors.grayDark};
    font-family: ${({ theme }) => theme.fonts.mono};
    border-left: solid 2px ${({ theme }) => theme.colors.grayLight};
    overflow-wrap: anywhere;
  }
`;

const Editor = styled.form`
  display: grid;
  gap: ${({ theme }) => theme.spacing.radius.lg};
  margin-top: ${({ theme }) => theme.spacing.gridGap.xs};
  padding-top: ${({ theme }) => theme.spacing.gridGap.xs};
  border-top: solid 1px ${({ theme }) => theme.colors.grayLight};
`;

const Feedback = styled.p<{ $error?: boolean }>`
  ${({ theme }) => styledSmall(theme)};
  margin: 0;
  color: ${({ theme, $error }) =>
    $error ? theme.colors.error : theme.colors.success};
`;

const ResizeHandle = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  width: 26px;
  height: 26px;
  cursor: nwse-resize;
  touch-action: none;

  &::after {
    content: "";
    position: absolute;
    right: ${({ theme }) => theme.spacing.radius.xs};
    bottom: ${({ theme }) => theme.spacing.radius.xs};
    width: ${({ theme }) => theme.spacing.radius.lg};
    height: ${({ theme }) => theme.spacing.radius.lg};
    border-right: solid 2px ${({ theme }) => theme.colors.primary};
    border-bottom: solid 2px ${({ theme }) => theme.colors.primary};
  }

  &:focus-visible {
    outline: solid 2px ${({ theme }) => theme.colors.primary};
    outline-offset: -2px;
  }
`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function initialFrame(): Frame {
  const width = Math.min(720, window.innerWidth - VIEWPORT_GUTTER * 2);
  const height = Math.min(520, window.innerHeight - VIEWPORT_GUTTER * 2);

  return {
    left: Math.max(VIEWPORT_GUTTER, window.innerWidth - width - 24),
    top: 24,
    width,
    height,
  };
}

function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${CSS.escape(element.id)}` : "";
  const classes = Array.from(element.classList)
    .slice(0, 2)
    .map((name) => `.${CSS.escape(name)}`)
    .join("");
  return `${tag}${id}${classes}`;
}

function uniqueSelector(element: Element): string {
  if (element.id) return `#${CSS.escape(element.id)}`;

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement && parts.length < 4) {
    let part = current.tagName.toLowerCase();
    const classes = Array.from(current.classList).slice(0, 1);
    if (classes.length) part += `.${CSS.escape(classes[0])}`;

    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === current?.tagName,
      );
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }

    parts.unshift(part);
    current = parent;
  }

  return parts.join(" > ");
}

function snapshotElement(element: HTMLElement): ElementSnapshot {
  const computed = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const styleProperties = [
    "display",
    "position",
    "color",
    "background-color",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "margin",
    "padding",
    "border",
  ];

  return {
    selector: uniqueSelector(element),
    tagName: element.tagName.toLowerCase(),
    id: element.id,
    className: element.className,
    attributes: Array.from(element.attributes)
      .slice(0, 12)
      .map(({ name, value }) => ({ name, value })),
    parentSelector: element.parentElement
      ? describeElement(element.parentElement)
      : null,
    childSelectors: Array.from(element.children)
      .slice(0, 8)
      .map(describeElement),
    text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 180),
    rect: {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
    },
    styles: Object.fromEntries(
      styleProperties.map((property) => [
        property,
        computed.getPropertyValue(property),
      ]),
    ),
  };
}

function Inspector({ host }: { host: HTMLElement }) {
  const [frame, setFrame] = useState<Frame>(initialFrame);
  const [dragging, setDragging] = useState(false);
  const [picking, setPicking] = useState(false);
  const [snapshot, setSnapshot] = useState<ElementSnapshot | null>(null);
  const [property, setProperty] = useState("color");
  const [value, setValue] = useState("");
  const [feedback, setFeedback] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const selectedElement = useRef<HTMLElement | null>(null);

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

  useEffect(() => {
    if (!picking) return;

    const highlight = document.createElement("div");
    highlight.id = HIGHLIGHT_ID;
    Object.assign(highlight.style, {
      position: "fixed",
      zIndex: "2147483646",
      pointerEvents: "none",
      background: "rgba(46, 211, 195, 0.14)",
      border: "2px solid rgb(46, 211, 195)",
      boxSizing: "border-box",
      transition: "all 40ms linear",
    });
    document.documentElement.append(highlight);

    const candidateFromEvent = (event: Event): HTMLElement | null => {
      const candidate = event.composedPath()[0];
      if (!(candidate instanceof HTMLElement)) return null;
      if (candidate === host || host.contains(candidate)) return null;
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
      selectedElement.current = candidate;
      setSnapshot(snapshotElement(candidate));
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
  }, [host, picking]);

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

  function applyStyle(event: React.FormEvent) {
    event.preventDefault();
    const element = selectedElement.current;

    if (!element || !property.trim() || !value.trim()) {
      setFeedback({
        message: "Choose an element and enter a CSS rule.",
        error: true,
      });
      return;
    }

    if (!CSS.supports(property.trim(), value.trim())) {
      setFeedback({
        message: "That property/value pair is not valid CSS.",
        error: true,
      });
      return;
    }

    element.style.setProperty(property.trim(), value.trim());
    setSnapshot(snapshotElement(element));
    setFeedback({
      message: "Inline style applied to the selected element.",
      error: false,
    });
  }

  function hideInspector() {
    setPicking(false);
    host.style.display = "none";
  }

  return (
    <PanelShell aria-label="Inspector Lab in-page inspector">
      <InstrumentBar $dragging={dragging} onPointerDown={beginDrag}>
        <Flex $alignItems="center" $gap={12} $wrap="nowrap">
          <BrandMark />
          <div>
            <InstrumentName>Inspector Lab</InstrumentName>
            <InstrumentMeta>DOM / LIVE</InstrumentMeta>
          </div>
        </Flex>
        <Flex $alignItems="center" $gap={8} $wrap="nowrap">
          <IconButton
            aria-label={picking ? "Cancel element picker" : "Pick an element"}
            $active={picking}
            onClick={() => setPicking((active) => !active)}
          >
            <Icon
              name={picking ? "MousePointer2Off" : "MousePointer2"}
              size={16}
            />
          </IconButton>
          <IconButton aria-label="Close Inspector Lab" onClick={hideInspector}>
            <Icon name="X" size={16} />
          </IconButton>
        </Flex>
      </InstrumentBar>

      <Workspace>
        <Pane>
          <SectionLabel>Selected element</SectionLabel>
          {!snapshot ? (
            <EmptyState>
              <div>
                <Icon name="ScanSearch" size={28} />
                <p>Activate the picker, then click an element on the page.</p>
              </div>
            </EmptyState>
          ) : (
            <>
              <Selector>{snapshot.selector}</Selector>
              <MetricGrid>
                <div>
                  <dt>Size</dt>
                  <dd>
                    {snapshot.rect.width} × {snapshot.rect.height}
                  </dd>
                </div>
                <div>
                  <dt>Position</dt>
                  <dd>
                    {snapshot.rect.x}, {snapshot.rect.y}
                  </dd>
                </div>
              </MetricGrid>
              <DataList>
                <div>
                  <dt>tag</dt>
                  <dd>{snapshot.tagName}</dd>
                </div>
                {snapshot.id && (
                  <div>
                    <dt>id</dt>
                    <dd>{snapshot.id}</dd>
                  </div>
                )}
                {snapshot.className && (
                  <div>
                    <dt>class</dt>
                    <dd>{snapshot.className}</dd>
                  </div>
                )}
                {snapshot.text && (
                  <div>
                    <dt>text</dt>
                    <dd>{snapshot.text}</dd>
                  </div>
                )}
              </DataList>
              <RelationList>
                {snapshot.parentSelector && (
                  <li>parent → {snapshot.parentSelector}</li>
                )}
                {snapshot.childSelectors.map((child, index) => (
                  <li key={`${child}-${index}`}>child → {child}</li>
                ))}
              </RelationList>
            </>
          )}
        </Pane>

        <Pane $secondary>
          <SectionLabel>Computed styles</SectionLabel>
          {snapshot ? (
            <>
              <DataList>
                {Object.entries(snapshot.styles).map(([name, styleValue]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{styleValue || "—"}</dd>
                  </div>
                ))}
              </DataList>
              <Editor onSubmit={applyStyle}>
                <Input
                  id="inspector-property"
                  $label="CSS property"
                  $size="small"
                  $fullWidth
                  value={property}
                  onChange={(event) => setProperty(event.target.value)}
                />
                <Input
                  id="inspector-value"
                  $label="Value"
                  $size="small"
                  $fullWidth
                  placeholder="e.g. tomato or 24px"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
                <Button $size="small" $fullWidth type="submit">
                  Apply inline style
                </Button>
                {feedback && (
                  <Feedback $error={feedback.error} role="status">
                    {feedback.message}
                  </Feedback>
                )}
              </Editor>
            </>
          ) : (
            <EmptyState>
              <p>Computed values and a live CSS editor will appear here.</p>
            </EmptyState>
          )}
        </Pane>
      </Workspace>

      <ResizeHandle
        role="separator"
        aria-label="Resize inspector"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={beginResize}
        onKeyDown={resizeWithKeyboard}
      />
    </PanelShell>
  );
}

function bootstrap() {
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.dispatchEvent(new Event(SHOW_EVENT));
    return;
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
    colorScheme: "dark",
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
      <CherryThemeProvider theme={themeDark}>
        <Inspector host={host} />
      </CherryThemeProvider>
    </StyleSheetManager>,
  );
}

bootstrap();
