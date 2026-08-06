/**
 * DOM plumbing shared by the injected inspector shell and its panels.
 *
 * Everything here reads the host page, which is untrusted: values are only
 * ever returned as plain strings for React to render as text. Nothing in the
 * inspector interpolates host content into markup.
 */

export const HOST_ID = "inspector-lab-extension-root";
export const HIGHLIGHT_ID = "inspector-lab-element-highlight";
export const HOVER_HIGHLIGHT_ID = "inspector-lab-hover-highlight";
export const SHOW_EVENT = "inspector-lab:show";

export type AttributeEntry = { name: string; value: string };

export type ElementSnapshot = {
  selector: string;
  tagName: string;
  id: string;
  className: string;
  attributes: AttributeEntry[];
  /** Declarations on the element's `style` attribute, for the Styles pane. */
  inlineStyles: AttributeEntry[];
  /** Every resolved property, sorted, for the Computed pane. */
  computed: AttributeEntry[];
  text: string;
  rect: { width: number; height: number; x: number; y: number };
};

/** HTML elements that never have a closing tag in the Elements tree. */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export function isVoidElement(element: Element): boolean {
  return VOID_ELEMENTS.has(element.tagName.toLowerCase());
}

/** The inspector must never show or select its own injected nodes. */
export function isInspectorNode(node: Element): boolean {
  return (
    node.id === HOST_ID ||
    node.id === HIGHLIGHT_ID ||
    node.id === HOVER_HIGHLIGHT_ID
  );
}

let hoverBox: HTMLDivElement | null = null;

/**
 * Paints the picker-style overlay over `element` on the host page — used when
 * hovering rows in the Elements tree. Pass null to clear. The overlay is a
 * singleton and position: fixed, so it needs no cleanup on scroll; it is
 * repositioned or removed on the next call.
 */
export function highlightElement(element: Element | null): void {
  if (!element || isInspectorNode(element) || !element.isConnected) {
    hoverBox?.remove();
    hoverBox = null;
    return;
  }

  if (!hoverBox || !hoverBox.isConnected) {
    hoverBox = document.createElement("div");
    hoverBox.id = HOVER_HIGHLIGHT_ID;
    Object.assign(hoverBox.style, {
      position: "fixed",
      zIndex: "2147483646",
      pointerEvents: "none",
      background: "rgba(111, 168, 220, 0.66)",
      border: "1px solid rgba(255, 229, 153, 0.9)",
      boxSizing: "border-box",
      transition: "all 40ms linear",
    });
    document.documentElement.append(hoverBox);
  }

  const rect = element.getBoundingClientRect();
  Object.assign(hoverBox.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
}

/** Child elements of `node`, minus the inspector's own DOM. */
export function visibleChildren(node: Element): Element[] {
  return Array.from(node.children).filter((child) => !isInspectorNode(child));
}

/** Collapses runs of whitespace so a text node fits on one tree row. */
export function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * The text a node shows inline in the tree — only for elements with no element
 * children, matching how DevTools renders `<h1>Title</h1>` on a single row.
 */
export function inlineText(element: Element): string {
  if (visibleChildren(element).length > 0) return "";
  return collapseWhitespace(element.textContent ?? "");
}

/** Short, human-readable label for an element: `div#app.card`. */
export function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${CSS.escape(element.id)}` : "";
  const classes = Array.from(element.classList)
    .slice(0, 2)
    .map((name) => `.${CSS.escape(name)}`)
    .join("");
  return `${tag}${id}${classes}`;
}

/** A selector that resolves back to this element, for the Styles pane header. */
export function uniqueSelector(element: Element): string {
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

/** The element's ancestor chain, outermost first, for the breadcrumb bar. */
export function ancestorChain(element: Element): Element[] {
  const chain: Element[] = [];
  let current: Element | null = element;

  while (current) {
    chain.unshift(current);
    current = current.parentElement;
  }

  return chain;
}

export function snapshotElement(element: HTMLElement): ElementSnapshot {
  const computed = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  const computedEntries: AttributeEntry[] = Array.from(computed)
    .map((name) => ({ name, value: computed.getPropertyValue(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const inlineStyles: AttributeEntry[] = Array.from(element.style).map(
    (name) => ({ name, value: element.style.getPropertyValue(name) }),
  );

  return {
    selector: uniqueSelector(element),
    tagName: element.tagName.toLowerCase(),
    id: element.id,
    className: typeof element.className === "string" ? element.className : "",
    attributes: Array.from(element.attributes).map(({ name, value }) => ({
      name,
      value,
    })),
    inlineStyles,
    computed: computedEntries,
    text: truncate(collapseWhitespace(element.textContent ?? ""), 180),
    rect: {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
    },
  };
}
