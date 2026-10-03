import { describe, expect, it } from "vitest";

import { terminateReplInput } from "./repl-input";

describe("terminateReplInput", () => {
  it("terminates a single-line statement once", () => {
    expect(terminateReplInput("1 + 2")).toBe("1 + 2\n");
  });

  it("adds the blank line needed to execute a compound statement", () => {
    expect(terminateReplInput("while True:\n    pass")).toBe("while True:\n    pass\n\n");
  });

  it("normalizes line endings and avoids accumulating trailing blank lines", () => {
    expect(terminateReplInput("def answer():\r\n    return 42\r\n\r\n")).toBe(
      "def answer():\n    return 42\n\n",
    );
  });
});
