import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { Icon, resetButton } from "cherry-styled-components";
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
import { HOST_ID, STATE_STYLE_ID, truncate } from "~injected/inspector-dom";
import { describeSendFailure, sendRuntimeMessage } from "~lib/runtime-message";
import {
  tokenizeLines,
  type SourceLanguage,
  type SyntaxTone,
} from "~injected/syntax";
import {
  FETCH_SOURCE_MESSAGE,
  type FetchSourceRequest,
  type FetchSourceResponse,
} from "~lib/messages";
import { readBodyCapped } from "~lib/source-fetch";

/** Guards the editor pane against pathological inline scripts. */
const MAX_SOURCE_LENGTH = 60000;
const MAX_LINES = 2000;

/** Lazily fetched text of an external file, keyed by file id. */
type FetchedSource =
  | { state: "loading" }
  | { state: "ready"; content: string; truncated: boolean }
  | { state: "error"; error: string };

/**
 * Fetches an external resource's text, only ever called when the user opens
 * the file. Page-context fetch first — same-origin and CORS-friendly hosts,
 * usually straight from the HTTP cache — then the background as fallback,
 * which can use the extension's host grants where CORS says no.
 */
async function loadExternalSource(url: string): Promise<FetchedSource> {
  try {
    const response = await fetch(url, {
      cache: "force-cache",
      credentials: "omit",
    });
    if (response.ok) {
      const { text, truncated } = await readBodyCapped(
        response,
        MAX_SOURCE_LENGTH,
      );
      return { state: "ready", content: text, truncated };
    }
    return {
      state: "error",
      error: `The server responded with ${response.status}.`,
    };
  } catch {
    /* CORS or network refusal — the background may still have a host grant. */
  }

  try {
    const request: FetchSourceRequest = { type: FETCH_SOURCE_MESSAGE, url };
    const response = await sendRuntimeMessage<FetchSourceResponse>(request);
    if (response.ok && typeof response.content === "string") {
      return {
        state: "ready",
        content: response.content,
        truncated: response.truncated === true,
      };
    }
    return {
      state: "error",
      error: response.error ?? "The file could not be fetched.",
    };
  } catch (error) {
    return { state: "error", error: describeSendFailure(error) };
  }
}

type SourceKind = "document" | "stylesheet" | "script";

type SourceFile = {
  id: string;
  name: string;
  url: string;
  kind: SourceKind;
  /** Inline content, or null when the bytes live behind a network request. */
  content: string | null;
};

/** Asks the navigator to select and scroll to a rule's stylesheet — sent by
 *  the Styles pane's source links. `seq` distinguishes repeat clicks. */
export type SourceRevealRequest = {
  href: string | null;
  inlineIndex: number | null;
  seq: number;
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

/** A collapsible host or folder row in the file navigator. */
const GroupRow = styled.button<{ $depth: number }>`
  ${resetButton};
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
  color: ${({ theme }) => theme.devtools.textSubtle};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  text-align: left;
  white-space: nowrap;
  cursor: default;

  &:hover {
    background: ${({ theme }) => theme.devtools.rowHover};
  }

  &:focus-visible {
    outline: solid 1px ${({ theme }) => theme.devtools.focusRing};
    outline-offset: -1px;
  }

  svg {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
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

/** One syntax token, colored straight from the theme's syntax palette. */
const Tok = styled.span<{ $tone: SyntaxTone }>`
  color: ${({ theme, $tone }) => theme.devtools.syntax[$tone]};
`;

/** The editor colors by what the file is, not by sniffing its content. */
const languageFor: Record<SourceKind, SourceLanguage> = {
  document: "html",
  stylesheet: "css",
  script: "js",
};

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
 * bodies are shown verbatim; external resources start as URL-only entries and
 * are fetched lazily when (and only when) the user opens them.
 *
 * Inline `<style>` ids are position-based (`style-N`) and must stay aligned
 * with matchedCssRules' inlineIndex, which counts the same DOM order — both
 * skip the inspector's own state-styles tag.
 */
function collectSources(): SourceFile[] {
  const files: SourceFile[] = [];

  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelector(`#${HOST_ID}`)?.remove();
  clone.querySelector(`#${STATE_STYLE_ID}`)?.remove();

  files.push({
    id: "document",
    name: fileNameFrom(location.href, "(index)"),
    url: location.href,
    kind: "document",
    content: truncate(clone.outerHTML, MAX_SOURCE_LENGTH),
  });

  let styleIndex = -1;
  document.querySelectorAll("style").forEach((style) => {
    if (style.id === STATE_STYLE_ID) return;
    styleIndex += 1;
    files.push({
      id: `style-${styleIndex}`,
      name: `(inline stylesheet ${styleIndex + 1})`,
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

/* ------------------------------------------------------------- file tree */

type FolderNode = {
  name: string;
  /** Slash-joined path from the host root; "" for the host itself. */
  path: string;
  subfolders: Map<string, FolderNode>;
  files: SourceFile[];
};

/**
 * Folder chain for a file. External resources nest under their URL path
 * folders; the document and inline entries sit at the host root, the way
 * DevTools keeps inline sources under the page node.
 */
function folderSegments(file: SourceFile): string[] {
  if (file.content !== null) return [];
  try {
    const segments = new URL(file.url, location.href).pathname
      .split("/")
      .filter(Boolean);
    segments.pop(); // the file name itself
    return segments;
  } catch {
    return [];
  }
}

function buildTree(files: SourceFile[]): Array<[string, FolderNode]> {
  const hosts = new Map<string, FolderNode>();

  for (const file of files) {
    const host = hostFrom(file.url);
    let node = hosts.get(host);
    if (!node) {
      node = { name: host, path: "", subfolders: new Map(), files: [] };
      hosts.set(host, node);
    }

    for (const segment of folderSegments(file)) {
      let child = node.subfolders.get(segment);
      if (!child) {
        child = {
          name: segment,
          path: node.path ? `${node.path}/${segment}` : segment,
          subfolders: new Map(),
          files: [],
        };
        node.subfolders.set(segment, child);
      }
      node = child;
    }
    node.files.push(file);
  }

  return Array.from(hosts.entries());
}

export type SourcesPanelProps = {
  /** Set by the Styles pane's source links; null when nothing to reveal. */
  reveal?: SourceRevealRequest | null;
};

export function SourcesPanel({ reveal }: SourcesPanelProps) {
  const files = useMemo(collectSources, []);
  const [selectedId, setSelectedId] = useState<string>("document");
  /** Collapsed host/folder keys (`host|path`); everything starts expanded. */
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const selectedNavRef = useRef<HTMLButtonElement | null>(null);
  const lastRevealSeq = useRef(0);
  const [fetchedById, setFetchedById] = useState<Map<string, FetchedSource>>(
    () => new Map(),
  );

  const selected = files.find((file) => file.id === selectedId) ?? files[0];

  const tree = useMemo(() => buildTree(files), [files]);

  /* Opening an external file fetches its text — once, on demand. */
  useEffect(() => {
    const target = selected;
    if (!target || target.content !== null || fetchedById.has(target.id)) {
      return;
    }
    setFetchedById((current) =>
      new Map(current).set(target.id, { state: "loading" }),
    );
    void loadExternalSource(target.url).then((result) => {
      setFetchedById((current) => new Map(current).set(target.id, result));
    });
  }, [selected, fetchedById]);

  /* A reveal request selects the file and re-expands its folder chain. */
  useEffect(() => {
    if (!reveal || reveal.seq === lastRevealSeq.current) return;
    lastRevealSeq.current = reveal.seq;

    const target =
      reveal.inlineIndex !== null
        ? files.find((file) => file.id === `style-${reveal.inlineIndex}`)
        : reveal.href !== null
          ? files.find(
              (file) => file.kind === "stylesheet" && file.url === reveal.href,
            )
          : undefined;
    if (!target) return;

    setSelectedId(target.id);
    setCollapsedKeys((current) => {
      const host = hostFrom(target.url);
      const next = new Set(current);
      next.delete(`${host}|`);
      let path = "";
      for (const segment of folderSegments(target)) {
        path = path ? `${path}/${segment}` : segment;
        next.delete(`${host}|${path}`);
      }
      return next;
    });
  }, [reveal, files]);

  /* Runs after expansion re-renders too, so a revealed row always exists. */
  useEffect(() => {
    selectedNavRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId, collapsedKeys]);

  const toggleFolder = (key: string) => {
    setCollapsedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderFolder = (
    host: string,
    node: FolderNode,
    depth: number,
  ): React.ReactNode => {
    const key = `${host}|${node.path}`;
    const isCollapsed = collapsedKeys.has(key);

    return (
      <div key={key}>
        <GroupRow
          type="button"
          $depth={depth}
          aria-expanded={!isCollapsed}
          onClick={() => toggleFolder(key)}
        >
          <Icon name={isCollapsed ? "ChevronRight" : "ChevronDown"} size={12} />
          <Icon name="Folder" size={12} />
          <span>{node.name}</span>
        </GroupRow>
        {!isCollapsed && (
          <>
            {Array.from(node.subfolders.values())
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((child) => renderFolder(host, child, depth + 1))}
            {node.files.map((file) => (
              <NavRow
                key={file.id}
                ref={file.id === selected?.id ? selectedNavRef : undefined}
                type="button"
                $depth={depth + 1}
                $selected={file.id === selected?.id}
                title={file.url}
                onClick={() => setSelectedId(file.id)}
              >
                <Icon name={iconFor[file.kind]} size={12} />
                <span>{file.name}</span>
              </NavRow>
            ))}
          </>
        )}
      </div>
    );
  };

  const fetched =
    selected && selected.content === null
      ? fetchedById.get(selected.id)
      : undefined;
  const displayContent =
    selected?.content ?? (fetched?.state === "ready" ? fetched.content : null);

  const lines = useMemo(() => {
    if (!displayContent) return [];
    return displayContent.split("\n").slice(0, MAX_LINES);
  }, [displayContent]);

  const tokenLines = useMemo(
    () => (selected ? tokenizeLines(lines, languageFor[selected.kind]) : []),
    [lines, selected],
  );

  return (
    <Panel>
      <SplitView>
        <SplitSidebar $side="left">
          <PaneHeader>Page</PaneHeader>
          <Scroller>
            {tree.map(([host, node]) => renderFolder(host, node, 0))}
          </Scroller>
        </SplitSidebar>

        <SplitMain>
          <Scroller>
            {!selected ? (
              <EmptyState>No sources found on this page.</EmptyState>
            ) : displayContent !== null ? (
              <Editor>
                <Gutter aria-hidden="true">
                  {lines.map((_, index) => `${index + 1}`).join("\n")}
                </Gutter>
                <Code>
                  {tokenLines.map((tokens, index) => (
                    <Fragment key={index}>
                      {tokens.map((token, tokenIndex) =>
                        token.tone === "text" ? (
                          token.text
                        ) : (
                          <Tok key={tokenIndex} $tone={token.tone}>
                            {token.text}
                          </Tok>
                        ),
                      )}
                      {"\n"}
                    </Fragment>
                  ))}
                </Code>
              </Editor>
            ) : fetched?.state === "error" ? (
              <EmptyState>
                {selected.name} could not be loaded: {fetched.error}
              </EmptyState>
            ) : (
              <EmptyState>Fetching {selected.name}…</EmptyState>
            )}
          </Scroller>
          <StatusBar>
            <span>{selected ? `${selected.url}` : "No source selected"}</span>
            {fetched?.state === "ready" && fetched.truncated && (
              <span>truncated</span>
            )}
          </StatusBar>
        </SplitMain>
      </SplitView>
    </Panel>
  );
}
