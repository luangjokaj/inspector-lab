import type { ReactNode } from "react";
import { ClientThemeProvider } from "cherry-styled-components";
import { theme, themeDark } from "~lib/theme";

function resolveInitialTheme(): "light" | "dark" {
  try {
    const stored = localStorage.theme;
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // Fall back to the operating-system preference.
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

const INITIAL_THEME = resolveInitialTheme();

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ClientThemeProvider
      theme={theme}
      themeDark={themeDark}
      $initial={INITIAL_THEME}
      $themeColor={false}
    >
      {children}
    </ClientThemeProvider>
  );
}
