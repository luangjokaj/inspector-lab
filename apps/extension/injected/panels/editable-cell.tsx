import { useState } from "react";
import styled from "styled-components";
import { Input } from "cherry-styled-components";
import { DevtoolsField } from "~injected/devtools.styled";

/**
 * A data-grid cell that turns into an inline editor on double-click, the way
 * DevTools' cookie and storage tables edit in place. Enter or blur commits,
 * Escape cancels. The commit callback only fires when the text changed.
 */

const Cell = styled.td<{ $muted?: boolean }>`
  color: ${({ theme, $muted }) =>
    $muted ? theme.devtools.textSubtle : theme.devtools.text};
`;

export type EditableCellProps = {
  value: string;
  /** Accessible name for the inline editor, e.g. "Edit value of sid". */
  label: string;
  /** Render with the subtle text color the grids use for secondary columns. */
  muted?: boolean;
  placeholder?: string;
  onCommit: (next: string) => void;
};

export function EditableCell({
  value,
  label,
  muted,
  placeholder,
  onCommit,
}: EditableCellProps) {
  /** null while displaying; the in-progress text while editing. */
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };

  return (
    <Cell
      $muted={muted}
      title={draft === null ? value : undefined}
      onDoubleClick={() => setDraft(value)}
    >
      {draft === null ? (
        value
      ) : (
        <DevtoolsField $grow $plain>
          <Input
            $size="small"
            $fullWidth
            autoFocus
            aria-label={label}
            placeholder={placeholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") {
                event.stopPropagation();
                setDraft(null);
              }
            }}
          />
        </DevtoolsField>
      )}
    </Cell>
  );
}
