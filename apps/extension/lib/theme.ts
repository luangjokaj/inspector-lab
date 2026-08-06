import {
  theme as base,
  themeDark as baseDark,
  type Theme,
} from "cherry-styled-components";

/**
 * Design tokens for the in-page inspector, which deliberately mirrors Chrome
 * DevTools rather than the Cherry look used by the popup. They live on the
 * theme (instead of being hardcoded in the components) so both modes stay in
 * one place and every DevTools surface reads the same values.
 *
 * Values follow Chrome's own DevTools front-end (devtools-frontend@main with
 * the default `baseline-grayscale` theme, var() chains fully resolved): light
 * toolbar #ececec / divider #e3e3e3 / primary #0b57d0, dark toolbar #3c3c3c /
 * divider #5e5e5e / primary #a8c7fa.
 */
export interface DevtoolsTokens {
  /** UI chrome: toolbars, tabs, labels. Small system sans, like DevTools. */
  fontFamily: string;
  /** Code, DOM nodes, computed values, console output. */
  monoFamily: string;
  fontSize: string;
  fontSizeSmall: string;
  monoFontSize: string;
  lineHeight: string;
  /** Height of a toolbar row and of the main tab strip. */
  toolbarHeight: string;
  tabHeight: string;
  /** A single dense tree/grid row. DevTools packs these tightly. */
  rowHeight: string;
  /** Horizontal offset added per DOM tree depth level. */
  treeIndent: string;

  /** Panel body background (white in light mode). */
  surface: string;
  /** Slightly recessed background for sidebars and empty states. */
  surfaceSubtle: string;
  /** Toolbar and tab strip background. */
  toolbar: string;
  /** 1px separators: the workhorse border of the whole UI. */
  border: string;
  /** Heavier separator for pane splits. */
  borderStrong: string;

  text: string;
  textSubtle: string;
  textDisabled: string;
  accent: string;
  accentSubtle: string;
  focusRing: string;

  tabText: string;
  /** Selected tabs recolor to the primary blue; the background never changes. */
  tabSelectedText: string;
  tabHoverBackground: string;
  /** The 3px rounded slider bar under the selected tab. */
  tabIndicator: string;

  rowHover: string;
  /** Selected row while the tree has focus. */
  rowSelected: string;
  /** Selected row while focus is elsewhere. */
  rowSelectedBlur: string;
  rowStripe: string;

  scrollbarThumb: string;
  scrollbarThumbHover: string;

  /** Highlight painted over the picked element on the host page. */
  highlightFill: string;
  highlightBorder: string;

  /**
   * The Computed pane's box-model diagram. Chrome uses the same pastel fills
   * in both modes, so the label text is always dark.
   */
  boxModel: {
    margin: string;
    border: string;
    padding: string;
    content: string;
    text: string;
  };

  /** Elements panel / source syntax highlighting. */
  syntax: {
    tag: string;
    attributeName: string;
    attributeValue: string;
    text: string;
    comment: string;
    doctype: string;
    punctuation: string;
    property: string;
    value: string;
    number: string;
    string: string;
    keyword: string;
  };

  /** Console message levels and Network status coloring. */
  status: {
    error: string;
    errorBackground: string;
    errorBorder: string;
    warning: string;
    warningBackground: string;
    warningBorder: string;
    info: string;
    success: string;
  };
}

/** The Cherry theme plus the inspector's DevTools tokens. */
export interface AppTheme extends Theme {
  devtools: DevtoolsTokens;
}

/**
 * Metrics are identical in both modes — DevTools only swaps color — so they
 * are declared once and spread into each theme.
 */
const devtoolsMetrics = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  monoFamily:
    'Menlo, Monaco, "SF Mono", "Roboto Mono", Consolas, "Liberation Mono", "Courier New", monospace',
  fontSize: "12px",
  fontSizeSmall: "11px",
  monoFontSize: "11px",
  lineHeight: "1.4",
  toolbarHeight: "27px",
  tabHeight: "27px",
  rowHeight: "15px",
  treeIndent: "12px",
  highlightFill: "rgba(111, 168, 220, 0.66)",
  highlightBorder: "rgba(255, 229, 153, 0.9)",
  boxModel: {
    margin: "#f9cc9d",
    border: "#fdd291",
    padding: "#c3d08b",
    content: "#a1c2cf",
    text: "#222222",
  },
} satisfies Partial<DevtoolsTokens>;

const devtoolsLight: DevtoolsTokens = {
  ...devtoolsMetrics,

  surface: "#ffffff",
  surfaceSubtle: "#f8f9fa",
  toolbar: "#ececec",
  border: "#e3e3e3",
  borderStrong: "#c7c7c7",

  text: "#1f1f1f",
  textSubtle: "#474747",
  textDisabled: "#9aa0a6",
  accent: "#0b57d0",
  accentSubtle: "rgba(11, 87, 208, 0.08)",
  focusRing: "#0b57d0",

  tabText: "#474747",
  tabSelectedText: "#0b57d0",
  tabHoverBackground: "rgb(31 31 31 / 6%)",
  tabIndicator: "#0b57d0",

  rowHover: "rgb(31 31 31 / 6%)",
  rowSelected: "#d3e3fd",
  rowSelectedBlur: "#f2f2f2",
  rowStripe: "#f8f9fa",

  scrollbarThumb: "rgba(0, 0, 0, 0.28)",
  scrollbarThumbHover: "rgba(0, 0, 0, 0.44)",

  syntax: {
    tag: "#8e004b",
    attributeName: "#9f4312",
    attributeValue: "#0842a0",
    text: "#1f1f1f",
    comment: "#146c2e",
    doctype: "#757575",
    punctuation: "#474747",
    property: "#c80000",
    value: "#0842a0",
    number: "#1c00cf",
    string: "#c41a16",
    keyword: "#8e004b",
  },

  status: {
    error: "#c5221f",
    errorBackground: "#fff0f0",
    errorBorder: "#ffd6d6",
    warning: "#b06000",
    warningBackground: "#fffbe5",
    warningBorder: "#ffe4a3",
    info: "#0b57d0",
    success: "#188038",
  },
};

const devtoolsDark: DevtoolsTokens = {
  ...devtoolsMetrics,

  surface: "#1f1f1f",
  surfaceSubtle: "#282828",
  toolbar: "#3c3c3c",
  border: "#5e5e5e",
  borderStrong: "#757575",

  text: "#e3e3e3",
  textSubtle: "#c7c7c7",
  textDisabled: "#8f8f8f",
  accent: "#a8c7fa",
  accentSubtle: "rgba(168, 199, 250, 0.15)",
  focusRing: "#a8c7fa",

  tabText: "#c7c7c7",
  tabSelectedText: "#a8c7fa",
  tabHoverBackground: "rgb(253 252 251 / 10%)",
  tabIndicator: "#a8c7fa",

  rowHover: "rgb(253 252 251 / 10%)",
  rowSelected: "#004a77",
  rowSelectedBlur: "#3c3c3c",
  rowStripe: "#282828",

  scrollbarThumb: "rgba(255, 255, 255, 0.3)",
  scrollbarThumbHover: "rgba(255, 255, 255, 0.45)",

  syntax: {
    tag: "#7cacf8",
    attributeName: "#a8c7fa",
    attributeValue: "#fe8d59",
    text: "#e3e3e3",
    comment: "#ababab",
    doctype: "#8f8f8f",
    punctuation: "#c7c7c7",
    property: "#a8c7fa",
    value: "#fe8d59",
    number: "#9980ff",
    string: "#f28b54",
    keyword: "#7cacf8",
  },

  status: {
    error: "#f28b82",
    errorBackground: "#2a1618",
    errorBorder: "#5c2b2b",
    warning: "#fdd663",
    warningBackground: "#2a2413",
    warningBorder: "#5c4c1f",
    info: "#a8c7fa",
    success: "#81c995",
  },
};

export const theme: AppTheme = {
  ...base,
  colors: {
    ...base.colors,
    primaryLight: "#A8E8E0",
    primary: "#087F75",
    primaryDark: "#045E57",
    secondaryLight: "#F7DDA7",
    secondary: "#9A6400",
    secondaryDark: "#714A00",
  },
  fonts: {
    ...base.fonts,
    head: '"IBM Plex Sans Condensed", "Arial Narrow", sans-serif',
    text: '"IBM Plex Sans", sans-serif',
    mono: '"IBM Plex Mono", "SFMono-Regular", monospace',
  },
  devtools: devtoolsLight,
};

export const themeDark: AppTheme = {
  ...baseDark,
  colors: {
    ...baseDark.colors,
    primaryLight: "#8FF5E9",
    primary: "#2ED3C3",
    primaryDark: "#74E9DD",
    secondaryLight: "#FFE1A3",
    secondary: "#F2B84B",
    secondaryDark: "#FFD47C",
    grayLight: "#202B2A",
    gray: "#485957",
    grayDark: "#91A19F",
    light: "#0A0E0E",
  },
  fonts: {
    ...baseDark.fonts,
    head: '"IBM Plex Sans Condensed", "Arial Narrow", sans-serif',
    text: '"IBM Plex Sans", sans-serif',
    mono: '"IBM Plex Mono", "SFMono-Regular", monospace',
  },
  devtools: devtoolsDark,
};
