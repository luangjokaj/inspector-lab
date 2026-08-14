/**
 * DOM plumbing shared by the injected inspector shell and its panels.
 *
 * Everything here reads the host page, which is untrusted: values are only
 * ever returned as plain strings for React to render as text. Nothing in the
 * inspector interpolates host content into markup.
 */

import { FOREIGN_LAYER_ID } from "~injected/xml-compat";
import {
  collectElementStyles,
  type DeclarationStatus,
  type InheritedStyleSection,
  type MatchedRule,
  type StyleDeclaration,
} from "~injected/inspector-styles";

export type {
  DeclarationStatus,
  InheritedStyleSection,
  MatchedRule,
  StyleDeclaration,
};

export const HOST_ID = "inspector-lab-extension-root";
/** The `<foreignObject>` the inspector renders into on SVG documents, where
 *  HTML children of the root `<svg>` would never render. Lives in xml-compat
 *  (which must import nothing); re-exported here for the rest of the code. */
export { FOREIGN_LAYER_ID };
export const HIGHLIGHT_ID = "inspector-lab-element-highlight";
export const HOVER_HIGHLIGHT_ID = "inspector-lab-hover-highlight";
/** The fallback `<style>` tag of the forced-state engine (state-styles.ts). */
export const STATE_STYLE_ID = "inspector-lab-state-styles";
export const SHOW_EVENT = "inspector-lab:show";

export type AttributeEntry = { name: string; value: string };

export type ElementSnapshot = {
  selector: string;
  tagName: string;
  id: string;
  className: string;
  attributes: AttributeEntry[];
  /** Declarations on the element's `style` attribute, for the Styles pane. */
  inlineStyles: StyleDeclaration[];
  /** Stylesheet rules matching the element, most recently declared first. */
  matchedRules: MatchedRule[];
  /** Author rules on ancestors, nearest ancestor first. */
  inheritedRules: InheritedStyleSection[];
  /** Cross-origin stylesheets whose rules the inspector cannot read. */
  inaccessibleSheets: number;
  /** A hostile or exceptionally large page exceeded the safe rule budget. */
  stylesTruncated: boolean;
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

const INSPECTOR_NODE_IDS: readonly string[] = [
  HOST_ID,
  FOREIGN_LAYER_ID,
  HIGHLIGHT_ID,
  HOVER_HIGHLIGHT_ID,
  STATE_STYLE_ID,
];

/** The inspector must never show or select its own injected nodes. */
export function isInspectorNode(node: Element): boolean {
  return INSPECTOR_NODE_IDS.includes(node.id);
}

/**
 * The element's live markup, minus the inspector's own nodes — what "copy
 * this element" should put on the clipboard. Serialized from a clone so the
 * page DOM is never touched.
 */
export function serializeElement(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const id of INSPECTOR_NODE_IDS) {
    clone.querySelector(`#${id}`)?.remove();
  }
  return clone.outerHTML;
}

/**
 * An element whose inline `style` the inspector can read and edit. HTML and
 * SVG elements both carry CSSStyleDeclaration; the DOM offers no shared base
 * type between them.
 */
export type StylableElement = HTMLElement | SVGElement;

let overlayParent: Element | null = null;

/**
 * Where the inspector's fixed-position chrome (the picker and hover
 * highlights) is appended. document.documentElement in HTML documents; on SVG
 * documents bootstrap() points this at the foreignObject layer, since HTML
 * elements appended to the `<svg>` root are never rendered.
 */
export function setOverlayRoot(element: Element): void {
  overlayParent = element;
}

export function getOverlayRoot(): Element {
  return overlayParent ?? document.documentElement;
}

/**
 * The `position` for viewport-anchored overlay chrome. Fixed on HTML
 * documents; inside the foreignObject layer, absolute — the geometry is
 * identical (the layer is a viewport-sized containing block), but WebKit's
 * fixed-inside-foreignObject rendering is buggy and absolute stays off that
 * path.
 */
export function overlayPosition(): "fixed" | "absolute" {
  return overlayParent ? "absolute" : "fixed";
}

let hoverBox: HTMLDivElement | null = null;

/** Overlay paint, sourced from `theme.devtools.highlightFill` / `Border`. */
export type HighlightColors = { fill: string; border: string };

/**
 * Paints the picker-style overlay over `element` on the host page — used when
 * hovering rows in the Elements tree. Pass null to clear. The overlay is a
 * singleton and position: fixed, so it needs no cleanup on scroll; it is
 * repositioned or removed on the next call. Colors are re-applied on every
 * paint so a theme change recolors an already-visible box.
 */
export function highlightElement(
  element: Element | null,
  colors?: HighlightColors,
): void {
  if (!element || isInspectorNode(element) || !element.isConnected) {
    hoverBox?.remove();
    hoverBox = null;
    return;
  }

  if (!hoverBox || !hoverBox.isConnected) {
    hoverBox = document.createElement("div");
    hoverBox.id = HOVER_HIGHLIGHT_ID;
    Object.assign(hoverBox.style, {
      position: overlayPosition(),
      zIndex: "2147483646",
      pointerEvents: "none",
      boxSizing: "border-box",
      transition: "all 40ms linear",
    });
    getOverlayRoot().append(hoverBox);
  }

  const rect = element.getBoundingClientRect();
  Object.assign(hoverBox.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  if (colors) {
    Object.assign(hoverBox.style, {
      background: colors.fill,
      border: `1px solid ${colors.border}`,
    });
  }
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

export function snapshotElement(element: StylableElement): ElementSnapshot {
  const computed = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  const computedEntries: AttributeEntry[] = Array.from(computed)
    .map((name) => ({ name, value: computed.getPropertyValue(name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const styles = collectElementStyles(element, STATE_STYLE_ID);

  return {
    selector: uniqueSelector(element),
    tagName: element.tagName.toLowerCase(),
    id: element.id,
    className: typeof element.className === "string" ? element.className : "",
    attributes: Array.from(element.attributes).map(({ name, value }) => ({
      name,
      value,
    })),
    inlineStyles: styles.inlineStyles,
    matchedRules: styles.matchedRules,
    inheritedRules: styles.inheritedRules,
    inaccessibleSheets: styles.inaccessibleSheets,
    stylesTruncated: styles.stylesTruncated,
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
