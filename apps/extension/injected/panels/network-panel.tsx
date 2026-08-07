import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  Button,
  Icon,
  IconButton,
  Input,
  alpha,
} from "cherry-styled-components";
import {
  DataGrid,
  DevtoolsButtonGroup,
  DevtoolsField,
  EmptyState,
  GridRow,
  PaneHeader,
  Panel,
  PanelToolbar,
  Scroller,
  SplitMain,
  SplitSidebar,
  SplitView,
  StatusBar,
  SubTab,
  SubTabBar,
  ToolbarControls,
  ToolbarDivider,
  devtoolsMono,
} from "~injected/devtools.styled";
import type { CapturedNetworkRequest, WebRequestEntry } from "~lib/messages";

type RequestKind =
  "document" | "stylesheet" | "script" | "img" | "font" | "fetch" | "other";

/** One table row, merged from whichever capture tiers saw the request. */
type NetworkRow = {
  id: string;
  name: string;
  url: string;
  method: string;
  status: string;
  failed: boolean;
  pending: boolean;
  type: RequestKind;
  transferSize: number;
  sizeLabel: string;
  duration: number;
  startTime: number;
  /** Time to first byte, for the waterfall's lighter waiting stretch; 0 when
   *  unknown (fetch/XHR captures, cross-origin timing without TAO). */
  ttfb: number;
  cached: boolean;
  /** Full fetch/XHR capture (headers + bodies), when the wrapper saw it. */
  detail: CapturedNetworkRequest | null;
  /** Headers-only webRequest record, when the background saw it. */
  headers: WebRequestEntry | null;
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
    width: 30%;
  }
  th:nth-child(2) {
    width: 9%;
  }
  th:nth-child(3) {
    width: 10%;
  }
  th:nth-child(4) {
    width: 12%;
  }
  th:nth-child(5) {
    width: 9%;
  }
  th:nth-child(6) {
    width: 30%;
  }
`;

const NameCell = styled.td`
  color: ${({ theme }) => theme.devtools.text};
`;

const StatusCell = styled.td<{ $failed: boolean; $success: boolean }>`
  color: ${({ theme, $failed, $success }) =>
    $failed
      ? theme.devtools.status.error
      : $success
        ? theme.devtools.status.success
        : theme.devtools.text};
`;

const MutedCell = styled.td`
  color: ${({ theme }) => theme.devtools.textSubtle};
`;

const WaterfallCell = styled.td`
  vertical-align: middle;
`;

/** The row's slice of the shared request timeline; bars position inside it. */
const WaterfallTrack = styled.div`
  position: relative;
  height: 7px;
`;

/* Bar offsets and widths are per-request percentages of the shared
   timeline, so they are set inline rather than minting a styled class per
   unique geometry. */

const WaterfallBar = styled.div<{ $failed: boolean; $pending: boolean }>`
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: ${({ theme, $failed }) =>
    $failed ? theme.devtools.status.error : theme.devtools.accent};
  opacity: ${({ $pending }) => ($pending ? 0.45 : 1)};
`;

/** The waiting (TTFB) stretch, lighter than the download stretch. */
const WaterfallWait = styled.div<{ $failed: boolean }>`
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: ${({ theme, $failed }) =>
    alpha($failed ? theme.devtools.status.error : theme.devtools.accent, 35)};
`;

/* ------------------------------------------------------------ detail pane */

const DetailSidebar = styled(SplitSidebar)`
  width: 300px;
`;

const DetailPaneHeader = styled(PaneHeader)`
  justify-content: space-between;
  border-bottom: none;
`;

const DetailSection = styled.div`
  padding: 4px 6px;
  border-bottom: solid 1px ${({ theme }) => theme.devtools.border};
`;

const DetailSectionTitle = styled.div`
  margin-bottom: 2px;
  color: ${({ theme }) => theme.devtools.text};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  font-weight: 500;
`;

const DetailRow = styled.div`
  ${devtoolsMono};
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding-left: 8px;
`;

const DetailName = styled.span`
  flex: 0 0 auto;
  color: ${({ theme }) => theme.devtools.textSubtle};
`;

const DetailValue = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  color: ${({ theme }) => theme.devtools.text};
`;

/**
 * The General section's status line, colored like DevTools: green for 2xx,
 * amber for 3xx, red for failures, plain for everything else. The dot and
 * the text share the tone via currentColor.
 */
const StatusValue = styled(DetailValue)<{
  $tone: "success" | "warning" | "error" | "neutral";
}>`
  display: flex;
  align-items: center;
  gap: 5px;
  color: ${({ theme, $tone }) =>
    $tone === "error"
      ? theme.devtools.status.error
      : $tone === "warning"
        ? theme.devtools.status.warning
        : $tone === "success"
          ? theme.devtools.status.success
          : theme.devtools.text};
`;

const StatusDot = styled.span`
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  background: currentColor;
  border-radius: 50%;
`;

const DetailNote = styled.div`
  padding: 8px;
  color: ${({ theme }) => theme.devtools.textSubtle};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  font-style: italic;
`;

const BodyPre = styled.pre`
  ${devtoolsMono};
  margin: 0;
  padding: 6px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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

/** Tone for the General section's status marker, mirroring the grid's
 *  `StatusCell` coloring and adding amber for redirects. */
function statusTone(
  row: NetworkRow,
): "success" | "warning" | "error" | "neutral" {
  if (row.failed) return "error";
  if (row.pending) return "neutral";
  if (row.status.startsWith("2")) return "success";
  if (row.status.startsWith("3")) return "warning";
  return "neutral";
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

type PerfRequest = {
  id: string;
  name: string;
  url: string;
  status: string;
  type: RequestKind;
  transferSize: number;
  sizeLabel: string;
  duration: number;
  startTime: number;
  ttfb: number;
  cached: boolean;
};

/**
 * Reads what the browser already recorded through the Performance timeline.
 * These are real requests for the page, not fabricated rows — but they are a
 * snapshot rather than a live capture, so the toolbar offers a refresh.
 *
 * `clearedBefore` implements DevTools' clear button without touching
 * performance.clearResourceTimings(), which would wipe the page's own timing
 * buffer: entries recorded up to that timestamp are simply no longer listed.
 */
function collectRequests(clearedBefore: number): PerfRequest[] {
  const timings = [
    ...performance.getEntriesByType("navigation"),
    ...performance.getEntriesByType("resource"),
  ] as PerformanceResourceTiming[];

  return timings
    .filter((entry) => entry.startTime > clearedBefore)
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
        // responseStart is 0 for cross-origin resources without a
        // Timing-Allow-Origin header; 0 means "no waiting stretch known".
        ttfb:
          entry.responseStart > 0
            ? Math.max(entry.responseStart - entry.startTime, 0)
            : 0,
        cached,
      } satisfies PerfRequest;
    })
    .sort((a, b) => a.startTime - b.startTime);
}

/** Nearest webRequest record for a URL, within a tolerance window. */
function matchWebEntry(
  entries: WebRequestEntry[],
  url: string,
  startTime: number,
): WebRequestEntry | null {
  const targetEpoch = performance.timeOrigin + startTime;
  let best: WebRequestEntry | null = null;
  let bestDelta = 3000;
  for (const entry of entries) {
    if (entry.url !== url) continue;
    const delta = Math.abs(entry.startEpoch - targetEpoch);
    if (delta < bestDelta) {
      best = entry;
      bestDelta = delta;
    }
  }
  return best;
}

/** Pretty-prints JSON bodies the way DevTools' Preview tab does. */
function formatBody(body: string, contentType: string): string {
  if (!contentType.includes("json")) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export type NetworkPanelProps = {
  /** Live fetch/XHR captures from the page-world interceptor. */
  captured: CapturedNetworkRequest[];
  onClearCaptured: () => void;
  /** Pulls the background's headers-only webRequest log for this tab. */
  loadHeaderDetails: () => Promise<WebRequestEntry[]>;
};

export function NetworkPanel({
  captured,
  onClearCaptured,
  loadHeaderDetails,
}: NetworkPanelProps) {
  const [generation, setGeneration] = useState(0);
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState<RequestKind | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clearedBefore, setClearedBefore] = useState(0);
  const [webEntries, setWebEntries] = useState<WebRequestEntry[]>([]);
  const [detailTab, setDetailTab] = useState<"headers" | "response">("headers");

  const refresh = useCallback(() => setGeneration((n) => n + 1), []);

  /** DevTools' ⊘: empties the list; later requests still appear. */
  const clear = useCallback(() => {
    setClearedBefore(performance.now());
    setSelectedId(null);
    onClearCaptured();
  }, [onClearCaptured]);

  /* Header details come from the background; re-pull on every refresh. */
  useEffect(() => {
    let cancelled = false;
    void loadHeaderDetails().then((entries) => {
      if (!cancelled) setWebEntries(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [loadHeaderDetails, generation]);

  const rows = useMemo((): NetworkRow[] => {
    const capturedRows: NetworkRow[] = captured
      .filter((entry) => entry.startTime > clearedBefore)
      .map((entry) => ({
        id: `cap-${entry.id}`,
        name: nameFrom(entry.url),
        url: entry.url,
        method: entry.method,
        status: entry.error
          ? "failed"
          : entry.pending
            ? "…"
            : String(entry.status),
        failed: Boolean(entry.error) || (!entry.pending && entry.status >= 400),
        pending: entry.pending,
        type: "fetch",
        transferSize: entry.responseBody?.length ?? 0,
        sizeLabel: entry.responseBody
          ? `${formatBytes(entry.responseBody.length)}${entry.responseBodyTruncated ? "+" : ""}`
          : "—",
        duration: entry.duration,
        startTime: entry.startTime,
        ttfb: 0,
        cached: false,
        detail: entry,
        headers: matchWebEntry(webEntries, entry.url, entry.startTime),
      }));

    // The Performance timeline also records fetch/XHR; keep its rows only
    // when the live wrapper did not see the request (e.g. pre-launch).
    const perfRows: NetworkRow[] = collectRequests(clearedBefore)
      .filter(
        (entry) =>
          entry.type !== "fetch" ||
          !capturedRows.some(
            (row) =>
              row.url === entry.url &&
              Math.abs(row.startTime - entry.startTime) < 2500,
          ),
      )
      .map((entry) => {
        const web = matchWebEntry(webEntries, entry.url, entry.startTime);
        return {
          id: entry.id,
          name: entry.name,
          url: entry.url,
          method: web?.method ?? "GET",
          status: web?.error
            ? "failed"
            : web?.status
              ? String(web.status)
              : entry.status,
          failed: Boolean(web?.error) || (!web && entry.status === "—"),
          pending: false,
          type: entry.type,
          transferSize: entry.transferSize,
          sizeLabel: entry.sizeLabel,
          duration: entry.duration,
          startTime: entry.startTime,
          ttfb: entry.ttfb,
          cached: entry.cached || (web?.fromCache ?? false),
          detail: null,
          headers: web,
        };
      });

    return [...capturedRows, ...perfRows].sort(
      (a, b) => a.startTime - b.startTime,
    );
    // generation re-reads the Performance timeline on refresh clicks.
  }, [captured, webEntries, clearedBefore, generation]);

  const visible = rows.filter((request) => {
    if (kind !== "all" && request.type !== kind) return false;
    if (
      filter.trim() &&
      !request.url.toLowerCase().includes(filter.trim().toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const selectedRow = visible.find((row) => row.id === selectedId) ?? null;

  const selectRow = (id: string) => {
    setSelectedId((current) => (current === id ? null : id));
    setDetailTab("headers");
  };

  const transferred = visible.reduce(
    (total, request) => total + request.transferSize,
    0,
  );
  const finish = visible.reduce(
    (latest, request) => Math.max(latest, request.startTime + request.duration),
    0,
  );

  /* One shared axis for the Waterfall column: every bar is positioned as a
     percentage of the span from the first request's start to `finish`. */
  const timelineStart = visible.reduce(
    (earliest, request) => Math.min(earliest, request.startTime),
    Number.POSITIVE_INFINITY,
  );
  const timelineSpan = Math.max(finish - timelineStart, 1);

  /** Bar geometry for one row, as percentages of the shared timeline. */
  const waterfallMetrics = (request: NetworkRow) => {
    // A pending request has no duration yet; stretch it to the current end.
    const total = request.pending
      ? Math.max(finish - request.startTime, 0)
      : request.duration;
    const wait = request.pending ? 0 : Math.min(request.ttfb, total);
    const left = ((request.startTime - timelineStart) / timelineSpan) * 100;
    const waitWidth = (wait / timelineSpan) * 100;
    const barLeft = left + waitWidth;
    // Floor keeps sub-millisecond requests visible as a sliver.
    const barWidth = Math.min(
      Math.max(((total - wait) / timelineSpan) * 100, 0.4),
      100 - barLeft,
    );
    return { left, waitWidth, barLeft, barWidth };
  };

  const waterfallTitle = (request: NetworkRow): string => {
    if (request.pending) return "Pending";
    const offset = Math.round(request.startTime - timelineStart);
    const waiting =
      request.ttfb > 0 ? `, ${Math.round(request.ttfb)} ms waiting` : "";
    return `Started at ${offset} ms, ${Math.round(request.duration)} ms total${waiting}`;
  };

  const detailHeaders = (
    title: string,
    pairs: [string, string][],
  ): React.ReactNode => (
    <DetailSection>
      <DetailSectionTitle>{title}</DetailSectionTitle>
      {pairs.length === 0 ? (
        <DetailNote>Not captured for this request.</DetailNote>
      ) : (
        pairs.map(([name, value], index) => (
          <DetailRow key={`${name}-${index}`}>
            <DetailName>{name}:</DetailName>
            <DetailValue>{value}</DetailValue>
          </DetailRow>
        ))
      )}
    </DetailSection>
  );

  return (
    <Panel>
      <PanelToolbar>
        <ToolbarControls>
          <IconButton aria-label="Refresh request list" onClick={refresh}>
            <Icon name="RefreshCw" size={14} />
          </IconButton>
          <IconButton aria-label="Clear request list" onClick={clear}>
            <Icon name="Ban" size={14} />
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

      <SplitView>
        <SplitMain>
          <Scroller>
            {visible.length === 0 ? (
              <EmptyState>
                {clearedBefore > 0
                  ? "Request list cleared. New requests appear as the page makes them."
                  : "No requests recorded. Reload the page with the inspector open, then refresh this list."}
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
                    <th scope="col">Waterfall</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((request) => {
                    const bar = waterfallMetrics(request);
                    return (
                      <GridRow
                        key={request.id}
                        $selected={request.id === selectedId}
                        onClick={() => selectRow(request.id)}
                      >
                        <NameCell title={request.url}>{request.name}</NameCell>
                        <StatusCell
                          $failed={request.failed}
                          $success={request.status.startsWith("2")}
                        >
                          {request.status}
                        </StatusCell>
                        <MutedCell>{request.type}</MutedCell>
                        <MutedCell>{request.sizeLabel}</MutedCell>
                        <MutedCell>
                          {request.pending
                            ? "…"
                            : `${Math.round(request.duration)} ms`}
                        </MutedCell>
                        <WaterfallCell title={waterfallTitle(request)}>
                          <WaterfallTrack aria-hidden="true">
                            {bar.waitWidth > 0 && (
                              <WaterfallWait
                                $failed={request.failed}
                                style={{
                                  left: `${bar.left}%`,
                                  width: `${bar.waitWidth}%`,
                                }}
                              />
                            )}
                            <WaterfallBar
                              $failed={request.failed}
                              $pending={request.pending}
                              style={{
                                left: `${bar.barLeft}%`,
                                width: `${bar.barWidth}%`,
                              }}
                            />
                          </WaterfallTrack>
                        </WaterfallCell>
                      </GridRow>
                    );
                  })}
                </tbody>
              </RequestGrid>
            )}
          </Scroller>
          <StatusBar>
            <span>{visible.length} requests</span>
            <span>{formatBytes(transferred)} transferred</span>
            <span>Finish: {Math.round(finish)} ms</span>
          </StatusBar>
        </SplitMain>

        {selectedRow && (
          <DetailSidebar>
            <DetailPaneHeader>
              <span title={selectedRow.url}>{selectedRow.name}</span>
              <ToolbarControls>
                <IconButton
                  aria-label="Close request details"
                  onClick={() => setSelectedId(null)}
                >
                  <Icon name="X" size={12} />
                </IconButton>
              </ToolbarControls>
            </DetailPaneHeader>
            <SubTabBar role="tablist" aria-label="Request details">
              <SubTab
                type="button"
                role="tab"
                aria-selected={detailTab === "headers"}
                $selected={detailTab === "headers"}
                onClick={() => setDetailTab("headers")}
              >
                Headers
              </SubTab>
              <SubTab
                type="button"
                role="tab"
                aria-selected={detailTab === "response"}
                $selected={detailTab === "response"}
                onClick={() => setDetailTab("response")}
              >
                Response
              </SubTab>
            </SubTabBar>
            <Scroller>
              {detailTab === "headers" ? (
                <>
                  <DetailSection>
                    <DetailSectionTitle>General</DetailSectionTitle>
                    <DetailRow>
                      <DetailName>URL:</DetailName>
                      <DetailValue>{selectedRow.url}</DetailValue>
                    </DetailRow>
                    <DetailRow>
                      <DetailName>Method:</DetailName>
                      <DetailValue>{selectedRow.method}</DetailValue>
                    </DetailRow>
                    <DetailRow>
                      <DetailName>Status:</DetailName>
                      <StatusValue $tone={statusTone(selectedRow)}>
                        {statusTone(selectedRow) !== "neutral" && (
                          <StatusDot aria-hidden="true" />
                        )}
                        {selectedRow.detail?.error ??
                          selectedRow.headers?.error ??
                          `${selectedRow.status}${
                            selectedRow.detail?.statusText
                              ? ` ${selectedRow.detail.statusText}`
                              : ""
                          }`}
                      </StatusValue>
                    </DetailRow>
                    <DetailRow>
                      <DetailName>Duration:</DetailName>
                      <DetailValue>
                        {selectedRow.pending
                          ? "pending"
                          : `${Math.round(selectedRow.duration)} ms`}
                      </DetailValue>
                    </DetailRow>
                    {selectedRow.detail?.contentType && (
                      <DetailRow>
                        <DetailName>Content-Type:</DetailName>
                        <DetailValue>
                          {selectedRow.detail.contentType}
                        </DetailValue>
                      </DetailRow>
                    )}
                    {selectedRow.cached && (
                      <DetailRow>
                        <DetailName>Cache:</DetailName>
                        <DetailValue>served from cache</DetailValue>
                      </DetailRow>
                    )}
                  </DetailSection>
                  {detailHeaders(
                    "Request Headers",
                    selectedRow.detail?.requestHeaders.length
                      ? selectedRow.detail.requestHeaders
                      : (selectedRow.headers?.requestHeaders ?? []),
                  )}
                  {detailHeaders(
                    "Response Headers",
                    selectedRow.detail?.responseHeaders.length
                      ? selectedRow.detail.responseHeaders
                      : (selectedRow.headers?.responseHeaders ?? []),
                  )}
                  {selectedRow.detail?.requestBody && (
                    <DetailSection>
                      <DetailSectionTitle>
                        Request Body
                        {selectedRow.detail.requestBodyTruncated
                          ? " (truncated)"
                          : ""}
                      </DetailSectionTitle>
                      <BodyPre>{selectedRow.detail.requestBody}</BodyPre>
                    </DetailSection>
                  )}
                </>
              ) : selectedRow.detail ? (
                selectedRow.detail.responseBody === null ? (
                  <DetailNote>
                    {selectedRow.detail.pending
                      ? "Waiting for the response…"
                      : "The response body could not be captured."}
                  </DetailNote>
                ) : (
                  <>
                    {selectedRow.detail.responseBodyTruncated && (
                      <DetailNote>
                        Body truncated to the capture limit.
                      </DetailNote>
                    )}
                    <BodyPre>
                      {formatBody(
                        selectedRow.detail.responseBody,
                        selectedRow.detail.contentType,
                      )}
                    </BodyPre>
                  </>
                )
              ) : (
                <DetailNote>
                  Response bodies are captured for fetch/XHR requests only —
                  this row was observed at the browser layer, which exposes
                  headers but not contents.
                </DetailNote>
              )}
            </Scroller>
          </DetailSidebar>
        )}
      </SplitView>
    </Panel>
  );
}
