import {
  theme as base,
  themeDark as baseDark,
  type Theme,
} from "cherry-styled-components";

export const theme: Theme = {
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
};

export const themeDark: Theme = {
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
};
