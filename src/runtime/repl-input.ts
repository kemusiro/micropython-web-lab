export function terminateReplInput(input: string): string {
  const normalized = input.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const withoutTrailingNewlines = normalized.replace(/\n+$/, "");
  const terminator = withoutTrailingNewlines.includes("\n") ? "\n\n" : "\n";

  return `${withoutTrailingNewlines}${terminator}`;
}
