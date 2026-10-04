import { describe, expect, it, vi } from "vitest";
import { loadMicroPython } from "../vendor/micropython-build/micropython.mjs";
import { processReplInput, terminateReplInput } from "./repl-input";

describe("processReplInput", () => {
  it("handles the pinned WASM reset result without treating block completion as a reset", async () => {
    const runtime = await loadMicroPython({
      url: new URL("../vendor/micropython-build/micropython.wasm", import.meta.url).href,
      stdout: () => {},
      linebuffer: false,
    });
    const reset = vi.fn();
    runtime.replInit();
    processReplInput(runtime, "marker=123\n", reset);
    processReplInput(runtime, "if True:\n print(42)\n\x04", reset);
    expect(reset).not.toHaveBeenCalled();
    processReplInput(runtime, "\x04", reset);
    expect(reset).toHaveBeenCalledOnce();
  });

  it("does not send trailing input to the interpreter requesting reset", () => {
    const replProcessChar = vi.fn((byte: number) => byte === 4 ? 256 : 0);
    const reset = vi.fn();
    const execute = vi.fn();
    processReplInput({ replProcessChar }, "\r\n\x04discarded", reset, execute);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(replProcessChar.mock.calls).toEqual([[13], [4]]);
    expect(reset).toHaveBeenCalledOnce();
  });
});

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
