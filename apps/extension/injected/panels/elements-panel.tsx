import { useEffect, useMemo, useRef, useState } from "react";
import styled, { css } from "styled-components";
import {
  Button,
  Icon,
  IconButton,
  Input,
  Select,
  resetButton,
} from "cherry-styled-components";
import {
  DevtoolsButtonGroup,
  DevtoolsField,
  EmptyState,
  PaneHeader,
  Panel,
  Scroller,
  SplitMain,
  SplitSidebar,
  SplitView,
  StatusBar,
  SubTab,
  SubTabBar,
  ToolbarControls,
  devtoolsMono,
} from "~injected/devtools.styled";
import {
  ancestorChain,
  describeElement,
  inlineText,
  isInspectorNode,
  isVoidElement,
  truncate,
  visibleChildren,
  type ElementSnapshot,
  type MatchedRule,
} from "~injected/inspector-dom";
import {
  PSEUDO_STATES,
  type ForcedStateMap,
  type PseudoState,
  type StateStyleMap,
} from "~injected/state-styles";

/** DOM search stops collecting past this point to keep huge pages snappy. */
const MAX_SEARCH_MATCHES = 500;

/** Attributes past this point are elided, as DevTools does on noisy nodes. */
const MAX_ATTRIBUTE_LENGTH = 60;
/** Children rendered per node before an overflow row takes over. */
const MAX_CHILDREN = 300;

/* --------------------------------------------------------------- tree ui */

/*
 * Chrome's elements tree: a selected row is a full-bleed square bar that is
 * blue-tinted while the tree has focus and neutral gray otherwise; a hovered
 * row gets a pill inset 3px on each side with a 5px radius. Rows are
 * min-height 15px, not fixed.
 */
const TreeRow = styled.div<{ $selected: boolean }>`
  ${devtoolsMono};
  position: relative;
  /* Own stacking context, so the hover pill can sit behind the row content. */
  z-index: 0;
  display: flex;
  align-items: stretch;
  width: max-content;
  min-width: 100%;
  min-height: ${({ theme }) => theme.devtools.rowHeight};
  white-space: pre;
  cursor: default;
  background: ${({ theme, $selected }) =>
    $selected ? theme.devtools.rowSelectedBlur : "transparent"};

  ${({ theme, $selected }) =>
    !$selected &&
    css`
      &:hover::before {
        content: "";
        position: absolute;
        top: 0;
        right: 3px;
        bottom: 0;
        left: 3px;
        z-index: -1;
        background: ${theme.devtools.rowHover};
        border-radius: 5px;
      }
    `};
`;

const TreeScroller = styled(Scroller)`
  padding: 2px 0;
  background: ${({ theme }) => theme.devtools.surface};

  &:focus-visible {
    outline: none;
  }

  /* Focused tree: the selected row turns from neutral gray to selection blue. */
  &:focus [data-selected="true"],
  &:focus-within [data-selected="true"] {
    background: ${({ theme }) => theme.devtools.rowSelected};
  }
`;

/** The leading gutter: 12px per depth level, no guide lines, as in Chrome. */
const TreeIndent = styled.span<{ $depth: number }>`
  flex: 0 0 auto;
  align-self: stretch;
  width: calc(
    ${({ $depth }) => $depth} * ${({ theme }) => theme.devtools.treeIndent}
  );
`;

/* Chrome's arrow-collapse / arrow-drop-down icons, 20x20 viewBox. */
const twistyMask = (path: string) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='${path}'/%3E%3C/svg%3E")`;

const TWISTY_COLLAPSED = twistyMask("M8 14V6L12 10L8 14Z");
const TWISTY_EXPANDED = twistyMask("M10 12L6 8H14L10 12Z");

const Twisty = styled.span<{ $expanded: boolean; $visible: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: ${({ theme }) => theme.devtools.treeIndent};
  align-self: stretch;
  visibility: ${({ $visible }) => ($visible ? "visible" : "hidden")};
  cursor: default;

  &::before {
    content: "";
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    background-color: ${({ theme }) => theme.devtools.textSubtle};
    mask: ${({ $expanded }) => ($expanded ? TWISTY_EXPANDED : TWISTY_COLLAPSED)}
      center / 14px 14px no-repeat;
  }

  &:hover::before {
    background-color: ${({ theme }) => theme.devtools.text};
  }
`;

const RowContent = styled.span`
  flex: 0 0 auto;
  padding-right: 8px;
`;

const TagName = styled.span`
  color: ${({ theme }) => theme.devtools.syntax.tag};
`;

const AttrName = styled.span`
  color: ${({ theme }) => theme.devtools.syntax.attributeName};
`;

const AttrValue = styled.span`
  color: ${({ theme }) => theme.devtools.syntax.attributeValue};
`;

const Punct = styled.span`
  color: ${({ theme }) => theme.devtools.syntax.punctuation};
`;

const TextNode = styled.span`
  color: ${({ theme }) => theme.devtools.syntax.text};
`;

const Doctype = styled.span`
  color: ${({ theme }) => theme.devtools.syntax.doctype};
`;

const Ellipsis = styled.span`
  padding: 0 2px;
  color: ${({ theme }) => theme.devtools.textSubtle};
`;

/* ------------------------------------------------------------ style pane */

const CssBlock = styled.div`
  ${devtoolsMono};
  padding: 4px 6px;
  border-bottom: solid 1px ${({ theme }) => theme.devtools.border};
`;

const CssSelector = styled.span`
  color: ${({ theme }) => theme.devtools.text};
`;

const CssDeclaration = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding-left: 12px;
`;

const DeclarationText = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

/**
 * Hover-revealed per-declaration actions. Restyles the Cherry `IconButton`
 * inside into a DevTools-flat control, the same way `ToolbarControls` does —
 * never by wrapping the Cherry component itself.
 */
const DeclarationActions = styled.span`
  display: inline-flex;
  flex: 0 0 auto;

  button {
    width: 15px;
    height: 15px;
    min-width: 15px;
    padding: 0;
    color: ${({ theme }) => theme.devtools.textSubtle};
    background: transparent;
    border: none;
    border-radius: 2px;
    box-shadow: none;
    transition: none;
    opacity: 0;

    svg {
      width: 11px;
      height: 11px;
    }

    &:hover:not(:disabled) {
      color: ${({ theme }) => theme.devtools.text};
      background: ${({ theme }) => theme.devtools.tabHoverBackground};
      border: none;
      box-shadow: none;
    }

    &:focus,
    &:active {
      border: none;
      box-shadow: none;
    }

    &:focus-visible {
      outline: solid 1px ${({ theme }) => theme.devtools.focusRing};
      outline-offset: -1px;
      opacity: 1;
    }
  }

  ${CssDeclaration}:hover & button {
    opacity: 1;
  }
`;

const CssProperty = styled.span`
  color: ${({ theme }) => theme.devtools.syntax.property};
`;

const CssValue = styled.span`
  color: ${({ theme }) => theme.devtools.syntax.value};
`;

const NoDeclarations = styled.div`
  padding-left: 12px;
  color: ${({ theme }) => theme.devtools.textSubtle};
  font-style: italic;
`;

/** Selector line of a rule block, with the stylesheet name on the right. */
const RuleHeader = styled.div`
  display: flex;
  align-items: baseline;
  gap: 4px;
`;

/** The stylesheet name doubles as a link into the Sources panel. */
const RuleSource = styled.button`
  ${resetButton};
  flex: 0 1 auto;
  max-width: 45%;
  margin-left: auto;
  overflow: hidden;
  color: ${({ theme }) => theme.devtools.textSubtle};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover {
    color: ${({ theme }) => theme.devtools.accent};
    text-decoration: underline;
  }

  &:focus-visible {
    outline: solid 1px ${({ theme }) => theme.devtools.focusRing};
    outline-offset: -1px;
  }
`;

/* --------------------------------------------------------- forced states */

/** DevTools' :hov panel: a compact checkbox grid above the rule blocks. */
const StateSection = styled.div`
  padding: 4px 6px;
  border-bottom: solid 1px ${({ theme }) => theme.devtools.border};
`;

const StateSectionTitle = styled.div`
  margin-bottom: 2px;
  color: ${({ theme }) => theme.devtools.textSubtle};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
`;

const StateGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 8px;
`;

/**
 * One :state checkbox row. Compacts the Cherry checkbox to DevTools scale
 * from the parent, the same way ToolbarControls restyles Cherry buttons.
 */
const StateCheck = styled.label`
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 16px;
  color: ${({ theme }) => theme.devtools.text};
  font-family: ${({ theme }) => theme.devtools.monoFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  cursor: default;

  /* Cherry wraps controls in spans; flatten them onto this one line. */
  span {
    display: inline-flex;
    margin: 0;
  }

  input {
    width: 12px;
    height: 12px;
    min-width: 12px;
    min-height: 12px;
    margin: 0;
    accent-color: ${({ theme }) => theme.devtools.accent};
  }

  /* Cherry's check mark, shrunk to sit inside the 12px circle. */
  svg {
    width: 8px;
    height: 8px;
    stroke-width: 4px;
  }
`;

const PaneNote = styled.div`
  padding: 4px 6px;
  color: ${({ theme }) => theme.devtools.textSubtle};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  font-style: italic;
`;

/**
 * Sits inside the `element.style` block, where DevTools lets you type a new
 * declaration straight into the rule.
 */
const DeclarationEditor = styled.form`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  padding-left: 12px;
`;

const Feedback = styled.p<{ $error: boolean }>`
  margin: 0;
  padding: 2px 6px;
  color: ${({ theme, $error }) =>
    $error ? theme.devtools.status.error : theme.devtools.status.success};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
`;

/* --------------------------------------------------------- computed pane */

const ComputedList = styled.div`
  ${devtoolsMono};
`;

const ComputedRow = styled.div`
  display: flex;
  gap: 6px;
  padding: 0 6px;
  border-bottom: solid 1px transparent;

  &:hover {
    background: ${({ theme }) => theme.devtools.rowHover};
  }
`;

const ComputedName = styled.span`
  flex: 0 0 42%;
  overflow: hidden;
  color: ${({ theme }) => theme.devtools.syntax.property};
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ComputedValue = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: ${({ theme }) => theme.devtools.text};
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/** The Computed pane's box-model diagram. */
const BoxModel = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  color: ${({ theme }) => theme.devtools.boxModel.text};
  font-family: ${({ theme }) => theme.devtools.monoFamily};
  font-size: 10px;
  border-bottom: solid 1px ${({ theme }) => theme.devtools.border};
`;

type BoxTone = "margin" | "border" | "padding" | "content";

const BoxLayer = styled.div<{ $tone: BoxTone }>`
  position: relative;
  padding: 14px 28px;
  text-align: center;
  background: ${({ theme, $tone }) => theme.devtools.boxModel[$tone]};
  border: solid 1px ${({ theme }) => theme.devtools.border};
`;

const BoxLabel = styled.span`
  position: absolute;
  top: 1px;
  left: 3px;
  font-size: 9px;
`;

const BoxSide = styled.span<{ $side: "top" | "right" | "bottom" | "left" }>`
  position: absolute;
  ${({ $side }) => {
    if ($side === "top") {
      return css`
        top: 1px;
        left: 50%;
        transform: translateX(-50%);
      `;
    }
    if ($side === "bottom") {
      return css`
        bottom: 1px;
        left: 50%;
        transform: translateX(-50%);
      `;
    }
    if ($side === "left") {
      return css`
        top: 50%;
        left: 4px;
        transform: translateY(-50%);
      `;
    }
    return css`
      top: 50%;
      right: 4px;
      transform: translateY(-50%);
    `;
  }};
`;

const BoxContent = styled.div`
  padding: 6px 10px;
  white-space: nowrap;
  background: ${({ theme }) => theme.devtools.boxModel.content};
  border: solid 1px ${({ theme }) => theme.devtools.border};
`;

/* -------------------------------------------------------------- crumbs */

const Crumb = styled.button<{ $selected: boolean }>`
  padding: 0 4px;
  color: ${({ theme, $selected }) =>
    $selected ? theme.devtools.text : theme.devtools.textSubtle};
  font-family: ${({ theme }) => theme.devtools.monoFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  background: ${({ theme, $selected }) =>
    $selected ? theme.devtools.rowSelected : "transparent"};
  border: none;
  border-radius: 2px;
  cursor: default;

  &:hover {
    color: ${({ theme }) => theme.devtools.text};
    background: ${({ theme, $selected }) =>
      $selected ? theme.devtools.rowSelected : theme.devtools.rowHover};
  }
`;

const CrumbSeparator = styled.span`
  color: ${({ theme }) => theme.devtools.textDisabled};
`;

const FilterRow = styled.div`
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  padding: 3px 6px;
  border-bottom: solid 1px ${({ theme }) => theme.devtools.border};
`;

/* --------------------------------------------------------------- search */

/** The find bar under the tree, styled like DevTools' own search toolbar. */
const SearchRow = styled.div`
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 4px;
  min-height: ${({ theme }) => theme.devtools.toolbarHeight};
  padding: 0 4px;
  background: ${({ theme }) => theme.devtools.toolbar};
  border-top: solid 1px ${({ theme }) => theme.devtools.border};
`;

const SearchCount = styled.span`
  flex: 0 0 auto;
  padding: 0 4px;
  color: ${({ theme }) => theme.devtools.textSubtle};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  white-space: nowrap;
`;

/**
 * True when `element` matches the query as a CSS selector, or contains it in
 * its tag name, an attribute, or its inline text — the same buckets Chrome's
 * Elements search covers (minus XPath).
 */
function elementMatchesQuery(
  element: Element,
  query: string,
  lower: string,
): boolean {
  try {
    if (element.matches(query)) return true;
  } catch {
    /* Not a valid selector; fall through to the string search. */
  }
  if (element.tagName.toLowerCase().includes(lower)) return true;
  for (const attribute of Array.from(element.attributes)) {
    if (
      attribute.name.toLowerCase().includes(lower) ||
      attribute.value.toLowerCase().includes(lower)
    ) {
      return true;
    }
  }
  return inlineText(element).toLowerCase().includes(lower);
}

/* --------------------------------------------------------------- helpers */

type RowKind = "doctype" | "open" | "close" | "overflow";

type TreeRowData = {
  key: string;
  kind: RowKind;
  element: Element;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  hiddenCount: number;
};

/**
 * Flattens the live DOM into the rows currently visible in the tree. Working
 * from a flat list (rather than recursive components) keeps keyboard
 * navigation to simple index arithmetic.
 */
function buildRows(root: Element, expanded: Set<Element>): TreeRowData[] {
  const rows: TreeRowData[] = [];

  if (document.doctype) {
    rows.push({
      key: "doctype",
      kind: "doctype",
      element: root,
      depth: 0,
      hasChildren: false,
      expanded: false,
      hiddenCount: 0,
    });
  }

  const visit = (element: Element, depth: number, path: string) => {
    const children = visibleChildren(element);
    const hasChildren = children.length > 0;
    const isExpanded = hasChildren && expanded.has(element);

    rows.push({
      key: `${path}:open`,
      kind: "open",
      element,
      depth,
      hasChildren,
      expanded: isExpanded,
      hiddenCount: 0,
    });

    if (!isExpanded) return;

    children.slice(0, MAX_CHILDREN).forEach((child, index) => {
      visit(child, depth + 1, `${path}.${index}`);
    });

    if (children.length > MAX_CHILDREN) {
      rows.push({
        key: `${path}:overflow`,
        kind: "overflow",
        element,
        depth: depth + 1,
        hasChildren: false,
        expanded: false,
        hiddenCount: children.length - MAX_CHILDREN,
      });
    }

    if (!isVoidElement(element)) {
      rows.push({
        key: `${path}:close`,
        kind: "close",
        element,
        depth,
        hasChildren: false,
        expanded: false,
        hiddenCount: 0,
      });
    }
  };

  visit(root, 0, "0");
  return rows;
}

/**
 * `<div class="card" id="x">` split into colored spans. As in Chrome, the
 * angle brackets, `=` and quotes inherit the tag color; only attribute names
 * and values recolor.
 */
function OpenTag({ element }: { element: Element }) {
  const tag = element.tagName.toLowerCase();

  return (
    <>
      <TagName>&lt;{tag}</TagName>
      {Array.from(element.attributes).map((attribute) => (
        <span key={attribute.name}>
          {" "}
          <AttrName>{attribute.name}</AttrName>
          {attribute.value !== "" && (
            <>
              <TagName>=&quot;</TagName>
              <AttrValue>
                {truncate(attribute.value, MAX_ATTRIBUTE_LENGTH)}
              </AttrValue>
              <TagName>&quot;</TagName>
            </>
          )}
        </span>
      ))}
      <TagName>&gt;</TagName>
    </>
  );
}

function ClosingTag({ element }: { element: Element }) {
  return <TagName>&lt;/{element.tagName.toLowerCase()}&gt;</TagName>;
}

function pixels(value: string): string {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return "-";
  return parsed === 0 ? "-" : String(Math.round(parsed));
}

function lookup(entries: ElementSnapshot["computed"], name: string): string {
  return entries.find((entry) => entry.name === name)?.value ?? "";
}

/** One ring of the box model, labelled with its four resolved edge values. */
function BoxModelLayer({
  tone,
  computed,
  prefix,
  suffix,
  children,
}: {
  tone: BoxTone;
  computed: ElementSnapshot["computed"];
  prefix: string;
  suffix: string;
  children: React.ReactNode;
}) {
  const edge = (side: string) =>
    pixels(lookup(computed, `${prefix}-${side}${suffix}`));

  return (
    <BoxLayer $tone={tone}>
      <BoxLabel>{tone}</BoxLabel>
      <BoxSide $side="top">{edge("top")}</BoxSide>
      <BoxSide $side="right">{edge("right")}</BoxSide>
      <BoxSide $side="bottom">{edge("bottom")}</BoxSide>
      <BoxSide $side="left">{edge("left")}</BoxSide>
      {children}
    </BoxLayer>
  );
}

/* ----------------------------------------------------------------- panel */

export type ElementsPanelProps = {
  root: HTMLElement;
  selectedElement: HTMLElement | null;
  snapshot: ElementSnapshot | null;
  onSelectElement: (element: HTMLElement) => void;
  /** Paints or clears the page-side highlight while tree rows are hovered. */
  onHoverElement: (element: Element | null) => void;
  onApplyStyle: (
    property: string,
    value: string,
  ) => { error: boolean; message: string };
  /** Removes one declaration from the element's inline `style`. */
  onRemoveStyle: (property: string) => { error: boolean; message: string };
  /** Which pseudo-classes are currently forced on the selected element. */
  forcedStates: ForcedStateMap;
  onToggleForcedState: (state: PseudoState, forced: boolean) => void;
  /** User-authored per-state declarations for the selected element. */
  stateStyles: StateStyleMap;
  onAddStateStyle: (
    state: PseudoState,
    property: string,
    value: string,
  ) => { error: boolean; message: string };
  onRemoveStateStyle: (state: PseudoState, property: string) => void;
  /** Jumps to the rule's stylesheet in the Sources panel. */
  onOpenSource: (rule: MatchedRule) => void;
};

export function ElementsPanel({
  root,
  selectedElement,
  snapshot,
  onSelectElement,
  onHoverElement,
  onApplyStyle,
  onRemoveStyle,
  forcedStates,
  onToggleForcedState,
  stateStyles,
  onAddStateStyle,
  onRemoveStateStyle,
  onOpenSource,
}: ElementsPanelProps) {
  const [expanded, setExpanded] = useState<Set<Element>>(() => {
    const initial = new Set<Element>([document.documentElement]);
    if (document.body) initial.add(document.body);
    return initial;
  });
  const [sidebarTab, setSidebarTab] = useState<"styles" | "computed">("styles");
  const [computedFilter, setComputedFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [property, setProperty] = useState("color");
  const [value, setValue] = useState("");
  const [stateTarget, setStateTarget] = useState<PseudoState>("hover");
  const [stateProperty, setStateProperty] = useState("");
  const [stateValue, setStateValue] = useState("");
  const [feedback, setFeedback] = useState<{
    message: string;
    error: boolean;
  } | null>(null);

  const selectedRowRef = useRef<HTMLDivElement | null>(null);

  /* Reveal a picked element: expand every ancestor, then scroll to it. */
  useEffect(() => {
    if (!selectedElement) return;
    setExpanded((current) => {
      const next = new Set(current);
      let changed = false;
      let ancestor = selectedElement.parentElement;
      while (ancestor) {
        if (!next.has(ancestor)) {
          next.add(ancestor);
          changed = true;
        }
        ancestor = ancestor.parentElement;
      }
      return changed ? next : current;
    });
  }, [selectedElement]);

  /*
   * `expanded` must be a dependency: revealing a picked element first expands
   * its ancestors in a separate commit, and only that re-render creates the
   * row (and ref) this scroll needs. Keyed on selection alone, the effect
   * fired before the row existed and picked elements never scrolled into
   * view.
   */
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedElement, expanded]);

  /* Never leave a page highlight behind when the panel goes away. */
  useEffect(() => () => onHoverElement(null), [onHoverElement]);

  const rows = useMemo(
    () => buildRows(root, expanded),
    // The DOM is read live, so re-flatten whenever selection or expansion moves.
    [root, expanded, selectedElement],
  );

  const toggle = (element: Element) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(element)) next.delete(element);
      else next.add(element);
      return next;
    });
  };

  const selectRow = (element: Element) => {
    if (element instanceof HTMLElement) onSelectElement(element);
  };

  /** Arrow-key navigation over the visible rows, as in the real Elements tree. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const openRows = rows.filter((row) => row.kind === "open");
    const index = openRows.findIndex((row) => row.element === selectedElement);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex =
        event.key === "ArrowDown"
          ? Math.min(index + 1, openRows.length - 1)
          : Math.max(index - 1, 0);
      const next = openRows[nextIndex];
      if (next) {
        selectRow(next.element);
        // Keyboard selection paints the same page highlight as hovering.
        onHoverElement(next.element);
      }
      return;
    }

    if (index < 0) return;
    const current = openRows[index];

    if (
      event.key === "ArrowRight" &&
      current.hasChildren &&
      !current.expanded
    ) {
      event.preventDefault();
      toggle(current.element);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (current.expanded) toggle(current.element);
      else if (current.element.parentElement) {
        selectRow(current.element.parentElement);
        onHoverElement(current.element.parentElement);
      }
    }
  };

  const applyStyle = (event: React.FormEvent) => {
    event.preventDefault();
    setFeedback(onApplyStyle(property, value));
  };

  const applyStateStyle = (event: React.FormEvent) => {
    event.preventDefault();
    const result = onAddStateStyle(stateTarget, stateProperty, stateValue);
    setFeedback(result);
    if (!result.error) {
      setStateProperty("");
      setStateValue("");
    }
  };

  const searchMatches = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) return [];
    const lower = query.toLowerCase();
    const matches: Element[] = [];
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (isInspectorNode(element)) continue;
      if (elementMatchesQuery(element, query, lower)) {
        matches.push(element);
        if (matches.length >= MAX_SEARCH_MATCHES) break;
      }
    }
    return matches;
  }, [root, searchQuery]);

  // -1 means "no match visited yet", so the first Enter lands on match 1.
  useEffect(() => setSearchIndex(-1), [searchQuery]);

  /** Selects match `index`, flashing the same page highlight as hovering. */
  const jumpToMatch = (index: number) => {
    const match = searchMatches[index];
    if (!match) return;
    setSearchIndex(index);
    selectRow(match);
    onHoverElement(match);
  };

  const stepMatch = (delta: number) => {
    const length = searchMatches.length;
    if (length === 0) return;
    const next =
      searchIndex < 0
        ? delta > 0
          ? 0
          : length - 1
        : (searchIndex + delta + length) % length;
    jumpToMatch(next);
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    stepMatch(event.shiftKey ? -1 : 1);
  };

  const crumbs = selectedElement ? ancestorChain(selectedElement) : [];
  const computed = snapshot?.computed ?? [];
  const filteredComputed = computedFilter.trim()
    ? computed.filter((entry) =>
        `${entry.name}${entry.value}`
          .toLowerCase()
          .includes(computedFilter.trim().toLowerCase()),
      )
    : computed;

  return (
    <Panel>
      <SplitView>
        <SplitMain>
          <TreeScroller
            role="tree"
            aria-label="DOM tree"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onMouseLeave={() => onHoverElement(null)}
            onBlur={() => onHoverElement(null)}
          >
            {rows.map((row) => {
              if (row.kind === "doctype") {
                return (
                  <TreeRow key={row.key} $selected={false}>
                    <TreeIndent $depth={0} />
                    <Twisty $expanded={false} $visible={false} />
                    <RowContent>
                      <Doctype>
                        &lt;!DOCTYPE {document.doctype?.name ?? "html"}&gt;
                      </Doctype>
                    </RowContent>
                  </TreeRow>
                );
              }

              if (row.kind === "overflow") {
                return (
                  <TreeRow key={row.key} $selected={false}>
                    <TreeIndent $depth={row.depth} />
                    <Twisty $expanded={false} $visible={false} />
                    <RowContent>
                      <Ellipsis>
                        … {row.hiddenCount} more nodes not shown
                      </Ellipsis>
                    </RowContent>
                  </TreeRow>
                );
              }

              const isSelected = row.element === selectedElement;

              if (row.kind === "close") {
                return (
                  <TreeRow
                    key={row.key}
                    $selected={isSelected}
                    data-selected={isSelected ? "true" : undefined}
                    aria-hidden="true"
                    onClick={() => selectRow(row.element)}
                    onMouseEnter={() => onHoverElement(row.element)}
                  >
                    <TreeIndent $depth={row.depth} />
                    <Twisty $expanded={false} $visible={false} />
                    <RowContent>
                      <ClosingTag element={row.element} />
                    </RowContent>
                  </TreeRow>
                );
              }

              const text = row.hasChildren ? "" : inlineText(row.element);
              const selfClosing = isVoidElement(row.element);

              return (
                <TreeRow
                  key={row.key}
                  ref={isSelected ? selectedRowRef : undefined}
                  role="treeitem"
                  aria-level={row.depth + 1}
                  aria-selected={isSelected}
                  aria-expanded={row.hasChildren ? row.expanded : undefined}
                  $selected={isSelected}
                  data-selected={isSelected ? "true" : undefined}
                  onClick={() => selectRow(row.element)}
                  onMouseEnter={() => onHoverElement(row.element)}
                >
                  <TreeIndent $depth={row.depth} />
                  <Twisty
                    $expanded={row.expanded}
                    $visible={row.hasChildren}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(row.element);
                    }}
                  />
                  <RowContent>
                    <OpenTag element={row.element} />
                    {row.hasChildren && !row.expanded && (
                      <>
                        <Ellipsis>…</Ellipsis>
                        <ClosingTag element={row.element} />
                      </>
                    )}
                    {!row.hasChildren && !selfClosing && (
                      <>
                        <TextNode>{truncate(text, 80)}</TextNode>
                        <ClosingTag element={row.element} />
                      </>
                    )}
                  </RowContent>
                </TreeRow>
              );
            })}
          </TreeScroller>

          <SearchRow>
            <DevtoolsField $grow>
              <Input
                id="inspector-element-search"
                $size="small"
                $fullWidth
                placeholder="Find by string or selector"
                aria-label="Search DOM elements"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
              />
            </DevtoolsField>
            {searchQuery.trim() && (
              <SearchCount role="status">
                {`${searchIndex < 0 ? 0 : searchIndex + 1} of ${searchMatches.length}`}
              </SearchCount>
            )}
            <ToolbarControls>
              <IconButton
                aria-label="Previous match"
                disabled={searchMatches.length === 0}
                onClick={() => stepMatch(-1)}
              >
                <Icon name="ChevronUp" size={14} />
              </IconButton>
              <IconButton
                aria-label="Next match"
                disabled={searchMatches.length === 0}
                onClick={() => stepMatch(1)}
              >
                <Icon name="ChevronDown" size={14} />
              </IconButton>
            </ToolbarControls>
          </SearchRow>

          <StatusBar onMouseLeave={() => onHoverElement(null)}>
            {crumbs.length === 0 ? (
              <span>No element selected</span>
            ) : (
              crumbs.map((crumb, index) => (
                <span key={`${describeElement(crumb)}-${index}`}>
                  {index > 0 && <CrumbSeparator>&nbsp;›&nbsp;</CrumbSeparator>}
                  <Crumb
                    type="button"
                    $selected={crumb === selectedElement}
                    onClick={() => selectRow(crumb)}
                    onMouseEnter={() => onHoverElement(crumb)}
                  >
                    {describeElement(crumb)}
                  </Crumb>
                </span>
              ))
            )}
          </StatusBar>
        </SplitMain>

        <SplitSidebar>
          <SubTabBar role="tablist" aria-label="Element details">
            <SubTab
              type="button"
              role="tab"
              aria-selected={sidebarTab === "styles"}
              $selected={sidebarTab === "styles"}
              onClick={() => setSidebarTab("styles")}
            >
              Styles
            </SubTab>
            <SubTab
              type="button"
              role="tab"
              aria-selected={sidebarTab === "computed"}
              $selected={sidebarTab === "computed"}
              onClick={() => setSidebarTab("computed")}
            >
              Computed
            </SubTab>
          </SubTabBar>

          {!snapshot ? (
            <EmptyState>
              Select an element in the tree, or use the picker, to inspect it.
            </EmptyState>
          ) : sidebarTab === "styles" ? (
            <Scroller>
              <CssBlock>
                <CssSelector>element.style</CssSelector> <Punct>{"{"}</Punct>
                {snapshot.inlineStyles.length === 0 ? (
                  <NoDeclarations>no declarations</NoDeclarations>
                ) : (
                  snapshot.inlineStyles.map((entry) => (
                    <CssDeclaration key={entry.name}>
                      <DeclarationText>
                        <CssProperty>{entry.name}</CssProperty>
                        <Punct>: </Punct>
                        <CssValue>{entry.value}</CssValue>
                        <Punct>;</Punct>
                      </DeclarationText>
                      <DeclarationActions>
                        <IconButton
                          aria-label={`Delete ${entry.name}`}
                          onClick={() => setFeedback(onRemoveStyle(entry.name))}
                        >
                          <Icon name="X" size={11} />
                        </IconButton>
                      </DeclarationActions>
                    </CssDeclaration>
                  ))
                )}
                <DeclarationEditor onSubmit={applyStyle}>
                  <DevtoolsField $grow>
                    <Input
                      id="inspector-property"
                      $size="small"
                      $fullWidth
                      aria-label="CSS property"
                      placeholder="property"
                      value={property}
                      onChange={(event) => setProperty(event.target.value)}
                    />
                  </DevtoolsField>
                  <Punct>:</Punct>
                  <DevtoolsField $grow>
                    <Input
                      id="inspector-value"
                      $size="small"
                      $fullWidth
                      aria-label="CSS value"
                      placeholder="value"
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                    />
                  </DevtoolsField>
                  <DevtoolsButtonGroup>
                    <Button $size="small" type="submit">
                      Add
                    </Button>
                  </DevtoolsButtonGroup>
                </DeclarationEditor>
                <Punct>{"}"}</Punct>
              </CssBlock>
              {feedback && (
                <Feedback $error={feedback.error} role="status">
                  {feedback.message}
                </Feedback>
              )}

              <StateSection>
                <StateSectionTitle>Force element state</StateSectionTitle>
                <StateGrid>
                  {PSEUDO_STATES.map((state) => (
                    <StateCheck key={state}>
                      <Input
                        type="checkbox"
                        id={`inspector-force-${state}`}
                        checked={forcedStates[state]}
                        onChange={(event) =>
                          onToggleForcedState(state, event.target.checked)
                        }
                        aria-label={`Force :${state}`}
                      />
                      :{state}
                    </StateCheck>
                  ))}
                </StateGrid>
              </StateSection>

              {PSEUDO_STATES.filter(
                (state) => stateStyles[state].length > 0,
              ).map((state) => (
                <CssBlock key={`state-${state}`}>
                  <RuleHeader>
                    <span>
                      <CssSelector>
                        {snapshot.selector}:{state}
                      </CssSelector>{" "}
                      <Punct>{"{"}</Punct>
                    </span>
                  </RuleHeader>
                  {stateStyles[state].map((entry) => (
                    <CssDeclaration key={entry.name}>
                      <DeclarationText>
                        <CssProperty>{entry.name}</CssProperty>
                        <Punct>: </Punct>
                        <CssValue>{entry.value}</CssValue>
                        <Punct>;</Punct>
                      </DeclarationText>
                      <DeclarationActions>
                        <IconButton
                          aria-label={`Delete ${entry.name} from :${state}`}
                          onClick={() => onRemoveStateStyle(state, entry.name)}
                        >
                          <Icon name="X" size={11} />
                        </IconButton>
                      </DeclarationActions>
                    </CssDeclaration>
                  ))}
                  <Punct>{"}"}</Punct>
                </CssBlock>
              ))}

              <CssBlock>
                <DeclarationEditor onSubmit={applyStateStyle}>
                  <DevtoolsField>
                    <Select
                      id="inspector-state-target"
                      $size="small"
                      aria-label="Pseudo state to style"
                      value={stateTarget}
                      onChange={(event) =>
                        setStateTarget(event.target.value as PseudoState)
                      }
                    >
                      {PSEUDO_STATES.map((state) => (
                        <option key={state} value={state}>
                          :{state}
                        </option>
                      ))}
                    </Select>
                  </DevtoolsField>
                  <DevtoolsField $grow>
                    <Input
                      id="inspector-state-property"
                      $size="small"
                      $fullWidth
                      aria-label="State CSS property"
                      placeholder="property"
                      value={stateProperty}
                      onChange={(event) => setStateProperty(event.target.value)}
                    />
                  </DevtoolsField>
                  <Punct>:</Punct>
                  <DevtoolsField $grow>
                    <Input
                      id="inspector-state-value"
                      $size="small"
                      $fullWidth
                      aria-label="State CSS value"
                      placeholder="value"
                      value={stateValue}
                      onChange={(event) => setStateValue(event.target.value)}
                    />
                  </DevtoolsField>
                  <DevtoolsButtonGroup>
                    <Button $size="small" type="submit">
                      Add
                    </Button>
                  </DevtoolsButtonGroup>
                </DeclarationEditor>
              </CssBlock>

              {snapshot.matchedRules.map((rule, index) => (
                <CssBlock key={`${rule.selector}-${index}`}>
                  <RuleHeader>
                    <span>
                      <CssSelector>{rule.selector}</CssSelector>{" "}
                      <Punct>{"{"}</Punct>
                    </span>
                    <RuleSource
                      type="button"
                      title={`${rule.source} — open in Sources`}
                      onClick={() => onOpenSource(rule)}
                    >
                      {rule.source}
                    </RuleSource>
                  </RuleHeader>
                  {rule.declarations.length === 0 ? (
                    <NoDeclarations>no declarations</NoDeclarations>
                  ) : (
                    rule.declarations.map((entry) => (
                      <CssDeclaration key={entry.name}>
                        <DeclarationText>
                          <CssProperty>{entry.name}</CssProperty>
                          <Punct>: </Punct>
                          <CssValue>{entry.value}</CssValue>
                          <Punct>;</Punct>
                        </DeclarationText>
                      </CssDeclaration>
                    ))
                  )}
                  <Punct>{"}"}</Punct>
                </CssBlock>
              ))}
              {snapshot.matchedRules.length === 0 && (
                <PaneNote>
                  No stylesheet rules match {snapshot.selector}.
                </PaneNote>
              )}
              {snapshot.inaccessibleSheets > 0 && (
                <PaneNote>
                  {snapshot.inaccessibleSheets} cross-origin stylesheet
                  {snapshot.inaccessibleSheets === 1 ? "" : "s"} could not be
                  read.
                </PaneNote>
              )}
            </Scroller>
          ) : (
            <>
              <FilterRow>
                <DevtoolsField $grow>
                  <Input
                    id="inspector-computed-filter"
                    $size="small"
                    $fullWidth
                    placeholder="Filter"
                    value={computedFilter}
                    onChange={(event) => setComputedFilter(event.target.value)}
                  />
                </DevtoolsField>
              </FilterRow>
              <Scroller>
                <BoxModel>
                  <BoxModelLayer
                    tone="margin"
                    computed={computed}
                    prefix="margin"
                    suffix=""
                  >
                    <BoxModelLayer
                      tone="border"
                      computed={computed}
                      prefix="border"
                      suffix="-width"
                    >
                      <BoxModelLayer
                        tone="padding"
                        computed={computed}
                        prefix="padding"
                        suffix=""
                      >
                        <BoxContent>
                          {snapshot.rect.width} × {snapshot.rect.height}
                        </BoxContent>
                      </BoxModelLayer>
                    </BoxModelLayer>
                  </BoxModelLayer>
                </BoxModel>
                <PaneHeader>
                  {filteredComputed.length} computed properties
                </PaneHeader>
                <ComputedList>
                  {filteredComputed.map((entry) => (
                    <ComputedRow key={entry.name} title={entry.value}>
                      <ComputedName>{entry.name}</ComputedName>
                      <ComputedValue>{entry.value}</ComputedValue>
                    </ComputedRow>
                  ))}
                </ComputedList>
              </Scroller>
            </>
          )}
        </SplitSidebar>
      </SplitView>
    </Panel>
  );
}
