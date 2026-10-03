import { describe, expect, it } from "vitest";

import { loadMicroPython } from "../vendor/micropython-build/micropython.mjs";
import { formatReplBridgeError, recoverReplFromBridgeError } from "./repl-bridge-error";

describe("REPL bridge error recovery", () => {
  it("maps JavaScript validation failures to bounded Python-style errors", () => {
    expect(formatReplBridgeError(new RangeError("unsupported pin"))).toBe(
      "ValueError: unsupported pin",
    );
    expect(formatReplBridgeError(new TypeError("invalid\nvalue"))).toBe(
      "TypeError: invalid value",
    );
  });

  it("restores the REPL prompt without discarding Python globals", async () => {
    const decoder = new TextDecoder();
    const output: string[] = [];
    const runtime = await loadMicroPython({
      url: new URL("../vendor/micropython-build/micropython.wasm", import.meta.url).href,
      linebuffer: false,
      stdout: (data) => output.push(decoder.decode(data, { stream: true })),
      stderr: (data) => output.push(decoder.decode(data, { stream: true })),
    });
    runtime.registerJsModule("_test_bridge", {
      fail(): void {
        throw new RangeError("Unsupported test value");
      },
    });
    runtime.replInit();

    feedRepl(runtime, "saved = 40\r");
    feedRepl(runtime, "import _test_bridge\r");
    try {
      feedRepl(runtime, "_test_bridge.fail()\r");
    } catch (error) {
      recoverReplFromBridgeError(runtime, error, (data) => output.push(data));
    }
    feedRepl(runtime, "saved + 2\r");

    const rendered = output.join("");
    expect(rendered).toContain("ValueError: Unsupported test value");
    expect(rendered).toContain("saved + 2\r\n42\n>>> ");
    expect(rendered).not.toContain("SyntaxError");
  });
});

function feedRepl(
  runtime: { replProcessChar(character: number): number },
  input: string,
): void {
  for (const byte of new TextEncoder().encode(input)) {
    runtime.replProcessChar(byte);
  }
}
