import { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { Icon, IconButton, Input } from "cherry-styled-components";
import {
  DataGrid,
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
import type {
  CookieEntry,
  DeleteCookieResponse,
  GetCookiesResponse,
} from "~lib/messages";

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

const NameCell = styled.td`
  color: ${({ theme }) => theme.devtools.text};
`;

const MutedCell = styled.td`
  color: ${({ theme }) => theme.devtools.textSubtle};
`;

/** ✓ marks for HttpOnly / Secure, centered as DevTools renders them. */
const FlagCell = styled.td`
  color: ${({ theme }) => theme.devtools.textSubtle};
  text-align: center;
`;

/**
 * Hover-revealed delete action, restyling the Cherry `IconButton` from the
 * parent the same way `ToolbarControls` does.
 */
const ActionCell = styled.td`
  padding: 0;

  button {
    width: 16px;
    height: 16px;
    min-width: 16px;
    padding: 0;
    color: ${({ theme }) => theme.devtools.textSubtle};
    background: transparent;
    border: none;
    border-radius: 2px;
    box-shadow: none;
    transition: none;
    opacity: 0;

    svg {
      width: 11px;
      height: 11px;
    }

    &:hover:not(:disabled) {
      color: ${({ theme }) => theme.devtools.text};
      background: ${({ theme }) => theme.devtools.tabHoverBackground};
      border: none;
      box-shadow: none;
    }

    &:focus,
    &:active {
      border: none;
      box-shadow: none;
    }

    &:focus-visible {
      outline: solid 1px ${({ theme }) => theme.devtools.focusRing};
      outline-offset: -1px;
      opacity: 1;
    }
  }

  ${GridRow}:hover & button {
    opacity: 1;
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

export type CookiesPanelProps = {
  loadCookies: () => Promise<GetCookiesResponse>;
  deleteCookie: (cookie: CookieEntry) => Promise<DeleteCookieResponse>;
};

export function CookiesPanel({ loadCookies, deleteCookie }: CookiesPanelProps) {
  const [cookies, setCookies] = useState<CookieEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    const response = await loadCookies();
    if (response.ok) {
      setError(null);
      setCookies(
        [...response.cookies].sort((a, b) => a.name.localeCompare(b.name)),
      );
    } else {
      setError(response.error ?? "Cookies could not be read.");
      setCookies([]);
    }
  }, [loadCookies]);

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

  return (
    <Panel>
      <PanelToolbar>
        <ToolbarControls>
          <IconButton aria-label="Refresh cookie list" onClick={refresh}>
            <Icon name="RefreshCw" size={14} />
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
      </PanelToolbar>

      {error && <ErrorNote role="alert">{error}</ErrorNote>}

      <Scroller>
        {cookies === null ? (
          <EmptyState>Reading cookies…</EmptyState>
        ) : visible.length === 0 ? (
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
                  <NameCell title={cookie.name}>{cookie.name}</NameCell>
                  <MutedCell title={cookie.value}>{cookie.value}</MutedCell>
                  <MutedCell title={cookie.domain}>{cookie.domain}</MutedCell>
                  <MutedCell title={cookie.path}>{cookie.path}</MutedCell>
                  <MutedCell title={expiresLabel(cookie)}>
                    {expiresLabel(cookie)}
                  </MutedCell>
                  <MutedCell>
                    {cookie.name.length + cookie.value.length}
                  </MutedCell>
                  <FlagCell>{cookie.httpOnly ? "✓" : ""}</FlagCell>
                  <FlagCell>{cookie.secure ? "✓" : ""}</FlagCell>
                  <MutedCell>{SAME_SITE_LABELS[cookie.sameSite]}</MutedCell>
                  <ActionCell>
                    <IconButton
                      aria-label={`Delete cookie ${cookie.name}`}
                      onClick={() => void remove(cookie)}
                    >
                      <Icon name="X" size={11} />
                    </IconButton>
                  </ActionCell>
                </GridRow>
              ))}
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
