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
import { EditableCell } from "~injected/panels/editable-cell";

/**
 * The injected inspector shares the page's origin, so window.localStorage
 * and window.sessionStorage ARE the page's storage — read and written
 * directly, no background round-trip or extra permission involved (unlike
 * cookies). Double-click a cell to edit it in place, as DevTools does.
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

const ErrorNote = styled.div`
  padding: 2px 6px;
  color: ${({ theme }) => theme.devtools.status.error};
  font-family: ${({ theme }) => theme.devtools.fontFamily};
  font-size: ${({ theme }) => theme.devtools.fontSizeSmall};
  background: ${({ theme }) => theme.devtools.status.errorBackground};
  border-bottom: solid 1px ${({ theme }) => theme.devtools.status.errorBorder};
`;

/** Cells of the add-entry draft row, edit-ready without a double-click. */
const DraftCell = styled.td`
  color: ${({ theme }) => theme.devtools.text};
`;

function areaStorage(area: StorageArea): Storage {
  return area === "local" ? window.localStorage : window.sessionStorage;
}

export function StoragePanel() {
  const [area, setArea] = useState<StorageArea>("local");
  const [filter, setFilter] = useState("");
  const [generation, setGeneration] = useState(0);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [draft, setDraft] = useState<StorageEntry | null>(null);

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
    // generation forces a re-read after refresh clicks and writes.
  }, [area, generation]);

  const refresh = () => setGeneration((current) => current + 1);

  const switchArea = (next: StorageArea) => {
    setArea(next);
    setDraft(null);
    setWriteError(null);
  };

  /** Runs a storage write, mapping quota/access throws to the error bar. */
  const write = (action: () => void, failure: string) => {
    try {
      action();
      setWriteError(null);
    } catch {
      setWriteError(failure);
    }
    refresh();
  };

  const remove = (key: string) => {
    write(
      () => areaStorage(area).removeItem(key),
      "The entry could not be deleted.",
    );
  };

  const saveValue = (key: string, value: string) => {
    write(
      () => areaStorage(area).setItem(key, value),
      "The value could not be saved — storage may be full.",
    );
  };

  /** Set-then-remove, so a failed write never loses the entry. Renaming onto
   *  an existing key overwrites it, as DevTools does. */
  const renameKey = (entry: StorageEntry, nextKey: string) => {
    if (!nextKey || nextKey === entry.key) return;
    write(() => {
      const storage = areaStorage(area);
      storage.setItem(nextKey, entry.value);
      storage.removeItem(entry.key);
    }, "The entry could not be renamed — storage may be full.");
  };

  const clearArea = () => {
    write(() => areaStorage(area).clear(), "Storage could not be cleared.");
  };

  const commitDraft = () => {
    if (draft === null) return;
    if (!draft.key) {
      setDraft(null);
      return;
    }
    const pending = draft;
    setDraft(null);
    write(
      () => areaStorage(area).setItem(pending.key, pending.value),
      "The entry could not be added — storage may be full.",
    );
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

  const showGrid = !error && (visible.length > 0 || draft !== null);

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
            onClick={() => switchArea(entry.id)}
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
          <IconButton
            aria-label="Add storage entry"
            disabled={Boolean(error)}
            onClick={() => setDraft({ key: "", value: "" })}
          >
            <Icon name="Plus" size={14} />
          </IconButton>
          <IconButton
            aria-label="Clear storage area"
            disabled={Boolean(error)}
            onClick={clearArea}
          >
            <Icon name="Ban" size={14} />
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

      {writeError && <ErrorNote role="alert">{writeError}</ErrorNote>}

      <Scroller>
        {error ? (
          <EmptyState>{error}</EmptyState>
        ) : !showGrid ? (
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
                  <EditableCell
                    value={entry.key}
                    label={`Edit key ${entry.key}`}
                    onCommit={(next) => renameKey(entry, next)}
                  />
                  <EditableCell
                    value={entry.value}
                    label={`Edit value of ${entry.key}`}
                    muted
                    onCommit={(next) => saveValue(entry.key, next)}
                  />
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
              {draft !== null && (
                <GridRow
                  onBlur={(event) => {
                    // Commit only when focus leaves the whole draft row, not
                    // when it hops from the key input to the value input.
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    ) {
                      commitDraft();
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitDraft();
                    }
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setDraft(null);
                    }
                  }}
                >
                  <DraftCell>
                    <DevtoolsField $grow $plain>
                      <Input
                        $size="small"
                        $fullWidth
                        autoFocus
                        aria-label="New entry key"
                        placeholder="Key"
                        value={draft.key}
                        onChange={(event) =>
                          setDraft({ ...draft, key: event.target.value })
                        }
                      />
                    </DevtoolsField>
                  </DraftCell>
                  <DraftCell>
                    <DevtoolsField $grow $plain>
                      <Input
                        $size="small"
                        $fullWidth
                        aria-label="New entry value"
                        placeholder="Value"
                        value={draft.value}
                        onChange={(event) =>
                          setDraft({ ...draft, value: event.target.value })
                        }
                      />
                    </DevtoolsField>
                  </DraftCell>
                  <td />
                </GridRow>
              )}
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
