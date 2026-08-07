import {
  theme as base,
  themeDark as baseDark,
  alpha,
  shade,
  tint,
  type Theme,
} from "cherry-styled-components";

/**
 * Design tokens for the in-page inspector. By default it deliberately mirrors
 * Chrome DevTools rather than the Cherry look used by the popup; the popup's
 * "custom inspector theme" toggle swaps in `brandDevtools`, the same layout
 * recolored with the extension's own palette. Tokens live on the theme
 * (instead of being hardcoded in the components) so every mode and skin stays
 * in one place and every DevTools surface reads the same values.
 *
 * Default values follow Chrome's own DevTools front-end (devtools-frontend@
 * main with the default `baseline-grayscale` theme, var() chains fully
 * resolved): light toolbar #ececec / divider #e3e3e3 / primary #0b57d0, dark
 * toolbar #3c3c3c / divider #5e5e5e / primary #a8c7fa.
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
  /**
   * Smallest comfortable tap target. The inspector runs on iPads, where a
   * 15px row is unhittable — so rows keep their density and only their hit
   * areas grow to this, drawn as pseudo-elements that cost no layout.
   */
  touchTarget: string;

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
  touchTarget: "24px",
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

const brandColorsLight: Theme["colors"] = {
  ...base.colors,
  primaryLight: "#A8E8E0",
  primary: "#087F75",
  primaryDark: "#045E57",
  secondaryLight: "#F7DDA7",
  secondary: "#9A6400",
  secondaryDark: "#714A00",
};

const brandColorsDark: Theme["colors"] = {
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
};

const brandFonts = {
  head: '"IBM Plex Sans Condensed", "Arial Narrow", sans-serif',
  text: '"IBM Plex Sans", sans-serif',
  mono: '"IBM Plex Mono", "SFMono-Regular", monospace',
};

/** Opaque blend of `color` into `into` — alpha() flattened onto a base, so
 *  the result is safe for sticky headers and other stacked surfaces. */
const mix = (color: string, percent: number, into: string) =>
  `color-mix(in srgb, ${color} ${percent}%, ${into})`;

/**
 * The optional branded skin: the same DevTools layout recolored with the
 * extension's Cherry palette (teal primary, amber secondary). Everything
 * derives from the palette — no free-floating hex — so the popup and the
 * inspector can never drift apart. Metrics stay identical to the default
 * skin; only color changes. The box-model pastels are kept from Chrome:
 * margin-orange / padding-green carry meaning users already know.
 */
function brandDevtools(
  colors: Theme["colors"],
  isDark: boolean,
): DevtoolsTokens {
  /** Status hues are shared across modes; ink them toward the surface's
   *  opposite pole so 11px text stays readable. */
  const statusInk = (color: string) =>
    isDark ? tint(color, 30) : shade(color, 30);

  return {
    ...devtoolsMetrics,

    surface: colors.light,
    surfaceSubtle: mix(colors.dark, isDark ? 4 : 3, colors.light),
    toolbar: isDark ? colors.grayLight : mix(colors.primary, 8, colors.light),
    border: isDark ? colors.gray : colors.grayLight,
    borderStrong: isDark ? colors.grayDark : colors.gray,

    text: colors.dark,
    textSubtle: colors.grayDark,
    textDisabled: colors.gray,
    accent: colors.primary,
    accentSubtle: alpha(colors.primary, isDark ? 15 : 10),
    focusRing: colors.primary,

    tabText: colors.grayDark,
    tabSelectedText: colors.primary,
    tabHoverBackground: alpha(colors.dark, isDark ? 10 : 6),
    tabIndicator: colors.primary,

    rowHover: alpha(colors.dark, isDark ? 10 : 6),
    rowSelected: isDark
      ? mix(colors.primary, 30, colors.light)
      : mix(colors.primaryLight, 55, colors.light),
    rowSelectedBlur: isDark
      ? colors.grayLight
      : mix(colors.dark, 7, colors.light),
    rowStripe: mix(colors.dark, isDark ? 4 : 3, colors.light),

    scrollbarThumb: alpha(colors.dark, 30),
    scrollbarThumbHover: alpha(colors.dark, 45),

    highlightFill: alpha(colors.primary, 40),
    highlightBorder: alpha(colors.secondaryLight, 90),

    syntax: {
      tag: colors.primary,
      attributeName: colors.secondary,
      attributeValue: colors.primaryDark,
      text: colors.dark,
      comment: colors.grayDark,
      doctype: colors.gray,
      punctuation: colors.grayDark,
      property: colors.primary,
      value: colors.primaryDark,
      number: statusInk(colors.info),
      string: colors.secondaryDark,
      keyword: colors.primary,
    },

    status: {
      error: statusInk(colors.error),
      errorBackground: mix(colors.error, isDark ? 12 : 8, colors.light),
      errorBorder: mix(colors.error, isDark ? 35 : 25, colors.light),
      warning: statusInk(colors.warning),
      warningBackground: mix(colors.warning, 12, colors.light),
      warningBorder: mix(colors.warning, 35, colors.light),
      info: statusInk(colors.info),
      success: statusInk(colors.success),
    },
  };
}

export const theme: AppTheme = {
  ...base,
  colors: brandColorsLight,
  fonts: { ...base.fonts, ...brandFonts },
  devtools: devtoolsLight,
};

export const themeDark: AppTheme = {
  ...baseDark,
  colors: brandColorsDark,
  fonts: { ...baseDark.fonts, ...brandFonts },
  devtools: devtoolsDark,
};

/** The same themes with the inspector reskinned to the extension branding —
 *  the popup's "custom inspector theme" option. */
export const themeBranded: AppTheme = {
  ...theme,
  devtools: brandDevtools(brandColorsLight, false),
};

export const themeDarkBranded: AppTheme = {
  ...themeDark,
  devtools: brandDevtools(brandColorsDark, true),
};

/** Picks the inspector theme for a color-scheme + branding preference pair. */
export function resolveInspectorTheme(
  isDark: boolean,
  branded: boolean,
): AppTheme {
  if (branded) return isDark ? themeDarkBranded : themeBranded;
  return isDark ? themeDark : theme;
}
