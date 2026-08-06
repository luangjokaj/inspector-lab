import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { Icon, IconButton, Input, Select } from "cherry-styled-components";
import {
  DevtoolsField,
  EmptyState,
  Panel,
  PanelToolbar,
  Scroller,
  ToolbarControls,
  ToolbarDivider,
  devtoolsMono,
} from "~injected/devtools.styled";

export type ConsoleLevel =
  "log" | "info" | "warning" | "error" | "input" | "result";

export type ConsoleEntry = {
  id: number;
  level: ConsoleLevel;
  text: string;
};

const MessageList = styled.div`
  ${devtoolsMono};
  display: flex;
  flex-direction: column;
`;

const Message = styled.div<{ $level: ConsoleLevel }>`
  display: flex;
  align-items: flex-start;
  gap: 4px;
  min-height: 17px;
  padding: 1px 6px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  border-bottom: solid 1px ${({ theme }) => theme.devtools.border};

  ${({ theme, $level }) => {
    if ($level === "error") {
      return css`
        color: ${theme.devtools.status.error};
        background: ${theme.devtools.status.errorBackground};
        border-bottom-color: ${theme.devtools.status.errorBorder};
      `;
    }
    if ($level === "warning") {
      return css`
        color: ${theme.devtools.status.warning};
        background: ${theme.devtools.status.warningBackground};
        border-bottom-color: ${theme.devtools.status.warningBorder};
      `;
    }
    if ($level === "result") {
      return css`
        color: ${theme.devtools.textSubtle};
      `;
    }
    if ($level === "info") {
      return css`
        color: ${theme.devtools.status.info};
      `;
    }
    return css`
      color: ${theme.devtools.text};
    `;
  }};
`;

/** The `›` / `‹` glyph DevTools puts in front of input and result rows. */
const Chevron = styled.span<{ $direction: "in" | "out" }>`
  flex: 0 0 auto;
  color: ${({ theme, $direction }) =>
    $direction === "in" ? theme.devtools.accent : theme.devtools.textSubtle};
  user-select: none;
`;

const MessageText = styled.span`
  flex: 1 1 auto;
  min-width: 0;
`;

/** The bottom row where expressions are typed. */
const PromptRow = styled.div`
  ${devtoolsMono};
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 4px;
  min-height: 19px;
  padding: 1px 6px;
  background: ${({ theme }) => theme.devtools.surface};
  border-top: solid 1px ${({ theme }) => theme.devtools.border};
`;

export type ConsolePanelProps = {
  entries: ConsoleEntry[];
  onSubmit: (expression: string) => void;
  onClear: () => void;
};

export function ConsolePanel({
  entries,
  onSubmit,
  onClear,
}: ConsolePanelProps) {
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");
  const [level, setLevel] = useState<"all" | "errors" | "warnings" | "info">(
    "all",
  );
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const visible = entries.filter((entry) => {
    if (
      filter.trim() &&
      !entry.text.toLowerCase().includes(filter.trim().toLowerCase())
    ) {
      return false;
    }
    if (level === "errors") return entry.level === "error";
    if (level === "warnings") return entry.level === "warning";
    if (level === "info")
      return entry.level === "info" || entry.level === "log";
    return true;
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    onSubmit(draft);
    setDraft("");
  };

  return (
    <Panel>
      <PanelToolbar>
        <ToolbarControls>
          <IconButton aria-label="Clear console" onClick={onClear}>
            <Icon name="Ban" size={14} />
          </IconButton>
        </ToolbarControls>
        <ToolbarDivider />
        <DevtoolsField $grow>
          <Input
            id="inspector-console-filter"
            $size="small"
            $fullWidth
            placeholder="Filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </DevtoolsField>
        <DevtoolsField>
          <Select
            id="inspector-console-levels"
            $size="small"
            value={level}
            onChange={(event) => setLevel(event.target.value as typeof level)}
          >
            <option value="all">All levels</option>
            <option value="errors">Errors</option>
            <option value="warnings">Warnings</option>
            <option value="info">Info</option>
          </Select>
        </DevtoolsField>
      </PanelToolbar>

      <Scroller>
        {visible.length === 0 ? (
          <EmptyState>
            Console messages from the inspector appear here.
          </EmptyState>
        ) : (
          <MessageList role="log" aria-label="Console messages">
            {visible.map((entry) => (
              <Message key={entry.id} $level={entry.level}>
                {entry.level === "input" && (
                  <Chevron $direction="in">›</Chevron>
                )}
                {entry.level === "result" && (
                  <Chevron $direction="out">‹</Chevron>
                )}
                <MessageText>{entry.text}</MessageText>
              </Message>
            ))}
          </MessageList>
        )}
        <div ref={bottomRef} />
      </Scroller>

      <PromptRow as="form" onSubmit={submit}>
        <Chevron $direction="in">›</Chevron>
        <DevtoolsField $grow $plain>
          <Input
            id="inspector-console-prompt"
            $size="small"
            $fullWidth
            placeholder="Type an expression"
            aria-label="Console prompt"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </DevtoolsField>
      </PromptRow>
    </Panel>
  );
}
