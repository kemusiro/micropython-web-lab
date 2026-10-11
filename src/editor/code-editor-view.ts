import { t } from "../i18n/i18n";
import { highlightPython } from "./python-highlight";

/** Decorations are derived from the textarea; it remains the source of truth. */
export class CodeEditorView {
  #source: string | null = null;
  #breakpoints = new Set<number>();
  #currentLine: number | null = null;
  #rows: HTMLDivElement[] = [];
  #lineCount = 1;
  #firstRow = 0;
  #lastRow = 0;

  constructor(
    private readonly editor: HTMLTextAreaElement,
    private readonly area: HTMLElement,
    private readonly highlightedCode: HTMLElement,
    private readonly gutter: HTMLElement,
    private readonly cursorLine: HTMLElement,
  ) {
    editor.addEventListener("input", () => this.refresh());
    editor.addEventListener("scroll", () => this.syncScroll());
    for (const event of ["select", "selectionchange", "keyup", "click", "focus", "blur"]) {
      editor.addEventListener(event, () => this.updateCursor());
    }
    new ResizeObserver(() => this.syncScroll()).observe(editor);
    this.refresh();
  }

  refresh(): void {
    if (this.#source !== this.editor.value) {
      this.#source = this.editor.value;
      const fragment = document.createDocumentFragment();
      for (const token of highlightPython(this.#source)) {
        const span = document.createElement("span");
        span.className = `python-${token.kind}`;
        span.textContent = token.text;
        fragment.append(span);
      }
      // Preserve the final empty logical line in the visual layer.
      fragment.append(document.createTextNode("\n"));
      this.highlightedCode.replaceChildren(fragment);
      this.#lineCount = this.#source.split("\n").length;
      this.area.dataset.lineCount = String(this.#lineCount);
      this.area.style.setProperty("--editor-gutter-width", `${String(this.#lineCount).length + 5}ch`);
      this.#firstRow = 0;
      this.#lastRow = 0;
    }
    this.syncScroll();
  }

  private renderGutter(): void {
    const style = getComputedStyle(this.editor);
    const height = Number.parseFloat(style.lineHeight);
    const padding = Number.parseFloat(style.paddingTop);
    // The source limit permits hundreds of thousands of empty lines. Keep the
    // gutter bounded so those documents cannot create an equally large DOM.
    const virtual = this.#lineCount > 1_000;
    const first = virtual ? Math.max(1, Math.floor((this.editor.scrollTop - padding) / height) - 3) : 1;
    const last = virtual
      ? Math.min(this.#lineCount, first + Math.ceil(this.editor.clientHeight / height) + 8)
      : this.#lineCount;
    if (first !== this.#firstRow || last !== this.#lastRow) {
      this.#firstRow = first;
      this.#lastRow = last;
      this.gutter.style.paddingTop = `${padding + (first - 1) * height}px`;
      const fragment = document.createDocumentFragment();
      this.#rows = Array.from({ length: last - first + 1 }, (_, index) => {
        const row = document.createElement("div");
        row.className = "editor-line-number";
        row.dataset.line = String(first + index);
        const breakpoint = document.createElement("span");
        breakpoint.className = "editor-breakpoint-marker";
        breakpoint.textContent = "●";
        const current = document.createElement("span");
        current.className = "editor-execution-marker";
        current.textContent = "➜";
        const number = document.createElement("span");
        number.textContent = String(first + index);
        row.append(breakpoint, current, number);
        fragment.append(row);
        return row;
      });
      this.gutter.replaceChildren(fragment);
      this.updateMarkers();
    }
  }

  setBreakpoints(lines: readonly number[]): void {
    this.#breakpoints = new Set(lines);
    this.updateMarkers();
  }

  setCurrentLine(line: number | null): void {
    this.#currentLine = line;
    this.updateMarkers();
  }

  private updateMarkers(): void {
    for (const row of this.#rows) {
      const line = Number(row.dataset.line);
      row.dataset.breakpoint = String(this.#breakpoints.has(line));
      row.dataset.current = String(this.#currentLine === line);
      const labels = [String(line)];
      if (this.#breakpoints.has(line)) labels.push(t("debugger.breakpointLine", { line }));
      if (this.#currentLine === line) labels.push(t("debugger.currentLine", { line }));
      row.title = labels.join(" · ");
    }
  }

  private syncScroll(): void {
    this.renderGutter();
    this.highlightedCode.style.transform = `translate(${-this.editor.scrollLeft}px, ${-this.editor.scrollTop}px)`;
    this.gutter.style.transform = `translateY(${-this.editor.scrollTop}px)`;
    this.updateCursor();
  }

  private updateCursor(): void {
    const position = this.editor.selectionDirection === "backward"
      ? this.editor.selectionStart : this.editor.selectionEnd;
    const line = this.editor.value.slice(0, position).split("\n").length;
    const style = getComputedStyle(this.editor);
    const height = Number.parseFloat(style.lineHeight);
    const top = Number.parseFloat(style.paddingTop) + (line - 1) * height - this.editor.scrollTop;
    this.cursorLine.style.height = `${height}px`;
    this.cursorLine.style.transform = `translateY(${top}px)`;
    this.cursorLine.dataset.line = String(line);
    this.cursorLine.hidden = document.activeElement !== this.editor;
  }
}
