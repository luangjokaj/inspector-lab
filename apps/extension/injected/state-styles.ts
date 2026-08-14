import { STATE_STYLE_ID } from "~injected/inspector-dom";
import { registerInspectorStyleSheet } from "~injected/inspector-styles";

/**
 * The forced-pseudo-state engine behind the Styles pane's "Force element
 * state" checkboxes and per-state authored CSS — DevTools' :hov panel,
 * rebuilt without the DevTools protocol.
 *
 * A pseudo-class cannot actually be forced from inside the page, so forcing
 * is emulated: every accessible page rule that uses the pseudo is cloned
 * with `:hover` (etc.) rewritten to `:is(<exact path to the element>)`,
 * which makes the rule apply to the selected element right now. Authored
 * declarations are emitted twice — under the real pseudo (so they work on
 * genuine interaction) and, while forced, bare.
 *
 * All output lives in one inspector-owned stylesheet: a constructable sheet
 * adopted onto the document (invisible to the page's DOM and immune to
 * style-src CSP), with a `<style id=...>` fallback that the rest of the
 * inspector already knows to ignore.
 */

export type PseudoState =
  "active" | "hover" | "focus" | "focus-visible" | "focus-within";

export const PSEUDO_STATES: readonly PseudoState[] = [
  "active",
  "hover",
  "focus",
  "focus-visible",
  "focus-within",
];

export type StateDeclaration = { name: string; value: string };

export type StateStyleMap = Record<PseudoState, StateDeclaration[]>;

export function emptyStateStyles(): StateStyleMap {
  return {
    active: [],
    hover: [],
    focus: [],
    "focus-visible": [],
    "focus-within": [],
  };
}

export type ForcedStateMap = Record<PseudoState, boolean>;

export function noStatesForced(): ForcedStateMap {
  return {
    active: false,
    hover: false,
    focus: false,
    "focus-visible": false,
    "focus-within": false,
  };
}

let adopted: CSSStyleSheet | null = null;
let fallbackTag: HTMLStyleElement | null = null;

/**
 * Writes the sheet's full text. Constructable stylesheet first; if the
 * isolated world cannot adopt one onto the page document, a plain `<style>`
 * tag (excluded from the tree, picker, and Sources by STATE_STYLE_ID).
 */
function writeCss(text: string): void {
  try {
    if (!adopted) {
      adopted = new CSSStyleSheet();
      registerInspectorStyleSheet(adopted);
    }
    if (!document.adoptedStyleSheets.includes(adopted)) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, adopted];
    }
    adopted.replaceSync(text);
    return;
  } catch {
    adopted = null;
  }

  if (!fallbackTag || !fallbackTag.isConnected) {
    fallbackTag = document.createElement("style");
    fallbackTag.id = STATE_STYLE_ID;
    document.documentElement.append(fallbackTag);
  }
  fallbackTag.textContent = text;
}

export function clearStateStyles(): void {
  if (adopted) {
    try {
      adopted.replaceSync("");
    } catch {
      /* Losing the empty write is harmless. */
    }
  }
  if (fallbackTag) {
    fallbackTag.remove();
    fallbackTag = null;
  }
}

/**
 * An exact structural path to the element (`html > body > div:nth-child(2)
 * > …`). Unlike the display-oriented uniqueSelector, this never truncates,
 * so cloned rules can only ever hit the selected element.
 */
function pathSelector(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.parentElement) {
    const index =
      Array.from(current.parentElement.children).indexOf(current) + 1;
    parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
    current = current.parentElement;
  }
  parts.unshift(current ? current.tagName.toLowerCase() : "html");

  return parts.join(" > ");
}

/** Matches `:hover` but not `:hover-anything`; fresh per call because the
 *  global flag makes RegExp.test stateful. */
function pseudoToken(pseudo: PseudoState): RegExp {
  return new RegExp(`:${pseudo}(?![\\w-])`, "g");
}

/**
 * Clones every accessible page rule using `pseudo` with the pseudo-class
 * rewritten to `:is(target)`, preserving @media/@supports conditions.
 * Selector lists are split on top-level-naive commas — a comma inside
 * `:is(a, b)` produces an invalid clone that the parser then drops, which
 * fails safe. Returns the clone texts plus the inaccessible-sheet count.
 */
function cloneForcedRules(
  pseudo: PseudoState,
  target: string,
): { rules: string[]; inaccessible: number } {
  const out: string[] = [];
  let inaccessible = 0;
  const replacement = `:is(${target})`;

  const visit = (list: CSSRuleList, wrappers: string[]) => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) {
        const token = pseudoToken(pseudo);
        if (!token.test(rule.selectorText)) continue;

        const parts = rule.selectorText
          .split(",")
          .map((part) => part.trim())
          .filter((part) => pseudoToken(pseudo).test(part))
          .map((part) => part.replace(pseudoToken(pseudo), replacement));
        if (parts.length === 0 || rule.style.cssText === "") continue;

        let text = `${parts.join(", ")} { ${rule.style.cssText} }`;
        for (const wrapper of [...wrappers].reverse()) {
          text = `${wrapper} { ${text} }`;
        }
        out.push(text);
        continue;
      }
      if (rule instanceof CSSMediaRule) {
        visit(rule.cssRules, [...wrappers, `@media ${rule.conditionText}`]);
        continue;
      }
      if (rule instanceof CSSSupportsRule) {
        visit(rule.cssRules, [...wrappers, `@supports ${rule.conditionText}`]);
        continue;
      }
      // @layer wrappers are dropped on purpose: cloned into the inspector's
      // unlayered sheet, the rules keep (or gain) priority, never lose it.
      if (rule instanceof CSSGroupingRule) visit(rule.cssRules, wrappers);
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.disabled) continue;
    const owner = sheet.ownerNode;
    if (
      (owner instanceof HTMLStyleElement || owner instanceof SVGStyleElement) &&
      owner.id === STATE_STYLE_ID
    ) {
      continue; // never clone the inspector's own output
    }
    let cssRules: CSSRuleList;
    try {
      cssRules = sheet.cssRules;
    } catch {
      inaccessible += 1;
      continue;
    }
    visit(cssRules, []);
  }

  return { rules: out, inaccessible };
}

/**
 * Rebuilds the whole inspector stylesheet for the current selection: cloned
 * page rules for every forced state, then the authored declarations (bare
 * while forced — emitted after the clones so they win ties — and under the
 * real pseudo always). Returns how many cross-origin sheets could not be
 * read, for the same footnote the Styles pane already shows.
 */
export function applyStateStyles(
  element: Element | null,
  forced: ForcedStateMap,
  authored: StateStyleMap,
): { inaccessibleSheets: number } {
  if (!element || !element.isConnected) {
    clearStateStyles();
    return { inaccessibleSheets: 0 };
  }

  const target = pathSelector(element);
  const chunks: string[] = [];
  let inaccessibleSheets = 0;

  for (const pseudo of PSEUDO_STATES) {
    const declarations = authored[pseudo];
    const declText = declarations
      .map((entry) => `${entry.name}: ${entry.value};`)
      .join(" ");

    if (forced[pseudo]) {
      const cloned = cloneForcedRules(pseudo, target);
      chunks.push(...cloned.rules);
      inaccessibleSheets = Math.max(inaccessibleSheets, cloned.inaccessible);
      if (declarations.length > 0) chunks.push(`${target} { ${declText} }`);
    }
    if (declarations.length > 0) {
      chunks.push(`${target}:${pseudo} { ${declText} }`);
    }
  }

  writeCss(chunks.join("\n"));
  return { inaccessibleSheets };
}
