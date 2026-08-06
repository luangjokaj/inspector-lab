import { useMemo, useState } from "react";
import styled from "styled-components";
import { Icon } from "cherry-styled-components";
import {
  EmptyState,
  PaneHeader,
  Panel,
  Scroller,
  SplitMain,
  SplitSidebar,
  SplitView,
  StatusBar,
  devtoolsMono,
} from "~injected/devtools.styled";
import { HOST_ID, truncate } from "~injected/inspector-dom";

/** Guards the editor pane against pathological inline scripts. */
const MAX_SOURCE_LENGTH = 60000;
const MAX_LINES = 2000;

type SourceKind = "document" | "stylesheet" | "script";

type SourceFile = {
  id: string;
  name: string;
  url: string;
  kind: SourceKind;
  /** Inline content, or null when the bytes live behind a network request. */
  content: string | null;
};

const NavRow = styled.button<{ $selected: boolean; $depth: number }>`
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: ${({ theme }) => theme.devtools.rowHeight};
  padding: 0 4px 0
    calc(
      4px + ${({ $depth }) => $depth} *
        ${({ theme }) => theme.devtools.treeIndent}
    );
  color: ${({ theme }) => theme.devtools.text};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  text-align: left;
  white-space: nowrap;
  background: ${({ theme, $selected }) =>
    $selected ? theme.devtools.rowSelected : "transparent"};
  border: none;
  cursor: default;

  &:hover {
    background: ${({ theme, $selected }) =>
      $selected ? theme.devtools.rowSelected : theme.devtools.rowHover};
  }

  &:focus-visible {
    outline: solid 1px ${({ theme }) => theme.devtools.focusRing};
    outline-offset: -1px;
  }

  svg {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    color: ${({ theme }) => theme.devtools.textSubtle};
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

const GroupRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  height: ${({ theme }) => theme.devtools.rowHeight};
  padding: 0 4px;
  color: ${({ theme }) => theme.devtools.textSubtle};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  white-space: nowrap;
`;

/** Line-numbered editor, mirroring the Sources code viewer. */
const Editor = styled.div`
  ${devtoolsMono};
  display: flex;
  align-items: flex-start;
  min-height: 100%;
`;

const Gutter = styled.pre`
  flex: 0 0 auto;
  margin: 0;
  padding: 4px 6px;
  color: ${({ theme }) => theme.devtools.textDisabled};
  font: inherit;
  text-align: right;
  background: ${({ theme }) => theme.devtools.surfaceSubtle};
  border-right: solid 1px ${({ theme }) => theme.devtools.border};
  user-select: none;
`;

const Code = styled.pre`
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 4px 8px;
  color: ${({ theme }) => theme.devtools.text};
  font: inherit;
  white-space: pre;
`;

const iconFor: Record<SourceKind, "Globe" | "Palette" | "FileCode"> = {
  document: "Globe",
  stylesheet: "Palette",
  script: "FileCode",
};

function fileNameFrom(url: string, fallback: string): string {
  try {
    const parsed = new URL(url, location.href);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last ?? parsed.host ?? fallback;
  } catch {
    return fallback;
  }
}

function hostFrom(url: string): string {
  try {
    return new URL(url, location.href).host || location.host;
  } catch {
    return location.host;
  }
}

/**
 * Lists what the page already has in the DOM. Inline `<style>` and `<script>`
 * bodies are shown verbatim; external resources are listed by URL only, since
 * fetching them would issue network requests the user did not ask for.
 */
function collectSources(): SourceFile[] {
  const files: SourceFile[] = [];

  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelector(`#${HOST_ID}`)?.remove();

  files.push({
    id: "document",
    name: fileNameFrom(location.href, "(index)"),
    url: location.href,
    kind: "document",
    content: truncate(clone.outerHTML, MAX_SOURCE_LENGTH),
  });

  document.querySelectorAll("style").forEach((style, index) => {
    files.push({
      id: `style-${index}`,
      name: `(inline stylesheet ${index + 1})`,
      url: location.href,
      kind: "stylesheet",
      content: truncate(style.textContent ?? "", MAX_SOURCE_LENGTH),
    });
  });

  document
    .querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')
    .forEach((link, index) => {
      files.push({
        id: `link-${index}`,
        name: fileNameFrom(link.href, "stylesheet.css"),
        url: link.href,
        kind: "stylesheet",
        content: null,
      });
    });

  document.querySelectorAll("script").forEach((script, index) => {
    if (script.src) {
      files.push({
        id: `script-${index}`,
        name: fileNameFrom(script.src, "script.js"),
        url: script.src,
        kind: "script",
        content: null,
      });
      return;
    }

    const body = script.textContent ?? "";
    if (!body.trim()) return;

    files.push({
      id: `script-${index}`,
      name: `(inline script ${index + 1})`,
      url: location.href,
      kind: "script",
      content: truncate(body, MAX_SOURCE_LENGTH),
    });
  });

  return files;
}

export function SourcesPanel() {
  const files = useMemo(collectSources, []);
  const [selectedId, setSelectedId] = useState<string>("document");

  const selected = files.find((file) => file.id === selectedId) ?? files[0];

  const groups = useMemo(() => {
    const byHost = new Map<string, SourceFile[]>();
    files.forEach((file) => {
      const host = hostFrom(file.url);
      const bucket = byHost.get(host);
      if (bucket) bucket.push(file);
      else byHost.set(host, [file]);
    });
    return Array.from(byHost.entries());
  }, [files]);

  const lines = useMemo(() => {
    if (!selected?.content) return [];
    return selected.content.split("\n").slice(0, MAX_LINES);
  }, [selected]);

  return (
    <Panel>
      <SplitView>
        <SplitSidebar $side="left">
          <PaneHeader>Page</PaneHeader>
          <Scroller>
            {groups.map(([host, hostFiles]) => (
              <div key={host}>
                <GroupRow>
                  <Icon name="Folder" size={12} />
                  {host}
                </GroupRow>
                {hostFiles.map((file) => (
                  <NavRow
                    key={file.id}
                    type="button"
                    $depth={1}
                    $selected={file.id === selected?.id}
                    title={file.url}
                    onClick={() => setSelectedId(file.id)}
                  >
                    <Icon name={iconFor[file.kind]} size={12} />
                    <span>{file.name}</span>
                  </NavRow>
                ))}
              </div>
            ))}
          </Scroller>
        </SplitSidebar>

        <SplitMain>
          <Scroller>
            {!selected ? (
              <EmptyState>No sources found on this page.</EmptyState>
            ) : selected.content === null ? (
              <EmptyState>
                {selected.name} is an external resource. Its contents are not
                fetched, so only the URL is listed.
              </EmptyState>
            ) : (
              <Editor>
                <Gutter aria-hidden="true">
                  {lines.map((_, index) => `${index + 1}`).join("\n")}
                </Gutter>
                <Code>{lines.join("\n")}</Code>
              </Editor>
            )}
          </Scroller>
          <StatusBar>
            {selected ? `${selected.url}` : "No source selected"}
          </StatusBar>
        </SplitMain>
      </SplitView>
    </Panel>
  );
}
