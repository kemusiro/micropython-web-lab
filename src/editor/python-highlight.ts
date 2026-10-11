export type PythonTokenKind = "plain" | "keyword" | "string" | "comment";

export interface PythonToken {
  kind: PythonTokenKind;
  text: string;
}

const KEYWORDS = new Set(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "),
);

// A lexical display only: incomplete code remains editable, and strings/comments
// are consumed before identifiers so their contents never become keywords.
export function highlightPython(source: string): PythonToken[] {
  const tokens: PythonToken[] = [];
  const pattern = /#[^\n]*|(?:[rRuUbBfF]{1,2})?(?:"""|'''|"|')|[\p{L}\p{N}_]+/gu;
  let offset = 0;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    if (match.index > offset) {
      tokens.push({ kind: "plain", text: source.slice(offset, match.index) });
    }
    let end = pattern.lastIndex;
    let kind: PythonTokenKind = "plain";
    if (match[0].startsWith("#")) {
      kind = "comment";
    } else if (/["']/.test(match[0])) {
      kind = "string";
      const delimiter = match[0].replace(/^[rRuUbBfF]+/, "");
      while (end < source.length) {
        if (source.startsWith(delimiter, end)) {
          end += delimiter.length;
          break;
        }
        if (source[end] === "\\") {
          end = Math.min(source.length, end + 2);
        } else if (delimiter.length === 1 && source[end] === "\n") {
          break;
        } else {
          end += 1;
        }
      }
    } else if (KEYWORDS.has(match[0])) {
      kind = "keyword";
    }
    tokens.push({ kind, text: source.slice(match.index, end) });
    offset = end;
    pattern.lastIndex = end;
  }
  if (offset < source.length) {
    tokens.push({ kind: "plain", text: source.slice(offset) });
  }
  return tokens;
}
