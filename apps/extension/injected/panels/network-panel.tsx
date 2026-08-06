import { useCallback, useMemo, useState } from "react";
import styled from "styled-components";
import { Button, Icon, IconButton, Input } from "cherry-styled-components";
import {
  DataGrid,
  DevtoolsButtonGroup,
  DevtoolsField,
  EmptyState,
  GridRow,
  Panel,
  PanelToolbar,
  Scroller,
  StatusBar,
  ToolbarControls,
  ToolbarDivider,
} from "~injected/devtools.styled";

type RequestKind =
  "document" | "stylesheet" | "script" | "img" | "font" | "fetch" | "other";

type NetworkRequest = {
  id: string;
  name: string;
  url: string;
  status: string;
  type: RequestKind;
  transferSize: number;
  sizeLabel: string;
  duration: number;
  startTime: number;
  cached: boolean;
};

const FILTERS: { id: RequestKind | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "fetch", label: "Fetch/XHR" },
  { id: "document", label: "Doc" },
  { id: "stylesheet", label: "CSS" },
  { id: "script", label: "JS" },
  { id: "font", label: "Font" },
  { id: "img", label: "Img" },
  { id: "other", label: "Other" },
];

/** Column widths live here rather than in a `<col>` so nothing is inlined. */
const RequestGrid = styled(DataGrid)`
  th:nth-child(1) {
    width: 44%;
  }
  th:nth-child(2) {
    width: 12%;
  }
  th:nth-child(3) {
    width: 14%;
  }
  th:nth-child(4) {
    width: 15%;
  }
  th:nth-child(5) {
    width: 15%;
  }
`;

const NameCell = styled.td`
  color: ${({ theme }) => theme.devtools.text};
`;

const StatusCell = styled.td<{ $failed: boolean }>`
  color: ${({ theme, $failed }) =>
    $failed ? theme.devtools.status.error : theme.devtools.text};
`;

const MutedCell = styled.td`
  color: ${({ theme }) => theme.devtools.textSubtle};
`;

function classify(initiatorType: string, url: string): RequestKind {
  if (initiatorType === "navigation" || initiatorType === "iframe") {
    return "document";
  }
  if (initiatorType === "css" || initiatorType === "link") {
    return /\.css(\?|$)/.test(url) ? "stylesheet" : "other";
  }
  if (initiatorType === "script") return "script";
  if (initiatorType === "img" || initiatorType === "image") return "img";
  if (initiatorType === "xmlhttprequest" || initiatorType === "fetch") {
    return "fetch";
  }
  if (/\.(woff2?|ttf|otf|eot)(\?|$)/.test(url)) return "font";
  if (/\.css(\?|$)/.test(url)) return "stylesheet";
  if (/\.js(\?|$)/.test(url)) return "script";
  return "other";
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function nameFrom(url: string): string {
  try {
    const parsed = new URL(url, location.href);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last ?? parsed.host;
  } catch {
    return url;
  }
}

/**
 * Reads what the browser already recorded through the Performance timeline.
 * These are real requests for the page, not fabricated rows — but they are a
 * snapshot rather than a live capture, so the toolbar offers a refresh.
 */
function collectRequests(): NetworkRequest[] {
  const timings = [
    ...performance.getEntriesByType("navigation"),
    ...performance.getEntriesByType("resource"),
  ] as PerformanceResourceTiming[];

  return timings
    .map((entry, index) => {
      // responseStatus is recent; treat it as optional rather than assume it.
      const status = (
        entry as PerformanceResourceTiming & { responseStatus?: number }
      ).responseStatus;
      const cached = entry.transferSize === 0 && entry.decodedBodySize > 0;

      return {
        id: `${index}-${entry.name}`,
        name: nameFrom(entry.name),
        url: entry.name,
        status: status ? String(status) : cached ? "200" : "—",
        type: classify(entry.initiatorType, entry.name),
        transferSize: entry.transferSize,
        sizeLabel: cached
          ? "(memory cache)"
          : formatBytes(entry.transferSize || entry.encodedBodySize),
        duration: entry.duration,
        startTime: entry.startTime,
        cached,
      } satisfies NetworkRequest;
    })
    .sort((a, b) => a.startTime - b.startTime);
}

export function NetworkPanel() {
  const [generation, setGeneration] = useState(0);
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<RequestKind | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const requests = useMemo(
    () => collectRequests(),
    // Re-read the timeline when the user asks for a refresh.
    [generation],
  );

  const refresh = useCallback(() => setGeneration((n) => n + 1), []);

  const visible = requests.filter((request) => {
    if (kind !== "all" && request.type !== kind) return false;
    if (
      filter.trim() &&
      !request.url.toLowerCase().includes(filter.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const transferred = visible.reduce(
    (total, request) => total + request.transferSize,
    0,
  );
  const finish = visible.reduce(
    (latest, request) => Math.max(latest, request.startTime + request.duration),
    0,
  );

  return (
    <Panel>
      <PanelToolbar>
        <ToolbarControls>
          <IconButton aria-label="Refresh request list" onClick={refresh}>
            <Icon name="RefreshCw" size={14} />
          </IconButton>
        </ToolbarControls>
        <ToolbarDivider />
        <DevtoolsField $grow>
          <Input
            id="inspector-network-filter"
            $size="small"
            $fullWidth
            placeholder="Filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </DevtoolsField>
        <ToolbarDivider />
        <DevtoolsButtonGroup>
          {FILTERS.map((entry) => (
            <Button
              key={entry.id}
              type="button"
              $size="small"
              $outline
              aria-pressed={kind === entry.id}
              onClick={() => setKind(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </DevtoolsButtonGroup>
      </PanelToolbar>

      <Scroller>
        {visible.length === 0 ? (
          <EmptyState>
            No requests recorded. Reload the page with the inspector open, then
            refresh this list.
          </EmptyState>
        ) : (
          <RequestGrid>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Status</th>
                <th scope="col">Type</th>
                <th scope="col">Size</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((request) => (
                <GridRow
                  key={request.id}
                  $selected={request.id === selectedId}
                  onClick={() => setSelectedId(request.id)}
                >
                  <NameCell title={request.url}>{request.name}</NameCell>
                  <StatusCell $failed={request.status === "—"}>
                    {request.status}
                  </StatusCell>
                  <MutedCell>{request.type}</MutedCell>
                  <MutedCell>{request.sizeLabel}</MutedCell>
                  <MutedCell>{Math.round(request.duration)} ms</MutedCell>
                </GridRow>
              ))}
            </tbody>
          </RequestGrid>
        )}
      </Scroller>

      <StatusBar>
        <span>{visible.length} requests</span>
        <span>{formatBytes(transferred)} transferred</span>
        <span>Finish: {Math.round(finish)} ms</span>
      </StatusBar>
    </Panel>
  );
}
