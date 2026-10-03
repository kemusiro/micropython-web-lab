import { describe, expect, it } from "vitest";

import {
  isInterruptShortcut,
  terminalSequenceForKey,
  type TerminalKeyInput,
} from "./terminal-key-input";

function keyInput(key: string, overrides: Partial<TerminalKeyInput> = {}): TerminalKeyInput {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("terminalSequenceForKey", () => {
  it("maps editing and navigation keys to MicroPython REPL sequences", () => {
    expect(terminalSequenceForKey(keyInput("Enter"))).toBe("\r");
    expect(terminalSequenceForKey(keyInput("Backspace"))).toBe("\x7f");
    expect(terminalSequenceForKey(keyInput("ArrowUp"))).toBe("\x1b[A");
    expect(terminalSequenceForKey(keyInput("ArrowDown"))).toBe("\x1b[B");
    expect(terminalSequenceForKey(keyInput("ArrowLeft"))).toBe("\x1b[D");
    expect(terminalSequenceForKey(keyInput("Delete"))).toBe("\x1b[3~");
  });

  it("maps supported control keys without intercepting clipboard shortcuts", () => {
    expect(terminalSequenceForKey(keyInput("c", { ctrlKey: true }))).toBe("\x03");
    expect(terminalSequenceForKey(keyInput("D", { ctrlKey: true }))).toBe("\x04");
    expect(terminalSequenceForKey(keyInput("v", { ctrlKey: true }))).toBeNull();
    expect(terminalSequenceForKey(keyInput("c", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it("leaves printable, composition, and browser shortcut keys to input events", () => {
    expect(terminalSequenceForKey(keyInput("a"))).toBeNull();
    expect(terminalSequenceForKey(keyInput("Process"))).toBeNull();
    expect(terminalSequenceForKey(keyInput("v", { metaKey: true }))).toBeNull();
    expect(terminalSequenceForKey(keyInput("ArrowUp", { altKey: true }))).toBeNull();
  });
});

describe("isInterruptShortcut", () => {
  it("accepts Control-C and Command-C", () => {
    expect(isInterruptShortcut(keyInput("c", { ctrlKey: true }))).toBe(true);
    expect(isInterruptShortcut(keyInput("C", { metaKey: true }))).toBe(true);
  });

  it("does not capture modified or unrelated copy shortcuts", () => {
    expect(isInterruptShortcut(keyInput("c"))).toBe(false);
    expect(isInterruptShortcut(keyInput("c", { metaKey: true, shiftKey: true }))).toBe(false);
    expect(isInterruptShortcut(keyInput("v", { metaKey: true }))).toBe(false);
  });
});
