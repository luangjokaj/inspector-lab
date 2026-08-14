/**
 * Author-style collection for the Elements sidebar.
 *
 * The page CSSOM exposes author rules but not Chrome's resolved cascade model,
 * user-agent rules, or cross-origin rule bodies. This module reconstructs the
 * useful author-origin subset without requesting debugger privileges, and
 * marks contextual rules as unknown when CSSOM cannot prove they are active.
 */

export type DeclarationStatus =
  | "active"
  | "overridden"
  | "partially-overridden"
  | "not-inherited"
  | "unknown";

export type StyleDeclaration = {
  name: string;
  value: string;
  priority: "" | "important";
  status: DeclarationStatus;
};

export type MatchedRule = {
  selector: string;
  source: string;
  sourceHref: string | null;
  inlineIndex: number | null;
  sourceLinkable: boolean;
  contexts: string[];
  declarations: StyleDeclaration[];
};

export type InheritedStyleSection = {
  element: string;
  inlineStyles: StyleDeclaration[];
  matchedRules: MatchedRule[];
};

export type ElementStyleSnapshot = {
  inlineStyles: StyleDeclaration[];
  matchedRules: MatchedRule[];
  inheritedRules: InheritedStyleSection[];
  inaccessibleSheets: number;
  stylesTruncated: boolean;
};

type Specificity = readonly [number, number, number];

type Candidate = {
  declaration: StyleDeclaration;
  affected: string[];
  important: boolean;
  inline: boolean;
  specificity: Specificity | null;
  sourceOrder: number;
  uncertain: boolean;
};

type CollectionState = {
  inaccessible: Set<CSSStyleSheet>;
  ruleCount: number;
  sourceOrder: number;
  truncated: boolean;
};

type SheetReference = {
  sheet: CSSStyleSheet;
  source: string;
  sourceHref: string | null;
  inlineIndex: number | null;
  sourceLinkable: boolean;
};

const MAX_VISITED_RULES = 10000;
const INSPECTOR_STYLESHEETS = new WeakSet<CSSStyleSheet>();

/** Keeps constructable inspector sheets out of the page-authored rule list. */
export function registerInspectorStyleSheet(sheet: CSSStyleSheet): void {
  INSPECTOR_STYLESHEETS.add(sheet);
}

/** Properties inherited by default, including the SVG presentation subset. */
const INHERITED_PROPERTIES = new Set([
  "azimuth",
  "accent-color",
  "border-collapse",
  "border-spacing",
  "caption-side",
  "caret-color",
  "color",
  "color-scheme",
  "color-interpolation",
  "color-interpolation-filters",
  "color-rendering",
  "cursor",
  "direction",
  "dominant-baseline",
  "empty-cells",
  "fill",
  "fill-opacity",
  "fill-rule",
  "font",
  "font-family",
  "font-feature-settings",
  "font-kerning",
  "font-language-override",
  "font-optical-sizing",
  "font-palette",
  "font-size",
  "font-size-adjust",
  "font-stretch",
  "font-style",
  "font-synthesis",
  "font-variant",
  "font-variant-alternates",
  "font-variant-caps",
  "font-variant-east-asian",
  "font-variant-emoji",
  "font-variant-ligatures",
  "font-variant-numeric",
  "font-variant-position",
  "font-variation-settings",
  "font-weight",
  "hyphens",
  "image-rendering",
  "letter-spacing",
  "line-break",
  "line-height",
  "list-style",
  "list-style-image",
  "list-style-position",
  "list-style-type",
  "marker",
  "marker-end",
  "marker-mid",
  "marker-start",
  "orphans",
  "overflow-wrap",
  "paint-order",
  "pointer-events",
  "quotes",
  "ruby-position",
  "shape-rendering",
  "speak",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "tab-size",
  "text-align",
  "text-align-last",
  "text-anchor",
  "text-indent",
  "text-justify",
  "text-rendering",
  "text-shadow",
  "text-transform",
  "text-wrap",
  "visibility",
  "white-space",
  "widows",
  "word-break",
  "word-spacing",
  "word-wrap",
  "writing-mode",
  "-webkit-text-fill-color",
  "-webkit-text-stroke-color",
  "-webkit-text-stroke-width",
]);

/** Common shorthands whose longhands participate independently in cascade. */
const SHORTHANDS: Record<string, readonly string[]> = {
  background: [
    "background-attachment",
    "background-blend-mode",
    "background-clip",
    "background-color",
    "background-image",
    "background-origin",
    "background-position",
    "background-repeat",
    "background-size",
  ],
  border: [
    "border-bottom-color",
    "border-bottom-style",
    "border-bottom-width",
    "border-left-color",
    "border-left-style",
    "border-left-width",
    "border-right-color",
    "border-right-style",
    "border-right-width",
    "border-top-color",
    "border-top-style",
    "border-top-width",
  ],
  "border-bottom": [
    "border-bottom-color",
    "border-bottom-style",
    "border-bottom-width",
  ],
  "border-color": [
    "border-bottom-color",
    "border-left-color",
    "border-right-color",
    "border-top-color",
  ],
  "border-left": [
    "border-left-color",
    "border-left-style",
    "border-left-width",
  ],
  "border-radius": [
    "border-bottom-left-radius",
    "border-bottom-right-radius",
    "border-top-left-radius",
    "border-top-right-radius",
  ],
  "border-right": [
    "border-right-color",
    "border-right-style",
    "border-right-width",
  ],
  "border-style": [
    "border-bottom-style",
    "border-left-style",
    "border-right-style",
    "border-top-style",
  ],
  "border-width": [
    "border-bottom-width",
    "border-left-width",
    "border-right-width",
    "border-top-width",
  ],
  "border-top": ["border-top-color", "border-top-style", "border-top-width"],
  columns: ["column-count", "column-width"],
  flex: ["flex-basis", "flex-grow", "flex-shrink"],
  "flex-flow": ["flex-direction", "flex-wrap"],
  font: [
    "font-family",
    "font-size",
    "font-stretch",
    "font-style",
    "font-variant",
    "font-weight",
    "line-height",
  ],
  gap: ["column-gap", "row-gap"],
  grid: [
    "grid-auto-columns",
    "grid-auto-flow",
    "grid-auto-rows",
    "grid-template-areas",
    "grid-template-columns",
    "grid-template-rows",
  ],
  "grid-area": [
    "grid-column-end",
    "grid-column-start",
    "grid-row-end",
    "grid-row-start",
  ],
  "grid-column": ["grid-column-end", "grid-column-start"],
  "grid-row": ["grid-row-end", "grid-row-start"],
  "list-style": ["list-style-image", "list-style-position", "list-style-type"],
  inset: ["bottom", "left", "right", "top"],
  margin: ["margin-bottom", "margin-left", "margin-right", "margin-top"],
  marker: ["marker-end", "marker-mid", "marker-start"],
  outline: ["outline-color", "outline-style", "outline-width"],
  overflow: ["overflow-x", "overflow-y"],
  padding: ["padding-bottom", "padding-left", "padding-right", "padding-top"],
  "place-content": ["align-content", "justify-content"],
  "place-items": ["align-items", "justify-items"],
  "place-self": ["align-self", "justify-self"],
  "text-decoration": [
    "text-decoration-color",
    "text-decoration-line",
    "text-decoration-style",
    "text-decoration-thickness",
  ],
  transition: [
    "transition-behavior",
    "transition-delay",
    "transition-duration",
    "transition-property",
    "transition-timing-function",
  ],
  "-webkit-text-stroke": [
    "-webkit-text-stroke-color",
    "-webkit-text-stroke-width",
  ],
};

function affectedProperties(name: string): string[] {
  return [...(SHORTHANDS[name] ?? [name])];
}

function isInherited(name: string): boolean {
  return name.startsWith("--") || INHERITED_PROPERTIES.has(name);
}

function inheritanceParent(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function elementLabel(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${CSS.escape(element.id)}` : "";
  const classes = Array.from(element.classList)
    .slice(0, 2)
    .map((name) => `.${CSS.escape(name)}`)
    .join("");
  return `${tag}${id}${classes}`;
}

function sheetLabel(sheet: CSSStyleSheet): string {
  if (!sheet.href) return "<style>";
  try {
    const path = new URL(sheet.href).pathname;
    return path.split("/").filter(Boolean).pop() ?? sheet.href;
  } catch {
    return sheet.href;
  }
}

function styleTagIndexes(stateStyleId: string): WeakMap<Node, number> {
  const indexes = new WeakMap<Node, number>();
  let index = 0;
  document.querySelectorAll("style").forEach((style) => {
    if (style.id === stateStyleId) return;
    indexes.set(style, index);
    index += 1;
  });
  return indexes;
}

function sheetsFor(
  element: Element,
  stateStyleId: string,
  inlineIndexes: WeakMap<Node, number>,
): SheetReference[] {
  const root = element.getRootNode();
  const references: SheetReference[] = [];
  const ordinary: CSSStyleSheet[] = [];

  if (root instanceof Document) {
    ordinary.push(...Array.from(root.styleSheets));
  } else if (root instanceof ShadowRoot) {
    const withSheets = root as ShadowRoot & { styleSheets?: StyleSheetList };
    if (withSheets.styleSheets) {
      ordinary.push(...Array.from(withSheets.styleSheets));
    } else {
      root
        .querySelectorAll("style, link[rel~='stylesheet']")
        .forEach((node) => {
          const sheet = (node as HTMLStyleElement | HTMLLinkElement).sheet;
          if (sheet) ordinary.push(sheet);
        });
    }
  }

  for (const sheet of ordinary) {
    if (INSPECTOR_STYLESHEETS.has(sheet)) continue;
    const owner = sheet.ownerNode;
    if (owner instanceof Element && owner.id === stateStyleId) continue;
    references.push({
      sheet,
      source: sheetLabel(sheet),
      sourceHref: sheet.href,
      inlineIndex:
        root instanceof Document && owner
          ? (inlineIndexes.get(owner) ?? null)
          : null,
      sourceLinkable:
        sheet.href !== null ||
        (root instanceof Document &&
          owner !== null &&
          inlineIndexes.has(owner)),
    });
  }

  const adopted =
    "adoptedStyleSheets" in root
      ? Array.from(root.adoptedStyleSheets as readonly CSSStyleSheet[])
      : [];
  adopted.forEach((sheet, index) => {
    if (INSPECTOR_STYLESHEETS.has(sheet)) return;
    references.push({
      sheet,
      source: `adopted stylesheet ${index + 1}`,
      sourceHref: null,
      inlineIndex: null,
      sourceLinkable: false,
    });
  });

  return references;
}

function splitTopLevel(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let quote = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") round += 1;
    else if (character === ")") round = Math.max(0, round - 1);
    else if (character === "[") square += 1;
    else if (character === "]") square = Math.max(0, square - 1);
    else if (character === delimiter && round === 0 && square === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function addSpecificity(left: Specificity, right: Specificity): Specificity {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function compareSpecificity(left: Specificity, right: Specificity): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function maxSpecificity(values: Specificity[]): Specificity {
  return values.reduce<Specificity>(
    (highest, value) =>
      compareSpecificity(value, highest) > 0 ? value : highest,
    [0, 0, 0],
  );
}

function matchingParen(value: string, open: number): number {
  let depth = 1;
  let quote = "";
  for (let index = open + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function selectorSpecificity(selector: string): Specificity | null {
  let specificity: Specificity = [0, 0, 0];
  let expectsType = true;

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (/\s|[>+~,]/.test(character)) {
      expectsType = true;
      continue;
    }
    if (character === "&") return null;
    if (character === "*") {
      expectsType = false;
      continue;
    }
    if (character === "[") {
      let quote = "";
      for (index += 1; index < selector.length; index += 1) {
        const nested = selector[index];
        if (quote) {
          if (nested === "\\") index += 1;
          else if (nested === quote) quote = "";
        } else if (nested === '"' || nested === "'") quote = nested;
        else if (nested === "]") break;
      }
      specificity = addSpecificity(specificity, [0, 1, 0]);
      expectsType = false;
      continue;
    }
    if (character === "#" || character === ".") {
      specificity = addSpecificity(
        specificity,
        character === "#" ? [1, 0, 0] : [0, 1, 0],
      );
      while (
        index + 1 < selector.length &&
        /[-_\w\\]/.test(selector[index + 1])
      ) {
        index += selector[index + 1] === "\\" ? 2 : 1;
      }
      expectsType = false;
      continue;
    }
    if (character === ":") {
      const pseudoElement = selector[index + 1] === ":";
      if (pseudoElement) index += 1;
      const nameStart = index + 1;
      let nameEnd = nameStart;
      while (nameEnd < selector.length && /[-\w]/.test(selector[nameEnd])) {
        nameEnd += 1;
      }
      const name = selector.slice(nameStart, nameEnd).toLowerCase();
      index = nameEnd - 1;

      if (pseudoElement) {
        specificity = addSpecificity(specificity, [0, 0, 1]);
        expectsType = false;
        continue;
      }

      if (selector[nameEnd] !== "(") {
        specificity = addSpecificity(specificity, [0, 1, 0]);
        expectsType = false;
        continue;
      }

      const close = matchingParen(selector, nameEnd);
      if (close < 0) return null;
      const argument = selector.slice(nameEnd + 1, close);
      if (!["has", "is", "not", "where"].includes(name)) {
        specificity = addSpecificity(specificity, [0, 1, 0]);
      }
      if (name === "is" || name === "not" || name === "has") {
        const values = splitTopLevel(argument, ",")
          .map((part) => selectorSpecificity(part.trim()))
          .filter((value): value is Specificity => value !== null);
        if (values.length) {
          specificity = addSpecificity(specificity, maxSpecificity(values));
        }
      } else if (name === "nth-child" || name === "nth-last-child") {
        const ofMatch = /\bof\b/i.exec(argument);
        if (ofMatch) {
          const values = splitTopLevel(
            argument.slice(ofMatch.index + ofMatch[0].length),
            ",",
          )
            .map((part) => selectorSpecificity(part.trim()))
            .filter((value): value is Specificity => value !== null);
          if (values.length) {
            specificity = addSpecificity(specificity, maxSpecificity(values));
          }
        }
      }
      index = close;
      expectsType = false;
      continue;
    }
    if (expectsType && /[a-zA-Z_\\-]/.test(character)) {
      specificity = addSpecificity(specificity, [0, 0, 1]);
      while (
        index + 1 < selector.length &&
        /[-_\w\\|]/.test(selector[index + 1])
      ) {
        index += selector[index + 1] === "\\" ? 2 : 1;
      }
      expectsType = false;
    }
  }

  return specificity;
}

function matchingSpecificity(
  selectorText: string,
  element: Element,
): Specificity | null {
  const matches: Specificity[] = [];
  for (const selector of splitTopLevel(selectorText, ",")) {
    try {
      if (!element.matches(selector.trim())) continue;
    } catch {
      continue;
    }
    const specificity = selectorSpecificity(selector.trim());
    if (specificity) matches.push(specificity);
  }
  return matches.length ? maxSpecificity(matches) : null;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  if (left.important !== right.important) return left.important ? 1 : -1;
  if (left.inline !== right.inline) return left.inline ? 1 : -1;
  if (left.specificity && right.specificity) {
    const specificity = compareSpecificity(left.specificity, right.specificity);
    if (specificity) return specificity;
  } else if (left.specificity !== right.specificity) {
    return left.specificity ? 1 : -1;
  }
  return left.sourceOrder - right.sourceOrder;
}

function classifyLocal(candidates: Candidate[]): void {
  const winners = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (candidate.uncertain) continue;
    for (const property of candidate.affected) {
      const current = winners.get(property);
      if (!current || compareCandidates(candidate, current) >= 0) {
        winners.set(property, candidate);
      }
    }
  }

  for (const candidate of candidates) {
    if (candidate.uncertain) {
      candidate.declaration.status = "unknown";
      continue;
    }
    const won = candidate.affected.filter(
      (property) => winners.get(property) === candidate,
    ).length;
    candidate.declaration.status =
      won === 0
        ? "overridden"
        : won === candidate.affected.length
          ? "active"
          : "partially-overridden";
  }
}

function declarationEntries(
  style: CSSStyleDeclaration,
  candidateBase: Omit<
    Candidate,
    "affected" | "declaration" | "important" | "sourceOrder"
  >,
  state: CollectionState,
  candidates: Candidate[],
): StyleDeclaration[] {
  return Array.from(style).map((name) => {
    const priority =
      style.getPropertyPriority(name) === "important" ? "important" : "";
    const declaration: StyleDeclaration = {
      name,
      value: style.getPropertyValue(name).trim(),
      priority,
      status: "active",
    };
    state.sourceOrder += 1;
    candidates.push({
      ...candidateBase,
      declaration,
      affected: affectedProperties(name),
      important: priority === "important",
      sourceOrder: state.sourceOrder,
    });
    return declaration;
  });
}

function groupHeader(rule: CSSRule): string {
  const brace = rule.cssText.indexOf("{");
  return (brace < 0 ? rule.cssText : rule.cssText.slice(0, brace)).trim();
}

function visitRules(
  list: CSSRuleList,
  element: Element,
  reference: Omit<SheetReference, "sheet">,
  contexts: string[],
  uncertain: boolean,
  state: CollectionState,
  rules: MatchedRule[],
  candidates: Candidate[],
): void {
  for (const rule of Array.from(list)) {
    if (state.ruleCount >= MAX_VISITED_RULES) {
      state.truncated = true;
      return;
    }
    state.ruleCount += 1;

    const styleRule = rule as CSSRule & {
      selectorText?: string;
      style?: CSSStyleDeclaration;
      cssRules?: CSSRuleList;
    };
    if (typeof styleRule.selectorText === "string" && styleRule.style) {
      const specificity = matchingSpecificity(styleRule.selectorText, element);
      if (specificity) {
        rules.push({
          selector: styleRule.selectorText,
          ...reference,
          contexts,
          declarations: declarationEntries(
            styleRule.style,
            {
              inline: false,
              specificity,
              uncertain,
            },
            state,
            candidates,
          ),
        });
      }
      // A nested style rule can carry declarations and child style rules.
      if (styleRule.cssRules) {
        visitRules(
          styleRule.cssRules,
          element,
          reference,
          contexts,
          true,
          state,
          rules,
          candidates,
        );
      }
      continue;
    }

    const importRule = rule as CSSRule & {
      styleSheet?: CSSStyleSheet;
      media?: MediaList;
    };
    if (groupHeader(rule).startsWith("@import") && importRule.styleSheet) {
      const media = importRule.media?.mediaText.trim();
      if (media && !window.matchMedia(media).matches) continue;
      let importedRules: CSSRuleList;
      try {
        importedRules = importRule.styleSheet.cssRules;
      } catch {
        state.inaccessible.add(importRule.styleSheet);
        continue;
      }
      visitRules(
        importedRules,
        element,
        {
          source: sheetLabel(importRule.styleSheet),
          sourceHref: importRule.styleSheet.href,
          inlineIndex: null,
          sourceLinkable: false,
        },
        contexts,
        uncertain,
        state,
        rules,
        candidates,
      );
      continue;
    }

    const grouping = rule as CSSRule & {
      conditionText?: string;
      cssRules?: CSSRuleList;
    };
    if (!grouping.cssRules) continue;
    const header = groupHeader(rule);
    if (header.startsWith("@media")) {
      const condition = grouping.conditionText ?? header.slice(6).trim();
      if (!window.matchMedia(condition).matches) continue;
    } else if (header.startsWith("@supports")) {
      const condition = grouping.conditionText ?? header.slice(9).trim();
      try {
        if (!CSS.supports(condition)) continue;
      } catch {
        continue;
      }
    }
    const contextUnknown =
      uncertain ||
      header.startsWith("@container") ||
      header.startsWith("@layer") ||
      header.startsWith("@scope");
    visitRules(
      grouping.cssRules,
      element,
      reference,
      [...contexts, header],
      contextUnknown,
      state,
      rules,
      candidates,
    );
  }
}

function collectSection(
  element: Element,
  stateStyleId: string,
  inlineIndexes: WeakMap<Node, number>,
  state: CollectionState,
): InheritedStyleSection {
  const matchedRules: MatchedRule[] = [];
  const candidates: Candidate[] = [];

  for (const reference of sheetsFor(element, stateStyleId, inlineIndexes)) {
    if (state.truncated) break;
    if (reference.sheet.disabled) continue;
    const media = reference.sheet.media.mediaText.trim();
    if (media && !window.matchMedia(media).matches) continue;
    let cssRules: CSSRuleList;
    try {
      cssRules = reference.sheet.cssRules;
    } catch {
      state.inaccessible.add(reference.sheet);
      continue;
    }
    visitRules(
      cssRules,
      element,
      {
        source: reference.source,
        sourceHref: reference.sourceHref,
        inlineIndex: reference.inlineIndex,
        sourceLinkable: reference.sourceLinkable,
      },
      [],
      false,
      state,
      matchedRules,
      candidates,
    );
  }

  const inlineStyle = (element as HTMLElement | SVGElement).style;
  const inlineStyles = inlineStyle
    ? declarationEntries(
        inlineStyle,
        { inline: true, specificity: [1, 0, 0], uncertain: false },
        state,
        candidates,
      )
    : [];

  classifyLocal(candidates);
  return {
    element: elementLabel(element),
    inlineStyles,
    // Later source rules are closer to the top, as in Chrome's Styles pane.
    matchedRules: matchedRules.reverse(),
  };
}

function activeProperties(section: InheritedStyleSection): string[] {
  const declarations = [
    ...section.inlineStyles,
    ...section.matchedRules.flatMap((rule) => rule.declarations),
  ];
  return declarations
    .filter(
      (declaration) =>
        declaration.status === "active" ||
        declaration.status === "partially-overridden",
    )
    .filter((declaration) => !continuesInheritance(declaration))
    .flatMap((declaration) => affectedProperties(declaration.name));
}

function continuesInheritance(declaration: StyleDeclaration): boolean {
  return /^(?:inherit|revert|revert-layer|unset)$/i.test(
    declaration.value.trim(),
  );
}

function applyInheritance(
  section: InheritedStyleSection,
  blocked: Set<string>,
): void {
  const declarations = [
    ...section.inlineStyles,
    ...section.matchedRules.flatMap((rule) => rule.declarations),
  ];
  for (const declaration of declarations) {
    if (
      declaration.status === "overridden" ||
      declaration.status === "unknown"
    ) {
      continue;
    }
    const affected = affectedProperties(declaration.name);
    const inherited = affected.filter(isInherited);
    if (inherited.length === 0) {
      declaration.status = "not-inherited";
      continue;
    }
    const available = inherited.filter((property) => !blocked.has(property));
    declaration.status =
      available.length === 0
        ? "overridden"
        : available.length === inherited.length
          ? "active"
          : "partially-overridden";
    if (!continuesInheritance(declaration)) {
      for (const property of available) blocked.add(property);
    }
  }
}

export function collectElementStyles(
  element: HTMLElement | SVGElement,
  stateStyleId: string,
): ElementStyleSnapshot {
  const state: CollectionState = {
    inaccessible: new Set(),
    ruleCount: 0,
    sourceOrder: 0,
    truncated: false,
  };
  const inlineIndexes = styleTagIndexes(stateStyleId);
  const selected = collectSection(element, stateStyleId, inlineIndexes, state);
  const blocked = new Set(activeProperties(selected));
  const inheritedRules: InheritedStyleSection[] = [];

  let ancestor = inheritanceParent(element);
  while (ancestor && !state.truncated) {
    const section = collectSection(
      ancestor,
      stateStyleId,
      inlineIndexes,
      state,
    );
    applyInheritance(section, blocked);
    if (section.inlineStyles.length > 0 || section.matchedRules.length > 0) {
      inheritedRules.push(section);
    }
    ancestor = inheritanceParent(ancestor);
  }

  return {
    inlineStyles: selected.inlineStyles,
    matchedRules: selected.matchedRules,
    inheritedRules,
    inaccessibleSheets: state.inaccessible.size,
    stylesTruncated: state.truncated,
  };
}
