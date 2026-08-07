import { useEffect, useState } from "react";
import styled, { useTheme } from "styled-components";
import {
  Button,
  Callout,
  Flex,
  Icon,
  ThemeToggle,
  Toggle,
  alpha,
  styledH5,
  styledSmall,
  styledText,
} from "cherry-styled-components";
import inspectorBundleUrl from "url:./injected/inspector-entry.tsx";
import { ThemeProvider } from "~lib/ThemeProvider";
import {
  readCustomThemeSetting,
  saveColorSchemeSetting,
  saveCustomThemeSetting,
} from "~lib/settings";

import "./popup.css";

const PopupShell = styled.main`
  display: flex;
  flex-direction: column;
  /* padding.xs and gridGap.xs are both 20px: one rhythm everywhere, and the
     popup hugs its content — no forced min-height. */
  gap: ${({ theme }) => theme.spacing.gridGap.xs};
  width: 100%;
  padding: ${({ theme }) => theme.spacing.padding.xs};
  box-sizing: border-box;
  color: ${({ theme }) => theme.colors.dark};
  background:
    linear-gradient(
      135deg,
      ${({ theme }) => alpha(theme.colors.primary, 13)},
      transparent 44%
    ),
    ${({ theme }) => theme.colors.light};
`;

const Header = styled.header`
  padding-bottom: ${({ theme }) => theme.spacing.gridGap.xs};
  border-bottom: solid 1px ${({ theme }) => theme.colors.grayLight};
`;

const Eyebrow = styled.span`
  ${({ theme }) => styledSmall(theme)};
  display: block;
  color: ${({ theme }) => theme.colors.primary};
  font-family: ${({ theme }) => theme.fonts.mono};
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const Title = styled.h1`
  ${({ theme }) => styledH5(theme)};
  margin: calc(${({ theme }) => theme.spacing.radius.xs} / 2) 0 0;
  font-family: ${({ theme }) => theme.fonts.head};
  letter-spacing: -0.02em;
`;

const Description = styled.p`
  ${({ theme }) => styledText(theme)};
  margin: 0;
  color: ${({ theme }) => theme.colors.grayDark};
`;

const FeatureList = styled.ul`
  display: grid;
  gap: ${({ theme }) => theme.spacing.radius.xs};
  margin: 0;
  padding: 0;
  list-style: none;
`;

const Feature = styled.li`
  ${({ theme }) => styledSmall(theme)};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.radius.xs};
  color: ${({ theme }) => theme.colors.grayDark};

  svg {
    color: ${({ theme }) => theme.colors.primary};
  }
`;

type LaunchState = "idle" | "loading" | "success" | "error";

const INSPECTOR_HOST_ID = "inspector-lab-extension-root";
const INSPECTOR_SHOW_EVENT = "inspector-lab:show";

function revealExistingInspector(hostId: string, showEvent: string): boolean {
  const host = document.getElementById(hostId);
  if (!host) return false;
  host.dispatchEvent(new Event(showEvent));
  return true;
}

function toExtensionPath(bundleUrl: string): string {
  const resolved = new URL(bundleUrl, chrome.runtime.getURL("/"));
  return resolved.pathname.replace(/^\//, "");
}

/**
 * chrome.cookies is gated on host permissions, which activeTab does not
 * extend to — without this grant the Cookies tab always reads empty. Asked
 * per site (never all sites), and only while the click gesture is fresh;
 * already-granted origins resolve true without showing a prompt.
 */
async function requestCookieAccess(tabUrl: string): Promise<boolean> {
  try {
    const origin = `${new URL(tabUrl).origin}/*`;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

/**
 * Mirrors the popup's light/dark choice (Cherry's ThemeToggle persists it in
 * popup-page localStorage only) into chrome.storage.local, so the injected
 * inspector follows the same mode. Must render inside the ThemeProvider.
 */
function ColorSchemeSync() {
  const theme = useTheme();
  useEffect(() => {
    void saveColorSchemeSetting(theme.isDark ? "dark" : "light");
  }, [theme.isDark]);
  return null;
}

function Popup() {
  const [launchState, setLaunchState] = useState<LaunchState>("idle");
  const [message, setMessage] = useState("");
  const [customTheme, setCustomTheme] = useState(true);

  useEffect(() => {
    void readCustomThemeSetting().then(setCustomTheme);
  }, []);

  /* Optimistic flip; an open inspector rethemes live via storage.onChanged. */
  function onCustomThemeChange(event: React.ChangeEvent<HTMLInputElement>) {
    const enabled = event.target.checked;
    setCustomTheme(enabled);
    void saveCustomThemeSetting(enabled).then((saved) => {
      if (!saved) setCustomTheme(!enabled);
    });
  }

  async function launchInspector() {
    setLaunchState("loading");
    setMessage("");

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab.id || !tab.url) {
        throw new Error("No active webpage is available.");
      }

      if (!/^(https?|file):/.test(tab.url)) {
        throw new Error(
          "Chrome protects this page. Open a regular website and try again.",
        );
      }

      // Before any await chains: permission prompts need the user gesture.
      const cookieAccess = /^https?:/.test(tab.url)
        ? await requestCookieAccess(tab.url)
        : false;

      const [existing] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: revealExistingInspector,
        args: [INSPECTOR_HOST_ID, INSPECTOR_SHOW_EVENT],
      });

      if (!existing.result) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [toExtensionPath(inspectorBundleUrl)],
        });
      }

      setLaunchState("success");
      setMessage(
        cookieAccess
          ? "Inspector launched. You can close this popup."
          : "Inspector launched. Cookie access was not granted, so the Cookies tab will stay empty on this site.",
      );
    } catch (error) {
      setLaunchState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The inspector could not open.",
      );
    }
  }

  return (
    <ThemeProvider>
      <ColorSchemeSync />
      <PopupShell>
        <Header>
          <Flex $alignItems="center" $justifyContent="space-between" $gap={12}>
            <div>
              <Eyebrow>Local instrument / 01</Eyebrow>
              <Title>Inspector Lab</Title>
            </div>
            <ThemeToggle aria-label="Toggle popup theme" />
          </Flex>
        </Header>

        <Description>
          Drop a lightweight inspector over the current page. Move it, resize
          it, and point at any element to inspect it right where it lives.
        </Description>

        <FeatureList>
          <Feature>
            <Icon name="Move" size={16} /> Drag from the instrument bar
          </Feature>
          <Feature>
            <Icon name="Scaling" size={16} /> Resize from the lower-right corner
          </Feature>
          <Feature>
            <Icon name="MousePointer2" size={16} /> Pick and inspect page
            elements
          </Feature>
        </FeatureList>

        <Toggle
          id="inspector-custom-theme"
          $label="Use custom inspector theme"
          checked={customTheme}
          onChange={onCustomThemeChange}
        />

        <Button
          $fullWidth
          $size="big"
          $icon={<Icon name="ScanSearch" />}
          disabled={launchState === "loading"}
          onClick={launchInspector}
        >
          {launchState === "loading" ? "Injecting…" : "Open page inspector"}
        </Button>

        {message && (
          <Callout
            $type={launchState === "error" ? "danger" : "success"}
            role="status"
          >
            {message}
          </Callout>
        )}
      </PopupShell>
    </ThemeProvider>
  );
}

export default Popup;
