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
  devtoolsCheckbox,
  devtoolsMono,
  revealed,
  rowActionButton,
  touchHitArea,
} from "~injected/devtools.styled";
import {
  ancestorChain,
  describeElement,
  getOverlayRoot,
  inlineText,
  isInspectorNode,
  isVoidElement,
  serializeElement,
  truncate,
  visibleChildren,
  type ElementSnapshot,
  type MatchedRule,
  type StylableElement,
} from "~injected/inspector-dom";
import {
  PSEUDO_STATES,
  type ForcedStateMap,
  type PseudoState,
  type StateStyleMap,
} from "~injected/state-styles";

/** DOM search stops collecting past this point to keep huge pages snappy. */
const MAX_SEARCH_MATCHES = 500;

/** How long the copy button wears the checkmark before turning back. */
const COPY_FEEDBACK_MS = 1500;

/**
 * Clipboard write with the classic textarea fallback: the async clipboard API
 * needs a secure context, which an inspector meant for any page (plain http,
 * file:) cannot assume. The textarea goes to the overlay root, the one place
 * guaranteed to render on every supported document.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Fall through to execCommand. */
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    Object.assign(area.style, {
      position: "fixed",
      top: "0",
      left: "0",
      opacity: "0",
      pointerEvents: "none",
    });
    getOverlayRoot().append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

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

/**
 * The copy-element action on the selected element's opening line — DevTools'
 * "Copy outerHTML", one hover away instead of buried in a context menu. Shares
 * the Styles pane's row-action styling (the declaration X): revealed by
 * hovering the row, by focus, and unconditionally where there is no hover.
 * Sticky, so it holds the pane's right edge while the tree scrolls sideways.
 */
const RowActions = styled.span`
  position: sticky;
  right: 4px;
  display: inline-flex;
  align-self: center;
  flex: 0 0 auto;
  margin-left: auto;
  ${rowActionButton(15)};

  ${TreeRow}:hover & button,
  ${TreeRow}:focus-within & button {
    ${revealed};
  }
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

/** Which syntax color an inline editor keeps while it is open. */
type EditorTone = "text" | "property" | "value";

/**
 * Inline editor scale for any dense row — a tree row, or one half of a CSS
 * declaration. Compacts the Cherry `Input` to the row's mono metrics from the
 * parent, the same way `DevtoolsField` restyles it at toolbar scale, and never
 * by wrapping the Cherry component itself.
 *
 * The field is border-free with an outline in its place: an outline takes no
 * space, so text can become an editor without the row shifting by a pixel. It
 * keeps the color the text had, so the line still reads as CSS while typing.
 */
const InlineEditorField = styled.span<{ $tone: EditorTone }>`
  display: inline-flex;
  align-items: center;
  max-width: 60ch;
  vertical-align: bottom;

  /* Cherry wraps controls in a span; flatten it onto the row line. */
  span {
    display: inline-flex;
    width: 100%;
    margin: 0;
  }

  && input {
    width: 100%;
    height: ${({ theme }) => theme.devtools.rowHeight};
    min-height: ${({ theme }) => theme.devtools.rowHeight};
    padding: 0 1px;
    color: ${({ theme, $tone }) =>
      $tone === "property"
        ? theme.devtools.syntax.property
        : $tone === "value"
          ? theme.devtools.syntax.value
          : theme.devtools.text};
    font-family: ${({ theme }) => theme.devtools.monoFamily};
    font-size: ${({ theme }) => theme.devtools.monoFontSize};
    line-height: ${({ theme }) => theme.devtools.rowHeight};
    background: ${({ theme }) => theme.devtools.surface};
    border: none;
    border-radius: 1px;
    outline: solid 1px ${({ theme }) => theme.devtools.focusRing};
    outline-offset: 0;
    box-shadow: none;
    transition: none;
  }
`;

/* ------------------------------------------------------------ style pane */

/**
 * Space held at every declaration's left edge: the enable/disable checkbox on
 * an authored rule, plain indent on a read-only one — so property names line
 * up on one column down the whole pane, whichever kind of rule they are in.
 */
const DECLARATION_GUTTER = "14px";

const CssBlock = styled.div<{ $editable?: boolean }>`
  ${devtoolsMono};
  padding: 4px 6px;
  border-bottom: solid 1px ${({ theme }) => theme.devtools.border};
  /* An authored rule takes text: clicking its empty space starts a new
     declaration, so the caret advertises that before the click happens. */
  cursor: ${({ $editable }) => ($editable ? "text" : "default")};
`;

const CssSelector = styled.span`
  color: ${({ theme }) => theme.devtools.text};
`;

const CssDeclaration = styled.div`
  position: relative;
  display: flex;
  align-items: flex-start;
`;

/** The gutter kept empty on read-only declarations, for alignment. */
const DeclarationGutter = styled.span`
  flex: 0 0 ${DECLARATION_GUTTER};
`;

/**
 * DevTools' enable/disable checkbox, in the gutter at the declaration's left
 * edge. Compacts the Cherry checkbox from the parent (`devtoolsCheckbox`),
 * and stays out of sight until the row is hovered or focused — except on a
 * switched-off declaration, whose way back must always be visible, and on a
 * touch device, which has no hover to reveal anything with.
 */
const DeclarationToggle = styled.label<{ $alwaysVisible: boolean }>`
  ${devtoolsCheckbox};
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 ${DECLARATION_GUTTER};
  height: ${({ theme }) => theme.devtools.rowHeight};
  cursor: default;
  /* Hidden means untappable as well as unseen. Left tappable, the hit area
     below would turn the rule's own left margin into a toggle and swallow the
     click that is supposed to start a new declaration there. */
  opacity: 0;
  pointer-events: none;

  /* The tap target grows left, into the rule's padding, so it can never take
     a tap meant for the property name immediately to its right. Overflow to
     the left of a scroll container is not scrollable, so the few pixels that
     land outside the rule cost nothing. */
  ${touchHitArea("right")};

  ${({ $alwaysVisible }) => $alwaysVisible && revealed};

  ${CssDeclaration}:hover &,
  ${CssDeclaration}:focus-within & {
    ${revealed};
  }

  @media (hover: none) {
    ${revealed};
  }
`;

const DeclarationText = styled.span<{ $disabled?: boolean }>`
  flex: 1 1 auto;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;

  /* A tree row grows sideways with its editor because the tree scrolls
     horizontally; a fixed-width sidebar column cannot, so an open editor is
     held to the column instead of pushing a scrollbar into the pane. */
  ${InlineEditorField} {
    max-width: 100%;
  }

  ${({ theme, $disabled }) =>
    $disabled &&
    css`
      /* A switched-off declaration reads as a single muted, struck-through
         line: the syntax colors go grey with it, as they do in DevTools. */
      color: ${theme.devtools.textDisabled};
      text-decoration: line-through;

      span {
        color: inherit;
      }
    `};
`;

/** The trailing X. Shares the grids' row-action styling, so it is revealed by
 *  hover, by focus, and unconditionally where there is no hover. */
const DeclarationActions = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  margin-left: 4px;
  ${rowActionButton(15)};

  /* Grows left, over the blank filler at the end of the row rather than past
     the pane's right edge, which would leave the Styles sidebar with a stray
     horizontal scrollbar. */
  button {
    ${touchHitArea("right")};
  }

  ${CssDeclaration}:hover & button,
  ${CssDeclaration}:focus-within & button {
    ${revealed};
  }
`;

/**
 * Property names and values in an authored rule are plain text until they are
 * clicked. The hover box is the only hint DevTools gives that they are live,
 * and the caret is what a touch user gets instead.
 */
const editableToken = css`
  cursor: text;
  border-radius: 2px;

  &:hover {
    background: ${({ theme }) => theme.devtools.rowHover};
  }
`;

const CssProperty = styled.span<{ $editable?: boolean }>`
  color: ${({ theme }) => theme.devtools.syntax.property};
  ${({ $editable }) => $editable && editableToken};
`;

const CssValue = styled.span<{ $editable?: boolean }>`
  color: ${({ theme }) => theme.devtools.syntax.value};
  ${({ $editable }) => $editable && editableToken};
`;

const NoDeclarations = styled.div`
  padding-left: ${DECLARATION_GUTTER};
  color: ${({ theme }) => theme.devtools.textSubtle};
  font-style: italic;
`;

/**
 * An authored rule's closing brace, doubling as DevTools' "click the empty
 * space to start a new declaration" target — the block's own click handler
 * picks it up. Focusable, so the affordance exists for the keyboard too, and
 * taller where there is no pointer to aim with: it is empty space, so growing
 * it for a finger costs the declaration rows none of their density.
 */
const RuleFooter = styled.div`
  display: flex;
  align-items: center;
  min-height: ${({ theme }) => theme.devtools.rowHeight};

  &:focus-visible {
    outline: solid 1px ${({ theme }) => theme.devtools.focusRing};
    outline-offset: -1px;
  }

  @media (hover: none) {
    min-height: ${({ theme }) => theme.devtools.touchTarget};
  }
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
 * One :state checkbox row. The label is the target, so the `:hover` text next
 * to the box counts as part of it — which is all a finger needs once the row
 * itself is tall enough. This is a settings grid, not a data row, so growing
 * it on touch costs the pane's density nothing.
 */
const StateCheck = styled.label`
  ${devtoolsCheckbox};
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 16px;
  color: ${({ theme }) => theme.devtools.text};
  font-family: ${({ theme }) => theme.devtools.monoFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  cursor: default;

  @media (hover: none) {
    min-height: ${({ theme }) => theme.devtools.touchTarget};
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

/** The tree edit in progress: an attribute name, value, new attribute, or text. */
type TreeEdit =
  | { kind: "attr-name"; element: Element; name: string }
  | { kind: "attr-value"; element: Element; name: string }
  | { kind: "attr-add"; element: Element }
  | { kind: "text"; element: Element };

type CommitVia = "enter" | "blur" | "tab" | "tab-back";

/** The tree's editing surface, threaded from the panel into each open tag. */
type TreeEditing = {
  edit: TreeEdit | null;
  onStart: (edit: TreeEdit) => void;
  /** Returns false when the edit was rejected and the editor stays open. */
  onCommit: (edit: TreeEdit, draft: string, via: CommitVia) => boolean;
  onCancel: () => void;
};

/**
 * Parses the add-attribute box: `name`, `name=value`, or `name="value"`.
 * The value keeps everything after `=`, minus one pair of matching quotes.
 */
function parseAttributeInput(
  raw: string,
): { name: string; value: string } | null {
  const match = /^([^\s="'<>/]+)(?:\s*=\s*(.*))?$/s.exec(raw.trim());
  if (!match) return null;
  let value = match[2] ?? "";
  const quote = value.charAt(0);
  if (
    (quote === '"' || quote === "'") &&
    value.length >= 2 &&
    value.endsWith(quote)
  ) {
    value = value.slice(1, -1);
  }
  return { name: match[1], value };
}

/**
 * One in-place editor, in a tree row or in a CSS declaration: Enter or blur
 * commits, Escape cancels, Tab commits and advances (the panel decides where
 * to). Sized to its own text so the row keeps its shape while editing.
 */
function InlineEditor({
  initial,
  label,
  tone = "text",
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  tone?: EditorTone;
  /** Returns false to keep the editor open (the edit was rejected). */
  onCommit: (draft: string, via: CommitVia) => boolean;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  /* Guards the blur that follows Enter/Tab/Escape from double-committing. */
  const doneRef = useRef(false);

  const finish = (via: CommitVia) => {
    if (doneRef.current) return;
    if (onCommit(draft, via)) doneRef.current = true;
  };

  return (
    <InlineEditorField
      $tone={tone}
      style={{ width: `${Math.max(draft.length, 3) + 2}ch` }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Input
        $size="small"
        $fullWidth
        autoFocus
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          // Select-all so typing replaces the old value, as in DevTools. The
          // immediate call covers Chromium; WebKit (Orion, Safari) undoes a
          // select() made during the focus event itself, so it runs again on
          // the next frame — after whatever caret placement undid it.
          const input = event.currentTarget;
          input.select();
          requestAnimationFrame(() => {
            if (input.isConnected) input.select();
          });
        }}
        onBlur={() => finish("blur")}
        onKeyDown={(event) => {
          // The tree's own arrow/typing shortcuts must not see editor keys.
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            finish("enter");
          } else if (event.key === "Tab") {
            event.preventDefault();
            finish(event.shiftKey ? "tab-back" : "tab");
          } else if (event.key === "Escape") {
            doneRef.current = true;
            onCancel();
          }
        }}
      />
    </InlineEditorField>
  );
}

/**
 * `<div class="card" id="x">` split into colored spans. As in Chrome, the
 * angle brackets, `=` and quotes inherit the tag color; only attribute names
 * and values recolor. With `editing` present, double-click starts an inline
 * edit: an attribute name or value in place, or a new attribute from the tag
 * name.
 */
function OpenTag({
  element,
  editing,
}: {
  element: Element;
  editing?: TreeEditing;
}) {
  const tag = element.tagName.toLowerCase();
  const edit =
    editing && editing.edit?.element === element ? editing.edit : null;

  const begin = (next: TreeEdit) => (event: React.MouseEvent) => {
    event.stopPropagation();
    editing?.onStart(next);
  };

  const editor = (current: TreeEdit, initial: string, label: string) =>
    editing ? (
      <InlineEditor
        initial={initial}
        label={label}
        onCommit={(draft, via) => editing.onCommit(current, draft, via)}
        onCancel={editing.onCancel}
      />
    ) : null;

  return (
    <>
      <TagName
        onDoubleClick={editing && begin({ kind: "attr-add", element })}
        title={editing ? "Double-click to add an attribute" : undefined}
      >
        &lt;{tag}
      </TagName>
      {Array.from(element.attributes).map((attribute) => (
        <span key={attribute.name}>
          {" "}
          {edit?.kind === "attr-name" && edit.name === attribute.name ? (
            editor(
              edit,
              attribute.name,
              `Edit name of attribute ${attribute.name}`,
            )
          ) : (
            <AttrName
              onDoubleClick={
                editing &&
                begin({ kind: "attr-name", element, name: attribute.name })
              }
            >
              {attribute.name}
            </AttrName>
          )}
          {edit?.kind === "attr-value" && edit.name === attribute.name ? (
            <>
              <TagName>=&quot;</TagName>
              {editor(
                edit,
                attribute.value,
                `Edit value of attribute ${attribute.name}`,
              )}
              <TagName>&quot;</TagName>
            </>
          ) : (
            attribute.value !== "" && (
              <>
                <TagName>=&quot;</TagName>
                <AttrValue
                  onDoubleClick={
                    editing &&
                    begin({ kind: "attr-value", element, name: attribute.name })
                  }
                >
                  {truncate(attribute.value, MAX_ATTRIBUTE_LENGTH)}
                </AttrValue>
                <TagName>&quot;</TagName>
              </>
            )
          )}
        </span>
      ))}
      {edit?.kind === "attr-add" && (
        <> {editor(edit, "", `New attribute for ${tag}`)}</>
      )}
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

/* ------------------------------------------------------ style authoring */

type StyleResult = { error: boolean; message: string };

type Declaration = { name: string; value: string };

/** A declaration as the pane lists it. A switched-off one is gone from the
 *  page but still shown, struck through, the way DevTools keeps it. */
type DeclarationRow = Declaration & { enabled: boolean };

/** The `element.style` block. Authored `:state` rules use `state:<name>`. */
const INLINE_BLOCK = "inline";

/**
 * A rule the user owns and can author into. `apply` upserts one declaration
 * through the panel's host — which is where property/value validation lives —
 * and `remove` drops it. A state rule cannot fail to remove one, so it reports
 * nothing back and the pane keeps whatever feedback is already showing.
 */
type StyleBlock = {
  rows: DeclarationRow[];
  apply: (name: string, value: string) => StyleResult;
  remove: (name: string) => StyleResult | undefined;
};

/** Which half of which declaration is open. `row: "new"` is the blank slot at
 *  the end of a block, where a declaration is typed before it exists. */
type StyleEdit = {
  block: string;
  row: number | "new";
  field: "property" | "value";
};

/** The blank slot's contents: a property with no value yet is not CSS, so it
 *  lives here until both halves are typed and the host can validate it. */
type PendingDeclaration = { block: string; name: string; value: string };

/**
 * What the panel remembers about one rule that the page cannot hold for it.
 * Switching a declaration off means deleting it from the page, so its text has
 * to survive here; re-enabling re-appends it, so the order it was shown in has
 * to survive too, or the row would jump to the bottom of the rule.
 */
type BlockEdits = { disabled: Declaration[]; order: string[] };

const NO_EDITS: BlockEdits = { disabled: [], order: [] };

/**
 * Everything the Styles pane owns about the element it is showing. Keyed by
 * element so a new selection starts clean by comparison, with no reset effect
 * and no frame where the last element's editor is open over the new one's CSS.
 */
type StylesState = {
  element: Element | null;
  edit: StyleEdit | null;
  pending: PendingDeclaration | null;
  blocks: Record<string, BlockEdits>;
};

const NO_STYLES_STATE: StylesState = {
  element: null,
  edit: null,
  pending: null,
  blocks: {},
};

/**
 * Interleaves a rule's live declarations with the ones switched off, following
 * the display order captured when a row was switched off. Anything that order
 * does not know about — a declaration added since — keeps the page's own
 * position, at the end.
 */
function mergeDeclarations(
  live: readonly Declaration[],
  edits: BlockEdits,
): DeclarationRow[] {
  const byName = new Map<string, DeclarationRow>();
  for (const entry of live) byName.set(entry.name, { ...entry, enabled: true });
  for (const entry of edits.disabled) {
    byName.set(entry.name, { ...entry, enabled: false });
  }

  const rows: DeclarationRow[] = [];
  for (const name of edits.order) {
    const row = byName.get(name);
    if (row) {
      rows.push(row);
      byName.delete(name);
    }
  }
  rows.push(...byName.values());
  return rows;
}

/** The authoring surface, threaded from the panel into each editable rule. */
type StyleEditing = {
  edit: StyleEdit | null;
  pending: PendingDeclaration | null;
  onStart: (edit: StyleEdit) => void;
  /** Returns false when the edit was rejected and the editor stays open. */
  onCommit: (edit: StyleEdit, draft: string, via: CommitVia) => boolean;
  onCancel: () => void;
  onToggle: (block: string, row: number, enabled: boolean) => void;
  onDelete: (block: string, row: number) => void;
  onStartNew: (block: string) => void;
};

/**
 * One line of an authored rule: `[x] property: value;`.
 *
 * The property and the value are plain colored text until they are clicked,
 * at which point the same text is replaced in place by an editor with
 * identical metrics — the line never changes height and barely changes width.
 * The checkbox in the gutter switches the declaration off without losing it;
 * the trailing X drops it for good. Both are revealed by hovering the row, by
 * focus, or unconditionally on a device with no hover.
 */
function AuthoredDeclaration({
  row,
  block,
  index,
  editing,
}: {
  row: DeclarationRow;
  block: string;
  /** The row's position, or "new" for the block's blank slot. */
  index: number | "new";
  editing: StyleEditing;
}) {
  const open = editing.edit;
  const isOpen = (field: StyleEdit["field"]) =>
    open?.block === block && open.row === index && open.field === field;

  const start = (field: StyleEdit["field"]) => (event: React.MouseEvent) => {
    event.stopPropagation();
    editing.onStart({ block, row: index, field });
  };

  const editor = (
    field: StyleEdit["field"],
    initial: string,
    label: string,
  ) => (
    <InlineEditor
      tone={field}
      initial={initial}
      label={label}
      onCommit={(draft, via) =>
        editing.onCommit({ block, row: index, field }, draft, via)
      }
      onCancel={editing.onCancel}
    />
  );

  const named = row.name || "new declaration";

  return (
    <CssDeclaration data-declaration="">
      {index === "new" ? (
        <DeclarationGutter />
      ) : (
        <DeclarationToggle $alwaysVisible={!row.enabled}>
          <Input
            type="checkbox"
            id={`inspector-declaration-${block}-${row.name}`}
            checked={row.enabled}
            aria-label={`${row.enabled ? "Disable" : "Enable"} ${row.name}`}
            onChange={(event) =>
              editing.onToggle(block, index, event.target.checked)
            }
          />
        </DeclarationToggle>
      )}
      {/* Blank space to the right of a declaration edits its value, as in
          DevTools; the property and value spans stop their own clicks here. */}
      <DeclarationText $disabled={!row.enabled} onClick={start("value")}>
        {isOpen("property") ? (
          editor("property", row.name, `Edit property name of ${named}`)
        ) : (
          <CssProperty $editable onClick={start("property")}>
            {row.name || " "}
          </CssProperty>
        )}
        <Punct>: </Punct>
        {isOpen("value") ? (
          editor("value", row.value, `Edit value of ${named}`)
        ) : (
          <CssValue $editable>{row.value || " "}</CssValue>
        )}
        <Punct>;</Punct>
      </DeclarationText>
      {index !== "new" && (
        <DeclarationActions>
          <IconButton
            aria-label={`Delete ${row.name}`}
            onClick={(event) => {
              event.stopPropagation();
              editing.onDelete(block, index);
            }}
          >
            <Icon name="X" size={11} />
          </IconButton>
        </DeclarationActions>
      )}
    </CssDeclaration>
  );
}

/**
 * A rule the user authors into: `element.style` and the forced-state rules.
 * Clicking anywhere that is not a declaration — the selector line, the braces,
 * the empty space between them — starts a new declaration, the way DevTools
 * lets you type straight into a rule. The closing brace carries the same
 * affordance for the keyboard, where there is nothing to click with.
 */
function AuthoredRuleBlock({
  id,
  header,
  rows,
  label,
  editing,
}: {
  id: string;
  header: React.ReactNode;
  rows: DeclarationRow[];
  /** Names the rule for assistive tech, e.g. "element.style". */
  label: string;
  editing: StyleEditing;
}) {
  const pending = editing.pending?.block === id ? editing.pending : null;
  const startNew = () => editing.onStartNew(id);

  return (
    <CssBlock
      $editable
      onClick={(event) => {
        // Declarations handle their own clicks, including their blank space.
        if ((event.target as HTMLElement).closest("[data-declaration]")) return;
        startNew();
      }}
    >
      {header}
      {rows.map((row, index) => (
        <AuthoredDeclaration
          key={row.name}
          row={row}
          block={id}
          index={index}
          editing={editing}
        />
      ))}
      {pending && (
        <AuthoredDeclaration
          row={{ name: pending.name, value: pending.value, enabled: true }}
          block={id}
          index="new"
          editing={editing}
        />
      )}
      <RuleFooter
        role="button"
        tabIndex={0}
        aria-label={`Add a declaration to ${label}`}
        title={`Add a declaration to ${label}`}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          startNew();
        }}
      >
        <Punct>{"}"}</Punct>
      </RuleFooter>
    </CssBlock>
  );
}

/* ----------------------------------------------------------------- panel */

export type ElementsPanelProps = {
  root: Element;
  selectedElement: StylableElement | null;
  snapshot: ElementSnapshot | null;
  onSelectElement: (element: StylableElement) => void;
  /** Paints or clears the page-side highlight while tree rows are hovered. */
  onHoverElement: (element: Element | null) => void;
  onApplyStyle: (
    property: string,
    value: string,
  ) => { error: boolean; message: string };
  /** Removes one declaration from the element's inline `style`. */
  onRemoveStyle: (property: string) => { error: boolean; message: string };
  /**
   * One attribute edit from the tree. `previousName` null adds, an empty
   * `name` removes `previousName`, a null `value` keeps the current value.
   */
  onEditAttribute: (
    element: Element,
    previousName: string | null,
    name: string,
    value: string | null,
  ) => { error: boolean; message: string };
  /** Replaces a text-only element's content from the tree. */
  onEditText: (
    element: Element,
    text: string,
  ) => { error: boolean; message: string };
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
  onEditAttribute,
  onEditText,
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
  const [styles, setStyles] = useState<StylesState>(NO_STYLES_STATE);
  const [stateTarget, setStateTarget] = useState<PseudoState>("hover");
  const [stateProperty, setStateProperty] = useState("");
  const [stateValue, setStateValue] = useState("");
  const [feedback, setFeedback] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [treeEdit, setTreeEdit] = useState<TreeEdit | null>(null);
  /** True while the copy button wears its "done" checkmark. */
  const [copied, setCopied] = useState(false);

  const selectedRowRef = useRef<HTMLDivElement | null>(null);
  const copyTimer = useRef<number | null>(null);

  /* A new selection gets a fresh copy button, and no timer outlives us. */
  useEffect(() => {
    setCopied(false);
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, [selectedElement]);

  const copySelectedElement = async () => {
    if (!selectedElement) return;
    if (!(await copyText(serializeElement(selectedElement)))) return;
    setCopied(true);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(
      () => setCopied(false),
      COPY_FEEDBACK_MS,
    );
  };

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
    if (element instanceof HTMLElement || element instanceof SVGElement) {
      onSelectElement(element);
    }
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

  /* ------------------------------------------------------ style authoring */

  /* The pane's own state only counts while it still describes the element on
     screen; a new selection reads as empty without a reset pass. */
  const styleState =
    styles.element === selectedElement ? styles : NO_STYLES_STATE;

  /**
   * Every rule the user can author into, by id: `element.style` first, then
   * one per pseudo-state that has declarations (or a half-typed one). Each
   * carries its merged rows plus the host callbacks that validate and apply
   * them, so the editing handlers below never care which kind of rule they
   * are working on.
   */
  const styleBlocks: Record<string, StyleBlock> = {
    [INLINE_BLOCK]: {
      rows: mergeDeclarations(
        snapshot?.inlineStyles ?? [],
        styleState.blocks[INLINE_BLOCK] ?? NO_EDITS,
      ),
      apply: onApplyStyle,
      remove: onRemoveStyle,
    },
  };

  const stateBlocks = PSEUDO_STATES.map((state) => {
    const id = `state:${state}`;
    return {
      state,
      id,
      rows: mergeDeclarations(
        stateStyles[state],
        styleState.blocks[id] ?? NO_EDITS,
      ),
    };
  }).filter(
    (block) => block.rows.length > 0 || styleState.pending?.block === block.id,
  );

  for (const block of stateBlocks) {
    styleBlocks[block.id] = {
      rows: block.rows,
      apply: (name, declarationValue) =>
        onAddStateStyle(block.state, name, declarationValue),
      remove: (name) => {
        onRemoveStateStyle(block.state, name);
        return undefined;
      },
    };
  }

  /** Folds a change into the pane state, re-keying it to the shown element. */
  const updateStyles = (
    change: (current: StylesState) => Partial<StylesState>,
  ) =>
    setStyles((current) => {
      const base =
        current.element === selectedElement
          ? current
          : { ...NO_STYLES_STATE, element: selectedElement };
      return { ...base, ...change(base) };
    });

  const withBlock = (
    base: StylesState,
    id: string,
    update: (edits: BlockEdits) => BlockEdits,
  ) => ({ ...base.blocks, [id]: update(base.blocks[id] ?? NO_EDITS) });

  /**
   * The enable/disable checkbox. Switching off deletes the declaration from
   * the page — nothing else can stop an inline style applying — and parks its
   * text here along with the order it was shown in; switching back on replays
   * it through the same validated apply path everything else uses.
   */
  const toggleDeclaration = (id: string, index: number, enabled: boolean) => {
    const block = styleBlocks[id];
    const row = block?.rows[index];
    if (!row) return;

    if (enabled) {
      const result = block.apply(row.name, row.value);
      setFeedback(result);
      if (result.error) return;
      updateStyles((base) => ({
        blocks: withBlock(base, id, (edits) => ({
          ...edits,
          disabled: edits.disabled.filter((entry) => entry.name !== row.name),
        })),
      }));
      return;
    }

    const result = block.remove(row.name);
    if (result) setFeedback(result);
    if (result?.error) return;
    updateStyles((base) => ({
      edit: null,
      blocks: withBlock(base, id, (edits) => ({
        disabled: [...edits.disabled, { name: row.name, value: row.value }],
        order: block.rows.map((entry) => entry.name),
      })),
    }));
  };

  /** The trailing X: gone from the page and from the pane's memory alike. */
  const deleteDeclaration = (id: string, index: number) => {
    const block = styleBlocks[id];
    const row = block?.rows[index];
    if (!row) return;

    if (row.enabled) {
      const result = block.remove(row.name);
      if (result) setFeedback(result);
      if (result?.error) return;
    }
    updateStyles((base) => ({
      edit: null,
      blocks: withBlock(base, id, (edits) => ({
        ...edits,
        disabled: edits.disabled.filter((entry) => entry.name !== row.name),
      })),
    }));
  };

  const startNewDeclaration = (id: string) =>
    updateStyles(() => ({
      pending: { block: id, name: "", value: "" },
      edit: { block: id, row: "new", field: "property" },
    }));

  /**
   * One finished inline edit. Enter and Tab keep a rejected edit open so the
   * typo can be fixed in place; blur always closes, because the pointer has
   * already moved on and a field that refuses to let go is worse than a lost
   * keystroke.
   */
  const commitStyleEdit = (
    edit: StyleEdit,
    draft: string,
    via: CommitVia,
  ): boolean => {
    const block = styleBlocks[edit.block];
    if (!block) return true;
    const text = draft.trim();
    const abandon = () => updateStyles(() => ({ edit: null, pending: null }));

    /* The blank slot: neither half is CSS on its own, so nothing reaches the
       page until the value is committed. */
    if (edit.row === "new") {
      const pending = styleState.pending;
      if (!pending || pending.block !== edit.block) return true;

      if (edit.field === "property") {
        if (!text || via === "blur" || via === "tab-back") {
          abandon();
          return true;
        }
        updateStyles(() => ({
          pending: { ...pending, name: text },
          edit: { ...edit, field: "value" },
        }));
        return true;
      }

      if (via === "tab-back") {
        updateStyles(() => ({
          pending: { ...pending, value: text },
          edit: { ...edit, field: "property" },
        }));
        return true;
      }
      if (!text) {
        abandon();
        return true;
      }

      const result = block.apply(pending.name, text);
      setFeedback(result);
      if (result.error) {
        if (via !== "blur") return false;
        abandon();
        return true;
      }
      // Enter or Tab on the last value offers the next blank slot, so a run
      // of declarations can be typed without reaching for the pointer.
      if (via === "blur") abandon();
      else startNewDeclaration(edit.block);
      return true;
    }

    /* Bound to a const: the closures below outlive this narrowing otherwise. */
    const at = edit.row;
    const row = block.rows[at];
    if (!row) return true;
    const isLast = at === block.rows.length - 1;

    if (edit.field === "property") {
      // An emptied property name removes the declaration, as in DevTools.
      if (!text) {
        deleteDeclaration(edit.block, at);
        return true;
      }

      if (text !== row.name) {
        if (row.enabled) {
          // The new name goes on first: removing first would lose the old
          // declaration whenever the rename turns out not to be valid CSS.
          const result = block.apply(text, row.value);
          setFeedback(result);
          if (result.error) {
            if (via !== "blur") return false;
            updateStyles(() => ({ edit: null }));
            return true;
          }
          block.remove(row.name);
        }
        updateStyles((base) => ({
          blocks: withBlock(base, edit.block, (edits) => ({
            disabled: edits.disabled.map((entry) =>
              entry.name === row.name ? { ...entry, name: text } : entry,
            ),
            // A renamed declaration re-appends to the page; keep its slot.
            order: (edits.order.length
              ? edits.order
              : block.rows.map((entry) => entry.name)
            ).map((name) => (name === row.name ? text : name)),
          })),
        }));
      }

      updateStyles(() => ({
        edit:
          via === "enter" || via === "tab"
            ? { ...edit, field: "value" }
            : via === "tab-back" && at > 0
              ? { block: edit.block, row: at - 1, field: "value" }
              : null,
      }));
      return true;
    }

    // An emptied value removes the declaration too, the way DevTools does it.
    if (!text) {
      deleteDeclaration(edit.block, at);
      return true;
    }

    if (text !== row.value) {
      if (row.enabled) {
        const result = block.apply(row.name, text);
        setFeedback(result);
        if (result.error) {
          if (via !== "blur") return false;
          updateStyles(() => ({ edit: null }));
          return true;
        }
      } else {
        updateStyles((base) => ({
          blocks: withBlock(base, edit.block, (edits) => ({
            ...edits,
            disabled: edits.disabled.map((entry) =>
              entry.name === row.name ? { ...entry, value: text } : entry,
            ),
          })),
        }));
      }
    }

    if (via === "tab-back") {
      updateStyles(() => ({ edit: { ...edit, field: "property" } }));
      return true;
    }
    if (via === "tab" && !isLast) {
      updateStyles(() => ({
        edit: { block: edit.block, row: at + 1, field: "property" },
      }));
      return true;
    }
    if (isLast && (via === "tab" || via === "enter")) {
      startNewDeclaration(edit.block);
      return true;
    }
    updateStyles(() => ({ edit: null }));
    return true;
  };

  const styleEditing: StyleEditing = {
    edit: styleState.edit,
    pending: styleState.pending,
    onStart: (edit) => updateStyles(() => ({ edit })),
    onCommit: commitStyleEdit,
    onCancel: () => updateStyles(() => ({ edit: null, pending: null })),
    onToggle: toggleDeclaration,
    onDelete: deleteDeclaration,
    onStartNew: startNewDeclaration,
  };

  /** Applies a finished tree edit; false keeps the editor open to fix it. */
  const commitTreeEdit = (
    edit: TreeEdit,
    draft: string,
    via: CommitVia,
  ): boolean => {
    if (edit.kind === "attr-name") {
      const result = onEditAttribute(edit.element, edit.name, draft, null);
      setFeedback(result);
      if (result.error) return false;
      const nextName = draft.trim();
      // Tab walks name → value, as in Chrome; a removal has no value to edit.
      setTreeEdit(
        via === "tab" && nextName
          ? { kind: "attr-value", element: edit.element, name: nextName }
          : null,
      );
      return true;
    }

    if (edit.kind === "attr-value") {
      const result = onEditAttribute(edit.element, edit.name, edit.name, draft);
      setFeedback(result);
      if (result.error) return false;
      if (via === "tab") {
        // Value → next attribute's name, or the add box after the last one.
        const names = Array.from(edit.element.attributes).map(
          (attribute) => attribute.name,
        );
        const next = names[names.indexOf(edit.name) + 1];
        setTreeEdit(
          next
            ? { kind: "attr-name", element: edit.element, name: next }
            : { kind: "attr-add", element: edit.element },
        );
      } else {
        setTreeEdit(null);
      }
      return true;
    }

    if (edit.kind === "attr-add") {
      if (!draft.trim()) {
        setTreeEdit(null);
        return true;
      }
      const parsed = parseAttributeInput(draft);
      if (!parsed) {
        setFeedback({
          error: true,
          message: 'Type an attribute as name="value".',
        });
        return false;
      }
      const result = onEditAttribute(
        edit.element,
        null,
        parsed.name,
        parsed.value,
      );
      setFeedback(result);
      if (result.error) return false;
      setTreeEdit(null);
      return true;
    }

    const result = onEditText(edit.element, draft);
    setFeedback(result);
    if (result.error) return false;
    setTreeEdit(null);
    return true;
  };

  const treeEditing: TreeEditing = {
    edit: treeEdit,
    onStart: setTreeEdit,
    onCommit: commitTreeEdit,
    onCancel: () => setTreeEdit(null),
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
                    <OpenTag element={row.element} editing={treeEditing} />
                    {row.hasChildren && !row.expanded && (
                      <>
                        <Ellipsis>…</Ellipsis>
                        <ClosingTag element={row.element} />
                      </>
                    )}
                    {!row.hasChildren && !selfClosing && (
                      <>
                        {treeEdit?.kind === "text" &&
                        treeEdit.element === row.element ? (
                          <InlineEditor
                            initial={row.element.textContent ?? ""}
                            label={`Edit text of ${describeElement(row.element)}`}
                            onCommit={(draft, via) =>
                              commitTreeEdit(treeEdit, draft, via)
                            }
                            onCancel={() => setTreeEdit(null)}
                          />
                        ) : (
                          <TextNode
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              setTreeEdit({
                                kind: "text",
                                element: row.element,
                              });
                            }}
                          >
                            {truncate(text, 80)}
                          </TextNode>
                        )}
                        <ClosingTag element={row.element} />
                      </>
                    )}
                  </RowContent>
                  {isSelected && (
                    <RowActions>
                      <IconButton
                        aria-label={`Copy outerHTML of ${describeElement(row.element)}`}
                        title="Copy element"
                        onClick={(event) => {
                          event.stopPropagation();
                          void copySelectedElement();
                        }}
                      >
                        <Icon name={copied ? "Check" : "Copy"} size={11} />
                      </IconButton>
                    </RowActions>
                  )}
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
              <AuthoredRuleBlock
                id={INLINE_BLOCK}
                label="element.style"
                rows={styleBlocks[INLINE_BLOCK].rows}
                editing={styleEditing}
                header={
                  <>
                    <CssSelector>element.style</CssSelector>{" "}
                    <Punct>{"{"}</Punct>
                  </>
                }
              />
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

              {stateBlocks.map((block) => (
                <AuthoredRuleBlock
                  key={block.id}
                  id={block.id}
                  label={`${snapshot.selector}:${block.state}`}
                  rows={block.rows}
                  editing={styleEditing}
                  header={
                    <RuleHeader>
                      <span>
                        <CssSelector>
                          {snapshot.selector}:{block.state}
                        </CssSelector>{" "}
                        <Punct>{"{"}</Punct>
                      </span>
                    </RuleHeader>
                  }
                />
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
                        {/* Empty gutter: a read-only rule has no checkbox, but
                            its property names line up with the ones that do. */}
                        <DeclarationGutter />
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
