const ESCAPE = "\x1b";

export class TerminalScreen {
  #lines = [""];
  #row = 0;
  #column = 0;
  #pendingEscape = "";

  get text(): string {
    return this.#lines.join("\n");
  }

  get cursorOffset(): number {
    let offset = this.#column;
    for (let row = 0; row < this.#row; row += 1) {
      offset += (this.#lines[row] ?? "").length + 1;
    }
    return offset;
  }

  clear(): void {
    this.#lines = [""];
    this.#row = 0;
    this.#column = 0;
    this.#pendingEscape = "";
  }

  replace(text: string): void {
    this.clear();
    this.write(text);
  }

  write(data: string): void {
    const input = this.#pendingEscape + data;
    this.#pendingEscape = "";

    for (let index = 0; index < input.length; index += 1) {
      const character = input.charAt(index);
      if (character === ESCAPE) {
        const sequenceEnd = findEscapeSequenceEnd(input, index);
        if (sequenceEnd === null) {
          this.#pendingEscape = input.slice(index);
          break;
        }
        if (input.charAt(index + 1) === "[") {
          this.#processCsi(input.slice(index + 2, sequenceEnd), input.charAt(sequenceEnd));
        }
        index = sequenceEnd;
        continue;
      }

      switch (character) {
        case "\r":
          this.#column = 0;
          break;
        case "\n":
          this.#row += 1;
          this.#column = 0;
          if (this.#row === this.#lines.length) {
            this.#lines.push("");
          }
          break;
        case "\b":
          this.#column = Math.max(0, this.#column - 1);
          break;
        case "\0":
          break;
        default:
          if (character >= " ") {
            this.#writeCharacter(character);
          }
      }
    }
  }

  #writeCharacter(character: string): void {
    const line = this.#lines[this.#row] ?? "";
    const padding = " ".repeat(Math.max(0, this.#column - line.length));
    const paddedLine = line + padding;
    this.#lines[this.#row] =
      paddedLine.slice(0, this.#column) + character + paddedLine.slice(this.#column + 1);
    this.#column += character.length;
  }

  #processCsi(parameters: string, command: string): void {
    const amount = parseAmount(parameters);
    switch (command) {
      case "C":
        this.#column = Math.min((this.#lines[this.#row] ?? "").length, this.#column + amount);
        break;
      case "D":
        this.#column = Math.max(0, this.#column - amount);
        break;
      case "G":
        this.#column = Math.min((this.#lines[this.#row] ?? "").length, Math.max(0, amount - 1));
        break;
      case "K":
        this.#eraseLine(parameters);
        break;
    }
  }

  #eraseLine(parameters: string): void {
    const mode = parameters === "" ? 0 : Number.parseInt(parameters, 10);
    const line = this.#lines[this.#row] ?? "";
    if (mode === 1) {
      this.#lines[this.#row] = " ".repeat(Math.min(this.#column, line.length)) + line.slice(this.#column);
    } else if (mode === 2) {
      this.#lines[this.#row] = "";
      this.#column = 0;
    } else {
      this.#lines[this.#row] = line.slice(0, this.#column);
    }
  }
}

function findEscapeSequenceEnd(input: string, start: number): number | null {
  if (start + 1 >= input.length) {
    return null;
  }
  if (input.charAt(start + 1) !== "[") {
    return start + 1;
  }
  for (let index = start + 2; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index;
    }
  }
  return null;
}

function parseAmount(parameters: string): number {
  const parsed = Number.parseInt(parameters, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
