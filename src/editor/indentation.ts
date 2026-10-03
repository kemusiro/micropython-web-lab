export const EDITOR_INDENT = "    ";

export type IndentDirection = "indent" | "outdent";

export interface EditorIndentationResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  changed: boolean;
}

interface TextEdit {
  at: number;
  remove: number;
  insert: string;
}

export function changeEditorIndentation(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: IndentDirection,
): EditorIndentationResult {
  const start = clampSelection(selectionStart, value.length);
  const end = clampSelection(Math.max(selectionStart, selectionEnd), value.length);

  if (direction === "indent" && start === end) {
    return {
      value: `${value.slice(0, start)}${EDITOR_INDENT}${value.slice(end)}`,
      selectionStart: start + EDITOR_INDENT.length,
      selectionEnd: start + EDITOR_INDENT.length,
      changed: true,
    };
  }

  const lineStarts = selectedLineStarts(value, start, end);
  const edits = lineStarts
    .map<TextEdit | null>((at) => {
      if (direction === "indent") {
        return { at, remove: 0, insert: EDITOR_INDENT };
      }
      const remove = indentationToRemove(value, at);
      return remove === 0 ? null : { at, remove, insert: "" };
    })
    .filter((edit): edit is TextEdit => edit !== null);

  if (edits.length === 0) {
    return { value, selectionStart: start, selectionEnd: end, changed: false };
  }

  let nextValue = value;
  for (const edit of [...edits].reverse()) {
    nextValue = `${nextValue.slice(0, edit.at)}${edit.insert}${nextValue.slice(edit.at + edit.remove)}`;
  }

  return {
    value: nextValue,
    selectionStart: transformPosition(start, edits),
    selectionEnd: transformPosition(end, edits),
    changed: true,
  };
}

function selectedLineStarts(value: string, start: number, end: number): number[] {
  const first = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const starts = [first];
  let cursor = first;
  while (true) {
    const newline = value.indexOf("\n", cursor);
    if (newline === -1) {
      break;
    }
    const next = newline + 1;
    if (next > end || (next === end && end > start)) {
      break;
    }
    starts.push(next);
    cursor = next;
  }
  return starts;
}

function indentationToRemove(value: string, lineStart: number): number {
  if (value[lineStart] === "\t") {
    return 1;
  }
  let spaces = 0;
  while (spaces < EDITOR_INDENT.length && value[lineStart + spaces] === " ") {
    spaces += 1;
  }
  return spaces;
}

function transformPosition(position: number, edits: readonly TextEdit[]): number {
  let delta = 0;
  for (const edit of edits) {
    if (edit.remove === 0) {
      if (edit.at <= position) {
        delta += edit.insert.length;
      }
      continue;
    }
    if (position <= edit.at) {
      continue;
    }
    if (position <= edit.at + edit.remove) {
      return edit.at + delta;
    }
    delta += edit.insert.length - edit.remove;
  }
  return position + delta;
}

function clampSelection(value: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(maximum, Math.max(0, Math.trunc(value)));
}
