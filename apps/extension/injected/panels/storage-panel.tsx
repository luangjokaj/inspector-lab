import { useMemo, useState } from "react";
import styled from "styled-components";
import { Icon, IconButton, Input } from "cherry-styled-components";
import {
  DataGrid,
  DevtoolsField,
  EmptyState,
  GridActionCell,
  GridRow,
  Panel,
  PanelToolbar,
  Scroller,
  StatusBar,
  SubTab,
  SubTabBar,
  ToolbarControls,
  ToolbarDivider,
} from "~injected/devtools.styled";

/**
 * The injected inspector shares the page's origin, so window.localStorage
 * and window.sessionStorage ARE the page's storage — read directly, no
 * background round-trip or extra permission involved (unlike cookies).
 */

type StorageArea = "local" | "session";

type StorageEntry = { key: string; value: string };

const AREAS: { id: StorageArea; label: string }[] = [
  { id: "local", label: "Local Storage" },
  { id: "session", label: "Session Storage" },
];

const StorageGrid = styled(DataGrid)`
  th:nth-child(1) {
    width: 30%;
  }
  th:nth-child(2) {
    width: 70%;
  }
  th:nth-child(3) {
    width: 24px;
  }
`;

const KeyCell = styled.td`
  color: ${({ theme }) => theme.devtools.text};
`;

const ValueCell = styled.td`
  color: ${({ theme }) => theme.devtools.textSubtle};
`;

function areaStorage(area: StorageArea): Storage {
  return area === "local" ? window.localStorage : window.sessionStorage;
}

export function StoragePanel() {
  const [area, setArea] = useState<StorageArea>("local");
  const [filter, setFilter] = useState("");
  const [generation, setGeneration] = useState(0);

  const { entries, error } = useMemo((): {
    entries: StorageEntry[];
    error: string | null;
  } => {
    try {
      const storage = areaStorage(area);
      const list: StorageEntry[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null) {
          list.push({ key, value: storage.getItem(key) ?? "" });
        }
      }
      return {
        entries: list.sort((a, b) => a.key.localeCompare(b.key)),
        error: null,
      };
    } catch {
      // Storage access can throw when the page has blocked site data.
      return {
        entries: [],
        error: "Storage is not accessible on this page.",
      };
    }
    // generation forces a re-read after refresh clicks and deletions.
  }, [area, generation]);

  const refresh = () => setGeneration((current) => current + 1);

  const remove = (key: string) => {
    try {
      areaStorage(area).removeItem(key);
    } catch {
      /* The re-read below will surface the storage error state. */
    }
    refresh();
  };

  const visible = entries.filter((entry) => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return `${entry.key}${entry.value}`.toLowerCase().includes(needle);
  });

  const totalSize = visible.reduce(
    (total, entry) => total + entry.key.length + entry.value.length,
    0,
  );

  return (
    <Panel>
      <SubTabBar role="tablist" aria-label="Storage areas">
        {AREAS.map((entry) => (
          <SubTab
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={area === entry.id}
            $selected={area === entry.id}
            onClick={() => setArea(entry.id)}
          >
            {entry.label}
          </SubTab>
        ))}
      </SubTabBar>

      <PanelToolbar>
        <ToolbarControls>
          <IconButton aria-label="Refresh storage list" onClick={refresh}>
            <Icon name="RefreshCw" size={14} />
          </IconButton>
        </ToolbarControls>
        <ToolbarDivider />
        <DevtoolsField $grow>
          <Input
            id="inspector-storage-filter"
            $size="small"
            $fullWidth
            placeholder="Filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </DevtoolsField>
      </PanelToolbar>

      <Scroller>
        {error ? (
          <EmptyState>{error}</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState>
            {filter.trim()
              ? "No entries match the filter."
              : `This page has no ${area === "local" ? "local" : "session"} storage entries.`}
          </EmptyState>
        ) : (
          <StorageGrid>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Value</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <GridRow key={entry.key}>
                  <KeyCell title={entry.key}>{entry.key}</KeyCell>
                  <ValueCell title={entry.value}>{entry.value}</ValueCell>
                  <GridActionCell>
                    <IconButton
                      aria-label={`Delete storage key ${entry.key}`}
                      onClick={() => remove(entry.key)}
                    >
                      <Icon name="X" size={11} />
                    </IconButton>
                  </GridActionCell>
                </GridRow>
              ))}
            </tbody>
          </StorageGrid>
        )}
      </Scroller>

      <StatusBar>
        <span>{visible.length} entries</span>
        <span>{totalSize} B</span>
      </StatusBar>
    </Panel>
  );
}
