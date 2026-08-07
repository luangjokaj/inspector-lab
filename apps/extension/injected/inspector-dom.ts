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

/** One stylesheet rule that applies to the inspected element. */
export type MatchedRule = {
  selector: string;
  /** Where the rule came from: the stylesheet file name, or `<style>`. */
  source: string;
  declarations: AttributeEntry[];
};

export type ElementSnapshot = {
  selector: string;
  tagName: string;
  id: string;
  className: string;
  attributes: AttributeEntry[];
  /** Declarations on the element's `style` attribute, for the Styles pane. */
  inlineStyles: AttributeEntry[];
  /** Stylesheet rules matching the element, most recently declared first. */
  matchedRules: MatchedRule[];
  /** Cross-origin stylesheets whose rules the inspector cannot read. */
  inaccessibleSheets: number;
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
      position: "fixed",
      zIndex: "2147483646",
      pointerEvents: "none",
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

/** Label a stylesheet by its file name; inline `<style>` blocks have none. */
function sheetLabel(sheet: CSSStyleSheet): string {
  if (!sheet.href) return "<style>";
  try {
    const path = new URL(sheet.href).pathname;
    return path.split("/").filter(Boolean).pop() ?? sheet.href;
  } catch {
    return sheet.href;
  }
}

/**
 * Collects the stylesheet rules that currently match `element`, descending
 * into conditional groups only when their condition holds right now. Rules
 * are returned most recently declared first — an approximation of the
 * cascade (true ordering would need specificity), matching how DevTools
 * lists the winning rules near the top. Cross-origin sheets throw on
 * `cssRules` access and are only counted.
 */
export function matchedCssRules(element: Element): {
  rules: MatchedRule[];
  inaccessible: number;
} {
  const rules: MatchedRule[] = [];
  let inaccessible = 0;

  const visit = (list: CSSRuleList, source: string) => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) {
        let matches = false;
        try {
          matches = element.matches(rule.selectorText);
        } catch {
          /* Selectors the engine cannot parse for matching are skipped. */
        }
        if (matches) {
          rules.push({
            selector: rule.selectorText,
            source,
            declarations: Array.from(rule.style).map((name) => ({
              name,
              value: rule.style.getPropertyValue(name),
            })),
          });
        }
        continue;
      }
      if (rule instanceof CSSMediaRule) {
        if (window.matchMedia(rule.conditionText).matches) {
          visit(rule.cssRules, source);
        }
        continue;
      }
      if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) visit(rule.cssRules, source);
        continue;
      }
      // Other grouping rules (@layer blocks, etc.) always apply.
      if (rule instanceof CSSGroupingRule) visit(rule.cssRules, source);
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.disabled) continue;
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      inaccessible += 1;
      continue;
    }
    visit(cssRules, sheetLabel(sheet));
  }

  return { rules: rules.reverse(), inaccessible };
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

  const { rules: matchedRules, inaccessible: inaccessibleSheets } =
    matchedCssRules(element);

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
    matchedRules,
    inaccessibleSheets,
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
