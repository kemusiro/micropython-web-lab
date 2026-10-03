import { describe, expect, it } from "vitest";

import { changeEditorIndentation } from "./indentation";

describe("changeEditorIndentation", () => {
  it("inserts one four-space level at a collapsed cursor", () => {
    expect(changeEditorIndentation("print('x')", 0, 0, "indent")).toEqual({
      value: "    print('x')",
      selectionStart: 4,
      selectionEnd: 4,
      changed: true,
    });
  });

  it("indents every selected line but excludes a trailing unselected line", () => {
    expect(changeEditorIndentation("first\nsecond\nthird", 0, 13, "indent")).toEqual({
      value: "    first\n    second\nthird",
      selectionStart: 4,
      selectionEnd: 21,
      changed: true,
    });
  });

  it("outdents spaces and tabs across selected lines", () => {
    expect(changeEditorIndentation("    first\n\tsecond\n  third", 2, 25, "outdent")).toEqual({
      value: "first\nsecond\nthird",
      selectionStart: 0,
      selectionEnd: 18,
      changed: true,
    });
  });

  it("outdents the current line and keeps the cursor with its content", () => {
    expect(changeEditorIndentation("if True:\n    print('x')", 18, 18, "outdent")).toEqual({
      value: "if True:\nprint('x')",
      selectionStart: 14,
      selectionEnd: 14,
      changed: true,
    });
  });

  it("does nothing when the current line has no indentation to remove", () => {
    expect(changeEditorIndentation("print('x')", 3, 3, "outdent")).toEqual({
      value: "print('x')",
      selectionStart: 3,
      selectionEnd: 3,
      changed: false,
    });
  });
});
