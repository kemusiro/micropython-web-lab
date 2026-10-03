import { describe, expect, it } from "vitest";

import { loadMicroPython } from "../vendor/micropython-build/micropython.mjs";
import { WEB_LAB_PDB_SOURCE } from "./pdb-module";

describe("Web Lab pdb module", () => {
  it("stops at the first line and accepts next and continue", async () => {
    const decoder = new TextDecoder();
    const output: string[] = [];
    const pauses: Array<{
      filename: string;
      line: number;
      functionName: string;
      globals: unknown;
    }> = [];
    const commands = ["next", "continue"];
    const runtime = await loadMicroPython({
      url: new URL("../vendor/micropython-build/micropython.wasm", import.meta.url).href,
      linebuffer: false,
      stdout: (data) => output.push(decoder.decode(data, { stream: true })),
    });
    runtime.registerJsModule("_web_lab_debugger", {
      read_command(
        filename: unknown,
        line: unknown,
        functionName: unknown,
        globalsJson: unknown,
        announcePause: unknown,
      ) {
        if (announcePause) {
          pauses.push({
            filename: String(filename),
            line: Number(line),
            functionName: String(functionName),
            globals: JSON.parse(String(globalsJson)),
          });
        }
        return commands.shift() ?? "continue";
      },
      resumed() {},
    });
    runtime.runPython(WEB_LAB_PDB_SOURCE);

    const pdb = runtime.pyimport<{ _run(source: string): unknown }>("pdb");
    pdb._run("value = 1\nvalue += 1\nprint(value)");

    expect(pauses).toEqual([
      { filename: "main.py", line: 1, functionName: "<module>", globals: [] },
      {
        filename: "main.py",
        line: 2,
        functionName: "<module>",
        globals: [{ name: "value", typeName: "int", value: "1" }],
      },
    ]);
    expect(output.join("")).toContain("-> 1\tvalue = 1");
    expect(output.join("")).toContain("2\n");

    runtime.runPython("print('normal run')");
    expect(pauses).toHaveLength(2);
    expect(output.join("")).toContain("normal run\n");
  });
});
