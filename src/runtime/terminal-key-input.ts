export interface TerminalKeyInput {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const NAMED_KEY_SEQUENCES: Readonly<Record<string, string>> = {
  Enter: "\r",
  Backspace: "\x7f",
  Delete: "\x1b[3~",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x01",
  End: "\x05",
  Tab: "\t",
  Escape: "\x1b",
};

const CONTROL_KEY_SEQUENCES: Readonly<Record<string, string>> = {
  a: "\x01",
  b: "\x02",
  c: "\x03",
  d: "\x04",
  e: "\x05",
  f: "\x06",
  k: "\x0b",
  l: "\x0c",
  n: "\x0e",
  p: "\x10",
  u: "\x15",
  w: "\x17",
};

export function terminalSequenceForKey(input: TerminalKeyInput): string | null {
  if (input.metaKey || input.altKey) {
    return null;
  }

  if (input.ctrlKey && !input.shiftKey) {
    return CONTROL_KEY_SEQUENCES[input.key.toLowerCase()] ?? null;
  }

  if (input.ctrlKey) {
    return null;
  }

  return NAMED_KEY_SEQUENCES[input.key] ?? null;
}

export function isInterruptShortcut(input: TerminalKeyInput): boolean {
  return (
    input.key.toLowerCase() === "c" &&
    (input.ctrlKey || input.metaKey) &&
    !input.altKey &&
    !input.shiftKey
  );
}
