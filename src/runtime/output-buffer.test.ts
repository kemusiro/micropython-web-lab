import { describe, expect, it } from "vitest";
import { MAX_RUNTIME_OUTPUT_CHARACTERS, OUTPUT_CHUNK_CHARACTERS, RuntimeOutputBuffer } from "./output-buffer";

describe("RuntimeOutputBuffer", () => {
  it("coalesces byte-sized output, preserves streams and flushes prompts", () => {
    const chunks: [string, string][] = [];
    const buffer = new RuntimeOutputBuffer((...chunk) => chunks.push(chunk), () => {});
    for (const character of "hello\n日本語") buffer.write("stdout", character);
    expect(chunks).toEqual([["stdout", "hello\n"]]);
    buffer.write("stderr", "error\n");
    buffer.write("stdout", ">>> ");
    buffer.flush();
    expect(chunks).toEqual([["stdout", "hello\n"], ["stdout", "日本語"], ["stderr", "error\n"], ["stdout", ">>> "]]);
  });

  it("bounds unbroken output and drops a flood after one limit event", () => {
    const chunks: string[] = [];
    let limits = 0;
    const buffer = new RuntimeOutputBuffer((_stream, data) => chunks.push(data), () => { limits += 1; });
    for (let i = 0; i < MAX_RUNTIME_OUTPUT_CHARACTERS * 3; i += 1) buffer.write("stdout", "x");
    expect(chunks.join("")).toHaveLength(MAX_RUNTIME_OUTPUT_CHARACTERS);
    expect(chunks.length).toBe(Math.ceil(MAX_RUNTIME_OUTPUT_CHARACTERS / OUTPUT_CHUNK_CHARACTERS));
    expect(chunks.every((chunk) => chunk.length <= OUTPUT_CHUNK_CHARACTERS)).toBe(true);
    expect(limits).toBe(1);
    expect(buffer.exhausted).toBe(true);
    buffer.beginOperation();
    buffer.write("stderr", "new operation\n");
    expect(chunks.at(-1)).toBe("new operation\n");
    expect(buffer.exhausted).toBe(false);
  });

  it("shares one budget across stdout and stderr and preserves boundary ordering", () => {
    const events: string[] = [];
    const buffer = new RuntimeOutputBuffer((_stream, data) => events.push(data), () => events.push("LIMIT"));
    buffer.write("stdout", "x".repeat(MAX_RUNTIME_OUTPUT_CHARACTERS - 1));
    buffer.write("stderr", "yz");
    expect(events.at(-2)).toBe("y");
    expect(events.at(-1)).toBe("LIMIT");
    expect(events.slice(0, -1).join("")).toHaveLength(MAX_RUNTIME_OUTPUT_CHARACTERS);
  });
});
