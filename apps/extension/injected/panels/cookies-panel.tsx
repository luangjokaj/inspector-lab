import { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { Button, Icon, IconButton, Input } from "cherry-styled-components";
import type { CookieScope } from "~lib/messages";
import {
  DataGrid,
  DevtoolsButtonGroup,
  DevtoolsField,
  EmptyState,
  GridActionCell,
  GridRow,
  Panel,
  PanelToolbar,
  Scroller,
  StatusBar,
  ToolbarControls,
  ToolbarDivider,
} from "~injected/devtools.styled";
import { EditableCell } from "~injected/panels/editable-cell";
import type {
  ClearSiteCookiesResponse,
  CookieDraft,
  CookieEntry,
  DeleteCookieResponse,
  GetCookiesResponse,
  RequestCookieAccessResponse,
  SetCookieResponse,
} from "~lib/messages";

const SCOPES: { id: CookieScope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "site", label: "This site" },
];

/**
 * DevTools' cookie table needs more room than the inspector window is wide;
 * a min-width keeps the columns readable and lets the Scroller pan.
 */
const CookieGrid = styled(DataGrid)`
  min-width: 720px;

  th:nth-child(1) {
    width: 16%;
  }
  th:nth-child(2) {
    width: 24%;
  }
  th:nth-child(3) {
    width: 14%;
  }
  th:nth-child(4) {
    width: 8%;
  }
  th:nth-child(5) {
    width: 16%;
  }
  th:nth-child(6) {
    width: 6%;
  }
  th:nth-child(7),
  th:nth-child(8) {
    width: 4%;
    text-align: center;
  }
  th:nth-child(9) {
    width: 6%;
  }
  th:nth-child(10) {
    width: 24px;
  }
`;

const MutedCell = styled.td`
  color: ${({ theme }) => theme.devtools.textSubtle};
`;

/** ✓ marks for HttpOnly / Secure; double-click toggles the flag. */
const FlagCell = styled.td`
  color: ${({ theme }) => theme.devtools.textSubtle};
  text-align: center;
`;

/** Cells of the add-cookie draft row, edit-ready without a double-click. */
const DraftCell = styled.td`
  color: ${({ theme }) => theme.devtools.text};
`;

/** Shown instead of the table when the per-site grant is missing. */
const AccessPrompt = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  flex: 1 1 auto;
  gap: 8px;
  padding: 16px;
  color: ${({ theme }) => theme.devtools.textSubtle};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSize};
  text-align: center;

  p {
    max-width: 420px;
    margin: 0;
  }
`;

const ErrorNote = styled.div`
  padding: 2px 6px;
  color: ${({ theme }) => theme.devtools.status.error};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  background: ${({ theme }) => theme.devtools.status.errorBackground};
  border-bottom: solid 1px ${({ theme }) => theme.devtools.status.errorBorder};
`;

const SAME_SITE_LABELS: Record<CookieEntry["sameSite"], string> = {
  strict: "Strict",
  lax: "Lax",
  no_restriction: "None",
  unspecified: "",
};

function expiresLabel(cookie: CookieEntry): string {
  if (cookie.expirationDate === undefined) return "Session";
  return new Date(cookie.expirationDate * 1000).toISOString();
}

/** A stable identity for React keys; cookies have no id of their own. */
function cookieKey(cookie: CookieEntry): string {
  return `${cookie.domain}|${cookie.path}|${cookie.name}`;
}

/** The cookie as an editable draft — the base every cell edit patches. */
function draftFrom(cookie: CookieEntry): CookieDraft {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expirationDate: cookie.expirationDate,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
  };
}

/** "Session" (or empty) → session cookie; anything Date.parse accepts → Unix
 *  seconds; null → unparseable. */
function parseExpires(text: string): { expirationDate?: number } | null {
  const trimmed = text.trim();
  if (!trimmed || /^session$/i.test(trimmed)) return {};
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return { expirationDate: parsed / 1000 };
}

function parseSameSite(text: string): CookieEntry["sameSite"] | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return "unspecified";
  if (normalized === "strict") return "strict";
  if (normalized === "lax") return "lax";
  if (normalized === "none" || normalized === "no_restriction") {
    return "no_restriction";
  }
  return null;
}

export type CookiesPanelProps = {
  loadCookies: (scope: CookieScope) => Promise<GetCookiesResponse>;
  deleteCookie: (cookie: CookieEntry) => Promise<DeleteCookieResponse>;
  /** Creates (original: null) or rewrites a cookie via the background. */
  saveCookie: (
    original: CookieEntry | null,
    next: CookieDraft,
  ) => Promise<SetCookieResponse>;
  /** Deletes every cookie this site can see — never the whole profile. */
  clearCookies: () => Promise<ClearSiteCookiesResponse>;
  /** Prompts for the host permission the chosen cookie scope needs. */
  requestAccess: (scope: CookieScope) => Promise<RequestCookieAccessResponse>;
};

export function CookiesPanel({
  loadCookies,
  deleteCookie,
  saveCookie,
  clearCookies,
  requestAccess,
}: CookiesPanelProps) {
  const [scope, setScope] = useState<CookieScope>("all");
  const [cookies, setCookies] = useState<CookieEntry[] | null>(null);
  const [granted, setGranted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [draftRow, setDraftRow] = useState<{
    name: string;
    value: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    const response = await loadCookies(scope);
    setGranted(response.granted !== false);
    if (response.ok) {
      setError(null);
      setCookies(
        [...response.cookies].sort(
          (a, b) =>
            a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name),
        ),
      );
    } else {
      // The missing-grant state renders its own prompt, not the error bar.
      setError(
        response.granted === false
          ? null
          : (response.error ?? "Cookies could not be read."),
      );
      setCookies([]);
    }
  }, [loadCookies, scope]);

  const grantAccess = async () => {
    const response = await requestAccess(scope);
    if (response.ok) {
      await refresh();
    } else {
      setError(response.error ?? "Cookie access was not granted.");
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async (cookie: CookieEntry) => {
    const response = await deleteCookie(cookie);
    if (!response.ok) {
      setError(response.error ?? "The cookie could not be deleted.");
      return;
    }
    setError(null);
    await refresh();
  };

  const save = async (original: CookieEntry | null, next: CookieDraft) => {
    const response = await saveCookie(original, next);
    if (!response.ok) {
      setError(response.error ?? "The cookie could not be saved.");
      return false;
    }
    setError(null);
    await refresh();
    return true;
  };

  /** One edited column, everything else carried over unchanged. */
  const saveField = (cookie: CookieEntry, patch: Partial<CookieDraft>) => {
    void save(cookie, { ...draftFrom(cookie), ...patch });
  };

  const saveExpires = (cookie: CookieEntry, text: string) => {
    const parsed = parseExpires(text);
    if (parsed === null) {
      setError('Use an ISO date like 2027-01-01T00:00:00Z, or "Session".');
      return;
    }
    void save(cookie, {
      ...draftFrom(cookie),
      expirationDate: undefined,
      ...parsed,
    });
  };

  const saveSameSite = (cookie: CookieEntry, text: string) => {
    const parsed = parseSameSite(text);
    if (parsed === null) {
      setError("SameSite must be Strict, Lax, None, or empty.");
      return;
    }
    saveField(cookie, { sameSite: parsed });
  };

  const commitDraftRow = async () => {
    if (draftRow === null) return;
    if (!draftRow.name && !draftRow.value) {
      setDraftRow(null);
      return;
    }
    // Host-only for this site, path /, session — every other column can be
    // edited in place once the cookie exists.
    const created = await save(null, {
      name: draftRow.name,
      value: draftRow.value,
      domain: "",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "unspecified",
    });
    // A rejected draft stays visible for correction.
    if (created) setDraftRow(null);
  };

  const clearAll = async () => {
    const response = await clearCookies();
    if (!response.ok) {
      setError(response.error ?? "Cookies could not be cleared.");
      return;
    }
    setError(null);
    await refresh();
  };

  const visible = (cookies ?? []).filter((cookie) => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return `${cookie.name}${cookie.value}${cookie.domain}`
      .toLowerCase()
      .includes(needle);
  });

  const totalSize = visible.reduce(
    (total, cookie) => total + cookie.name.length + cookie.value.length,
    0,
  );

  const showGrid = visible.length > 0 || draftRow !== null;

  return (
    <Panel>
      <PanelToolbar>
        <ToolbarControls>
          <IconButton aria-label="Refresh cookie list" onClick={refresh}>
            <Icon name="RefreshCw" size={14} />
          </IconButton>
          <IconButton
            aria-label="Add cookie"
            disabled={!granted}
            onClick={() => setDraftRow({ name: "", value: "" })}
          >
            <Icon name="Plus" size={14} />
          </IconButton>
          <IconButton
            aria-label="Clear this site's cookies"
            disabled={!granted}
            onClick={() => void clearAll()}
          >
            <Icon name="Ban" size={14} />
          </IconButton>
        </ToolbarControls>
        <ToolbarDivider />
        <DevtoolsField $grow>
          <Input
            id="inspector-cookie-filter"
            $size="small"
            $fullWidth
            placeholder="Filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </DevtoolsField>
        <ToolbarDivider />
        <DevtoolsButtonGroup>
          {SCOPES.map((entry) => (
            <Button
              key={entry.id}
              type="button"
              $size="small"
              $outline
              aria-pressed={scope === entry.id}
              onClick={() => setScope(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </DevtoolsButtonGroup>
      </PanelToolbar>

      {error && <ErrorNote role="alert">{error}</ErrorNote>}

      <Scroller>
        {cookies === null ? (
          <EmptyState>Reading cookies…</EmptyState>
        ) : !granted ? (
          <AccessPrompt>
            <p>
              {scope === "all"
                ? "Listing cookies from every domain needs Chrome's all-sites permission. Chrome will warn that the extension can read data on all websites."
                : "Chrome needs one-time permission before the inspector can read this site's cookies. It applies to this site only and is remembered."}
            </p>
            <DevtoolsButtonGroup>
              <Button $size="small" onClick={() => void grantAccess()}>
                {scope === "all"
                  ? "Allow access to all sites"
                  : "Allow cookie access"}
              </Button>
            </DevtoolsButtonGroup>
          </AccessPrompt>
        ) : !showGrid ? (
          <EmptyState>
            {filter.trim()
              ? "No cookies match the filter."
              : "This page has no cookies."}
          </EmptyState>
        ) : (
          <CookieGrid>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Value</th>
                <th scope="col">Domain</th>
                <th scope="col">Path</th>
                <th scope="col">Expires / Max-Age</th>
                <th scope="col">Size</th>
                <th scope="col">HttpOnly</th>
                <th scope="col">Secure</th>
                <th scope="col">SameSite</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((cookie) => (
                <GridRow key={cookieKey(cookie)}>
                  <EditableCell
                    value={cookie.name}
                    label={`Edit name of cookie ${cookie.name}`}
                    onCommit={(next) => saveField(cookie, { name: next })}
                  />
                  <EditableCell
                    value={cookie.value}
                    label={`Edit value of cookie ${cookie.name}`}
                    muted
                    onCommit={(next) => saveField(cookie, { value: next })}
                  />
                  <EditableCell
                    value={cookie.domain}
                    label={`Edit domain of cookie ${cookie.name}`}
                    muted
                    onCommit={(next) => saveField(cookie, { domain: next })}
                  />
                  <EditableCell
                    value={cookie.path}
                    label={`Edit path of cookie ${cookie.name}`}
                    muted
                    onCommit={(next) => saveField(cookie, { path: next })}
                  />
                  <EditableCell
                    value={expiresLabel(cookie)}
                    label={`Edit expiry of cookie ${cookie.name}`}
                    muted
                    onCommit={(next) => saveExpires(cookie, next)}
                  />
                  <MutedCell>
                    {cookie.name.length + cookie.value.length}
                  </MutedCell>
                  <FlagCell
                    title="Double-click to toggle HttpOnly"
                    onDoubleClick={() =>
                      saveField(cookie, { httpOnly: !cookie.httpOnly })
                    }
                  >
                    {cookie.httpOnly ? "✓" : ""}
                  </FlagCell>
                  <FlagCell
                    title="Double-click to toggle Secure"
                    onDoubleClick={() =>
                      saveField(cookie, { secure: !cookie.secure })
                    }
                  >
                    {cookie.secure ? "✓" : ""}
                  </FlagCell>
                  <EditableCell
                    value={SAME_SITE_LABELS[cookie.sameSite]}
                    label={`Edit SameSite of cookie ${cookie.name}`}
                    muted
                    placeholder="Strict, Lax, None"
                    onCommit={(next) => saveSameSite(cookie, next)}
                  />
                  <GridActionCell>
                    <IconButton
                      aria-label={`Delete cookie ${cookie.name}`}
                      onClick={() => void remove(cookie)}
                    >
                      <Icon name="X" size={11} />
                    </IconButton>
                  </GridActionCell>
                </GridRow>
              ))}
              {draftRow !== null && (
                <GridRow
                  onBlur={(event) => {
                    // Commit only when focus leaves the whole draft row, not
                    // when it hops from the name input to the value input.
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    ) {
                      void commitDraftRow();
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void commitDraftRow();
                    }
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setDraftRow(null);
                    }
                  }}
                >
                  <DraftCell>
                    <DevtoolsField $grow $plain>
                      <Input
                        $size="small"
                        $fullWidth
                        autoFocus
                        aria-label="New cookie name"
                        placeholder="Name"
                        value={draftRow.name}
                        onChange={(event) =>
                          setDraftRow({ ...draftRow, name: event.target.value })
                        }
                      />
                    </DevtoolsField>
                  </DraftCell>
                  <DraftCell>
                    <DevtoolsField $grow $plain>
                      <Input
                        $size="small"
                        $fullWidth
                        aria-label="New cookie value"
                        placeholder="Value"
                        value={draftRow.value}
                        onChange={(event) =>
                          setDraftRow({
                            ...draftRow,
                            value: event.target.value,
                          })
                        }
                      />
                    </DevtoolsField>
                  </DraftCell>
                  <MutedCell>{window.location.hostname}</MutedCell>
                  <MutedCell>/</MutedCell>
                  <MutedCell>Session</MutedCell>
                  <MutedCell />
                  <FlagCell />
                  <FlagCell />
                  <MutedCell />
                  <td />
                </GridRow>
              )}
            </tbody>
          </CookieGrid>
        )}
      </Scroller>

      <StatusBar>
        <span>{visible.length} cookies</span>
        <span>{totalSize} B</span>
      </StatusBar>
    </Panel>
  );
}
