import { describe, expect, it } from "vitest";

import { TerminalScreen } from "./terminal-screen";

describe("TerminalScreen", () => {
  it("renders ordinary output and normalizes terminal newlines", () => {
    const screen = new TerminalScreen();

    screen.write("MicroPython\r\n>>> ");

    expect(screen.text).toBe("MicroPython\n>>> ");
    expect(screen.cursorOffset).toBe(screen.text.length);
  });

  it("applies the backspace and erase-to-end sequence emitted by MicroPython", () => {
    const screen = new TerminalScreen();
    screen.write(">>> 123");

    screen.write("\b\x1b[K");

    expect(screen.text).toBe(">>> 12");
    expect(screen.cursorOffset).toBe(screen.text.length);
  });

  it("keeps an incomplete escape sequence until the next output chunk", () => {
    const screen = new TerminalScreen();
    screen.write(">>> 123\b\x1b[");

    expect(screen.text).toBe(">>> 123");

    screen.write("K");
    expect(screen.text).toBe(">>> 12");
  });

  it("tracks cursor movement separately from the rendered text", () => {
    const screen = new TerminalScreen();
    screen.write(">>> 123");

    screen.write("\x1b[2D");

    expect(screen.text).toBe(">>> 123");
    expect(screen.text.slice(0, screen.cursorOffset)).toBe(">>> 1");
    expect(screen.text.slice(screen.cursorOffset)).toBe("23");
  });

  it("clears and replaces its contents", () => {
    const screen = new TerminalScreen();
    screen.write("old output");

    screen.replace("new output");
    expect(screen.text).toBe("new output");

    screen.clear();
    expect(screen.text).toBe("");
    expect(screen.cursorOffset).toBe(0);
  });
});
