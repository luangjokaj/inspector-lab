import styled, { css } from "styled-components";
import { resetButton } from "cherry-styled-components";

/**
 * Shared building blocks for the DevTools-styled inspector. Every panel is
 * assembled from these so the chrome stays consistent, and every value comes
 * from `theme.devtools` so light and dark both work.
 */

/** Small system sans, the font DevTools uses for its own chrome. */
export const devtoolsUi = css`
  color: ${({ theme }) => theme.devtools.text};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSize};
  line-height: ${({ theme }) => theme.devtools.lineHeight};
`;

/** Monospace, for anything that is code: DOM nodes, values, console output. */
export const devtoolsMono = css`
  color: ${({ theme }) => theme.devtools.text};
  font-family: ${({ theme }) => theme.devtools.monoFamily};
  font-size: ${({ theme }) => theme.devtools.monoFontSize};
  line-height: ${({ theme }) => theme.devtools.rowHeight};
`;

/** The slim overlay scrollbar DevTools uses inside its panes. */
export const devtoolsScrollbar = css`
  scrollbar-width: thin;
  scrollbar-color: ${({ theme }) => theme.devtools.scrollbarThumb} transparent;

  &::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.devtools.scrollbarThumb};
    background-clip: padding-box;
    border: solid 2px transparent;
    border-radius: 10px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: ${({ theme }) => theme.devtools.scrollbarThumbHover};
    background-clip: padding-box;
  }

  &::-webkit-scrollbar-corner {
    background: transparent;
  }
`;

const focusRing = css`
  &:focus-visible {
    outline: solid 1px ${({ theme }) => theme.devtools.focusRing};
    outline-offset: -1px;
  }
`;

/* --------------------------------------------------------- touch & reveal */

/**
 * The visible half of a hover-revealed control. Pointer events come back with
 * it on purpose: a control left at `opacity: 0` still swallows the click that
 * lands on it, which on a touch screen means an invisible delete button.
 */
export const revealed = css`
  opacity: 1;
  pointer-events: auto;
`;

/**
 * A finger-sized hit area over a control, drawn as an absolutely positioned
 * pseudo-element so it costs no layout at all: DevTools' 15px rows keep their
 * density on a mouse while a tap still lands on `theme.devtools.touchTarget`.
 *
 * `anchor` is the edge the box hangs from, so it grows *away* from that edge
 * and into whatever empty space the control sits next to, rather than over the
 * text beside it. Anchor towards the nearest container edge: growing past the
 * right edge of a scroll container turns the extra pixels into a stray
 * horizontal scrollbar (overflow to the left is not scrollable, so that side
 * is free). The control has to be a containing block (`position: relative`).
 */
export const touchHitArea = (anchor: "left" | "right") => css`
  &::after {
    content: "";
    position: absolute;
    top: 50%;
    ${anchor}: 0;
    width: ${({ theme }) => theme.devtools.touchTarget};
    height: ${({ theme }) => theme.devtools.touchTarget};
    transform: translateY(-50%);
  }
`;

/**
 * A row-scale icon button — delete a cookie, drop a declaration. Flat and
 * square like the rest of the chrome, and out of the way until the row is
 * worth acting on: the consumer's own `:hover` rule reveals it (only the
 * consumer knows its row component), focus reveals it so the keyboard never
 * chases an invisible control, and a device with no hover shows it always.
 * Restyles the Cherry `IconButton` from the parent, never by wrapping it.
 *
 * The touch hit area is left to the consumer: which way a 24px box can grow
 * without overflowing its container is a question only the surrounding layout
 * can answer. See `touchHitArea`.
 */
export const rowActionButton = (size: number) => css`
  button {
    position: relative;
    width: ${size}px;
    height: ${size}px;
    min-width: ${size}px;
    padding: 0;
    color: ${({ theme }) => theme.devtools.textSubtle};
    background: transparent;
    border: none;
    border-radius: 2px;
    box-shadow: none;
    transition: none;
    opacity: 0;
    pointer-events: none;

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
      ${revealed};
    }
  }

  /* No hover to reveal anything with: an iPad gets the control outright. */
  @media (hover: none) {
    button {
      ${revealed};
    }
  }
`;

/**
 * Restyles the Cherry checkbox rendered inside into DevTools' 12px box:
 * a bare 1px outline that fills solid with the accent when checked, the
 * same everywhere one appears — the :hov state grid, declaration gutters.
 * Applied from the parent, never by wrapping the Cherry component.
 */
export const devtoolsCheckbox = css`
  /* Cherry wraps controls in spans; flatten them onto one line. */
  span {
    display: inline-flex;
    margin: 0;
  }

  /* Doubled ampersands out-specify Cherry's own control styling, which uses
     the same class+descendant specificity — injection order stops mattering. */
  && input {
    width: 12px;
    height: 12px;
    min-width: 12px;
    min-height: 12px;
    margin: 0;
    background: transparent;
    border: solid 1px ${({ theme }) => theme.devtools.textSubtle};
    border-radius: 2px;
    transition: none;

    /* Cherry tints the border on hover and halos it on focus/active;
       DevTools does neither — the only states are the fill and the ring. */
    &:hover,
    &:focus,
    &:active {
      border-color: ${({ theme }) => theme.devtools.textSubtle};
      box-shadow: none;
    }

    &:focus-visible {
      outline: solid 1px ${({ theme }) => theme.devtools.focusRing};
      outline-offset: 1px;
    }

    &:checked {
      background: ${({ theme }) => theme.devtools.accent};
      border-color: ${({ theme }) => theme.devtools.accent};
    }
  }

  /* Cherry's check mark, shrunk to sit inside the 12px box and recolored to
     read against the accent fill. The min-* pair is the load-bearing part:
     Cherry sizes the check with min-width / min-height 12px, which clamps
     any width override silently. */
  && svg {
    width: 8px;
    height: 8px;
    min-width: 8px;
    min-height: 8px;
    color: ${({ theme }) => theme.devtools.onAccent};
    stroke-width: 5.5px;
    transition: none;
  }
`;

/* ------------------------------------------------------------------ shell */

/** The whole floating window: a flat, square-cornered DevTools frame. */
export const InspectorWindow = styled.section<{ $floating: boolean }>`
  ${devtoolsUi};
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: ${({ theme }) => theme.devtools.surface};
  border: solid 1px ${({ theme }) => theme.devtools.border};
  /* Only the free-floating window casts a shadow — docked, it sits flush
     against a viewport edge like DevTools. Dark surfaces get a centered
     white halo instead of a drop, which disappears against dark pages. */
  box-shadow: ${({ theme, $floating }) =>
    !$floating
      ? "none"
      : theme.isDark
        ? "rgba(255, 255, 255, 0.24) 0px 0px 64px -12px"
        : theme.shadows.xl};
  box-sizing: border-box;

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
`;

/**
 * The top row: picker controls, the main tab strip, and window actions, all on
 * one line the way DevTools lays out its tabbed pane header. Doubles as the
 * drag handle — pointer handling skips buttons, so tabs stay clickable.
 */
export const WindowToolbar = styled.header<{ $dragging: boolean }>`
  display: flex;
  align-items: stretch;
  flex: 0 0 auto;
  min-height: ${({ theme }) => theme.devtools.toolbarHeight};
  background: ${({ theme }) => theme.devtools.toolbar};
  border-bottom: solid 1px ${({ theme }) => theme.devtools.border};
  cursor: ${({ $dragging }) => ($dragging ? "grabbing" : "grab")};
  user-select: none;
  touch-action: none;
`;

/** Fills the gap between the tabs and the window actions; also drag surface. */
export const ToolbarSpacer = styled.div`
  flex: 1 1 auto;
  min-width: 8px;
`;

/** A 1px vertical rule between toolbar groups. */
export const ToolbarDivider = styled.span`
  flex: 0 0 auto;
  align-self: center;
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: ${({ theme }) => theme.devtools.border};
`;

/**
 * Restyles the Cherry `IconButton`s rendered inside it into DevTools' flat,
 * square toolbar buttons. Cherry components are used directly in JSX (never
 * wrapped with `styled()`, which would strip their `$`-props); the override
 * happens here, from the parent.
 */
export const ToolbarControls = styled.div`
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 0;
  padding: 0 2px;

  button {
    width: 24px;
    height: 24px;
    min-width: 24px;
    padding: 0;
    color: ${({ theme }) => theme.devtools.textSubtle};
    background: transparent;
    border: none;
    border-radius: 2px;
    box-shadow: none;
    transition: none;

    svg {
      width: 14px;
      height: 14px;
    }

    &:hover:not(:disabled) {
      color: ${({ theme }) => theme.devtools.text};
      background: ${({ theme }) => theme.devtools.tabHoverBackground};
      border: none;
      box-shadow: none;
    }

    &:focus,
    &:active {
      box-shadow: none;
      border: none;
    }

    ${focusRing};

    /* Cherry marks an active IconButton with aria-pressed. */
    &[aria-pressed="true"] {
      color: ${({ theme }) => theme.devtools.accent};
      background: ${({ theme }) => theme.devtools.accentSubtle};
      border: none;
    }

    &:disabled {
      color: ${({ theme }) => theme.devtools.textDisabled};
      background: transparent;
      border: none;
    }
  }
`;

/* -------------------------------------------------------------- main tabs */

export const TabStrip = styled.div`
  display: flex;
  align-items: stretch;
  flex: 0 0 auto;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

/*
 * Chrome's tabbedPane.css: the selected tab keeps the header background and
 * recolors to the primary blue; the only selection marker is a 3px slider bar
 * with rounded top corners sitting on the header's bottom edge. No dividers
 * between tabs.
 */
export const Tab = styled.button<{ $selected: boolean }>`
  ${resetButton};
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  height: ${({ theme }) => theme.devtools.tabHeight};
  padding: 0 10px;
  color: ${({ theme, $selected }) =>
    $selected ? theme.devtools.tabSelectedText : theme.devtools.tabText};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSize};
  font-weight: 500;
  line-height: 16px;
  white-space: nowrap;
  background: transparent;
  cursor: default;

  &:hover {
    color: ${({ theme, $selected }) =>
      $selected ? theme.devtools.tabSelectedText : theme.devtools.text};
    background: ${({ theme }) => theme.devtools.tabHoverBackground};
  }

  ${focusRing};

  &::after {
    content: "";
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 3px;
    background: ${({ theme }) => theme.devtools.tabIndicator};
    border-radius: 9999px 9999px 0 0;
    opacity: ${({ $selected }) => ($selected ? 1 : 0)};
  }
`;

/* ------------------------------------------------------------- panel body */

/** Holds whichever panel is active; carries the `tabpanel` role. */
export const PanelHost = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
`;

/** A panel's root: fills the window below the toolbar and scrolls internally. */
export const Panel = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background: ${({ theme }) => theme.devtools.surface};
`;

/** A secondary toolbar inside a panel (filters, actions). */
export const PanelToolbar = styled.div`
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 4px;
  min-height: ${({ theme }) => theme.devtools.toolbarHeight};
  padding: 0 4px;
  background: ${({ theme }) => theme.devtools.toolbar};
  border-bottom: solid 1px ${({ theme }) => theme.devtools.border};
`;

/** Splits a panel into a main area and a right-hand sidebar. */
export const SplitView = styled.div`
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
`;

export const SplitMain = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
`;

export const SplitSidebar = styled.aside<{ $side?: "left" | "right" }>`
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  width: 260px;
  min-height: 0;
  background: ${({ theme }) => theme.devtools.surface};
  ${({ theme, $side }) =>
    $side === "left"
      ? css`
          border-right: solid 1px ${theme.devtools.border};
        `
      : css`
          border-left: solid 1px ${theme.devtools.border};
        `};
`;

/** Any scrolling region inside a panel. */
export const Scroller = styled.div`
  ${devtoolsScrollbar};
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
`;

/* ---------------------------------------------------------- sidebar tabs */

/** Sub-tabs such as Styles / Computed, underlined rather than filled. */
export const SubTabBar = styled.div`
  display: flex;
  align-items: stretch;
  flex: 0 0 auto;
  background: ${({ theme }) => theme.devtools.toolbar};
  border-bottom: solid 1px ${({ theme }) => theme.devtools.border};
`;

export const SubTab = styled.button<{ $selected: boolean }>`
  ${resetButton};
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  color: ${({ theme, $selected }) =>
    $selected ? theme.devtools.tabSelectedText : theme.devtools.tabText};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  white-space: nowrap;
  cursor: default;

  &:hover {
    color: ${({ theme, $selected }) =>
      $selected ? theme.devtools.tabSelectedText : theme.devtools.text};
    background: ${({ theme }) => theme.devtools.tabHoverBackground};
  }

  ${focusRing};

  &::after {
    content: "";
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 3px;
    background: ${({ theme }) => theme.devtools.tabIndicator};
    border-radius: 9999px 9999px 0 0;
    opacity: ${({ $selected }) => ($selected ? 1 : 0)};
  }
`;

/** Collapsible section heading inside a sidebar pane. */
export const PaneHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  color: ${({ theme }) => theme.devtools.textSubtle};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  background: ${({ theme }) => theme.devtools.surfaceSubtle};
  border-bottom: solid 1px ${({ theme }) => theme.devtools.border};
`;

/* --------------------------------------------------------------- content */

export const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 60px;
  padding: 16px;
  color: ${({ theme }) => theme.devtools.textSubtle};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSize};
  text-align: center;
`;

/** Bottom strip: breadcrumbs in Elements, request totals in Network. */
export const StatusBar = styled.div`
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 8px;
  min-height: 20px;
  padding: 0 6px;
  overflow-x: auto;
  color: ${({ theme }) => theme.devtools.textSubtle};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  white-space: nowrap;
  background: ${({ theme }) => theme.devtools.toolbar};
  border-top: solid 1px ${({ theme }) => theme.devtools.border};
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

/* ------------------------------------------------------------- data grid */

/** The Network request table, styled like DevTools' data grid. */
export const DataGrid = styled.table`
  width: 100%;
  border-collapse: collapse;
  border-spacing: 0;
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  table-layout: fixed;

  th,
  td {
    height: 18px;
    padding: 0 4px;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-right: solid 1px ${({ theme }) => theme.devtools.border};
  }

  th {
    position: sticky;
    top: 0;
    z-index: 1;
    color: ${({ theme }) => theme.devtools.textSubtle};
    font-weight: 400;
    background: ${({ theme }) => theme.devtools.toolbar};
    border-bottom: solid 1px ${({ theme }) => theme.devtools.border};
  }

  td {
    color: ${({ theme }) => theme.devtools.text};
    border-bottom: solid 1px transparent;
  }
`;

export const GridRow = styled.tr<{ $selected?: boolean }>`
  background: ${({ theme, $selected }) =>
    $selected ? theme.devtools.rowSelected : "transparent"};
  cursor: default;

  &:nth-of-type(even) {
    background: ${({ theme, $selected }) =>
      $selected ? theme.devtools.rowSelected : theme.devtools.rowStripe};
  }

  &:hover {
    background: ${({ theme, $selected }) =>
      $selected ? theme.devtools.rowSelected : theme.devtools.rowHover};
  }
`;

/**
 * Hover-revealed per-row action cell for data grids (delete a cookie, drop a
 * storage key). Restyles the Cherry `IconButton` inside from the parent, the
 * same way `ToolbarControls` does — never by wrapping the Cherry component.
 */
export const GridActionCell = styled.td`
  padding: 0;
  ${rowActionButton(16)};

  ${GridRow}:hover & button {
    ${revealed};
  }
`;

/* ------------------------------------------------------ cherry overrides */

/**
 * Shrinks the Cherry form controls rendered inside down to DevTools' compact
 * toolbar scale. Cherry's smallest input is 40px tall; DevTools' is ~19px.
 * Selectors target the rendered elements rather than Cherry's generated class
 * names, so they survive a library restyle.
 */
export const DevtoolsField = styled.div<{
  $grow?: boolean;
  /** Borderless variant, for the console prompt. */
  $plain?: boolean;
}>`
  display: flex;
  align-items: center;
  flex: ${({ $grow }) => ($grow ? "1 1 auto" : "0 0 auto")};
  min-width: 0;

  /*
   * Cherry wraps every control in a span and stacks label over field. The
   * direction has to be reset explicitly: overriding only the display
   * property leaves Cherry's own column direction in force.
   */
  > span {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    width: 100%;
    min-width: 0;
    margin: 0;
  }

  label {
    margin: 0;
    padding: 0;
    color: ${({ theme }) => theme.devtools.textSubtle};
    font-family: ${({ theme }) => theme.devtools.fontFamily};
    font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
    font-weight: 400;
    white-space: nowrap;
    transform: none;
  }

  input,
  select {
    width: 100%;
    min-width: 0;
    height: 19px;
    min-height: 19px;
    padding: 0 4px;
    color: ${({ theme }) => theme.devtools.text};
    font-family: ${({ theme }) => theme.devtools.fontFamily};
    font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
    background: ${({ theme }) => theme.devtools.surface};
    border: solid 1px ${({ theme }) => theme.devtools.border};
    border-radius: 2px;
    box-shadow: none;
    transition: none;

    &::placeholder {
      color: ${({ theme }) => theme.devtools.textDisabled};
    }

    &:hover {
      border-color: ${({ theme }) => theme.devtools.borderStrong};
    }

    &:focus,
    &:focus-visible {
      outline: none;
      border-color: ${({ theme }) => theme.devtools.accent};
      box-shadow: none;
    }
  }

  /* Room for Cherry's chevron, which is positioned over the right edge. */
  select {
    padding-right: 20px;
  }

  svg {
    position: absolute;
    right: 4px;
    width: 12px;
    height: 12px;
    color: ${({ theme }) => theme.devtools.textSubtle};
    pointer-events: none;
  }

  /* The chevron anchors to the control, not the field. */
  > span > span {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
  }

  ${({ $plain }) =>
    $plain &&
    css`
      /* Borderless and font-transparent: the surrounding surface decides the
         face — mono in the console's PromptRow, the grid font in a cell. */
      input {
        height: 100%;
        min-height: 16px;
        padding: 0;
        font-family: inherit;
        font-size: inherit;
        background: transparent;
        border: none;

        &:hover,
        &:focus,
        &:focus-visible {
          border: none;
          box-shadow: none;
        }
      }
    `};
`;

/**
 * Same idea for Cherry `Button`: DevTools' text buttons are small, flat and
 * square. Applied from the parent so `$size`/`$variant` still reach Cherry.
 */
export const DevtoolsButtonGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;

  button {
    min-width: 0;
    height: 20px;
    padding: 0 8px;
    color: ${({ theme }) => theme.devtools.text};
    font-family: ${({ theme }) => theme.devtools.fontFamily};
    font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
    background: ${({ theme }) => theme.devtools.toolbar};
    border: solid 1px ${({ theme }) => theme.devtools.border};
    border-radius: 2px;
    box-shadow: none;
    transition: none;

    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.devtools.tabHoverBackground};
      border-color: ${({ theme }) => theme.devtools.borderStrong};
      box-shadow: none;
    }

    ${focusRing};

    /* Toggle chips (Network type filters) mark themselves with aria-pressed. */
    &[aria-pressed="true"] {
      color: ${({ theme }) => theme.devtools.accent};
      background: ${({ theme }) => theme.devtools.accentSubtle};
      border-color: ${({ theme }) => theme.devtools.accent};
    }

    &:disabled {
      color: ${({ theme }) => theme.devtools.textDisabled};
    }
  }
`;
