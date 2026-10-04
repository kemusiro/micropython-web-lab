import type { MicroPythonInstance } from "../vendor/micropython";

/** A nonzero REPL result requests exit/reset; Ctrl+D inside a block returns zero. */
export function processReplInput(
  runtime: Pick<MicroPythonInstance, "replProcessChar">,
  data: string,
  onReset: () => void,
  onExecute: () => void = () => {},
): void {
  const normalized = data
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\n", "\r");
  for (const byte of new TextEncoder().encode(normalized)) {
    if (byte === 13 || byte === 4) {
      onExecute();
    }
    if (runtime.replProcessChar(byte) !== 0) {
      onReset();
      // Discard any trailing input addressed to the old interpreter.
      return;
    }
  }
}

export function terminateReplInput(input: string): string {
  const normalized = input.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const withoutTrailingNewlines = normalized.replace(/\n+$/, "");
  const terminator = withoutTrailingNewlines.includes("\n") ? "\n\n" : "\n";

  return `${withoutTrailingNewlines}${terminator}`;
}
