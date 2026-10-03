const MAX_REPL_BRIDGE_ERROR_CHARACTERS = 1_000;
const REPL_INTERRUPT_CHARACTER = 3;

export interface ReplRecoveryRuntime {
  replProcessChar(character: number): number;
}

export function recoverReplFromBridgeError(
  runtime: ReplRecoveryRuntime,
  error: unknown,
  writeStderr: (data: string) => void,
): void {
  writeStderr(`\r\n${formatReplBridgeError(error)}\r\n`);
  runtime.replProcessChar(REPL_INTERRUPT_CHARACTER);
}

export function formatReplBridgeError(error: unknown): string {
  const pythonType =
    error instanceof TypeError
      ? "TypeError"
      : error instanceof RangeError
        ? "ValueError"
        : "RuntimeError";
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = Array.from(rawMessage.replace(/[\u0000-\u001f\u007f]/g, " "))
    .slice(0, MAX_REPL_BRIDGE_ERROR_CHARACTERS)
    .join("");
  return `${pythonType}: ${message}`;
}
