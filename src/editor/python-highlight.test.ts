import { describe, expect, it } from "vitest";
import { highlightPython } from "./python-highlight";

describe("Python highlighting", () => {
  it("highlights whole keywords while preserving the exact source", () => {
    const source = "from machine import Pin\nif True and not False:\n    pass\n";
    const tokens = highlightPython(source);
    expect(tokens.map((token) => token.text).join("")).toBe(source);
    expect(tokens.filter((token) => token.kind === "keyword").map((token) => token.text))
      .toEqual(["from", "import", "if", "True", "and", "not", "False", "pass"]);
    expect(highlightPython("classify return_value if変数 変数if").some((token) => token.kind === "keyword"))
      .toBe(false);
  });

  it("keeps keywords and markup inside strings and comments", () => {
    const source = String.raw`# if True <script>
value = "return \"False\""
text = r'''for
while <img src=x>'''
if value:
    pass`;
    const tokens = highlightPython(source);
    expect(tokens.map((token) => token.text).join("")).toBe(source);
    expect(tokens.filter((token) => token.kind === "keyword").map((token) => token.text))
      .toEqual(["if", "pass"]);
    expect(tokens.filter((token) => token.kind === "string")).toHaveLength(2);
    expect(tokens.find((token) => token.kind === "comment")?.text).toBe("# if True <script>");
  });

  it("handles unfinished strings, escaped newlines, and an empty document", () => {
    for (const source of ["", "'if\npass", '"""if\npass', "'if\\\npass'\nreturn"]) {
      expect(highlightPython(source).map((token) => token.text).join("")).toBe(source);
    }
    expect(highlightPython("'if\npass").filter((token) => token.kind === "keyword"))
      .toEqual([{ kind: "keyword", text: "pass" }]);
    expect(highlightPython('"""if\npass').filter((token) => token.kind === "keyword"))
      .toEqual([]);
  });
});
