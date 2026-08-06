import { useState } from "react";
import styled from "styled-components";
import {
  Button,
  Callout,
  Flex,
  Icon,
  ThemeToggle,
  alpha,
  styledH5,
  styledSmall,
  styledText,
} from "cherry-styled-components";
import inspectorBundleUrl from "url:./injected/inspector-entry.tsx";
import { ThemeProvider } from "~lib/ThemeProvider";

import "./popup.css";

const PopupShell = styled.main`
  width: 100%;
  min-height: 440px;
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
  margin: ${({ theme }) => theme.spacing.gridGap.xs} 0;
  color: ${({ theme }) => theme.colors.grayDark};
`;

const FeatureList = styled.ul`
  display: grid;
  gap: ${({ theme }) => theme.spacing.radius.xs};
  margin: 0 0 ${({ theme }) => theme.spacing.gridGap.xs};
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

function Popup() {
  const [launchState, setLaunchState] = useState<LaunchState>("idle");
  const [message, setMessage] = useState("");

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
      setMessage("Inspector launched. You can close this popup.");
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
          it, and point at any element without opening browser DevTools.
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
