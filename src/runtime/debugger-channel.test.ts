import { describe, expect, it } from "vitest";

import {
  MAX_DEBUGGER_COMMAND_BYTES,
  SharedDebuggerChannel,
} from "./debugger-channel";

describe("SharedDebuggerChannel", () => {
  it("passes one UTF-8 command from the main side to the worker side", () => {
    const main = SharedDebuggerChannel.create()!;
    const worker = SharedDebuggerChannel.attach(main.toTransfer());

    const command = worker.waitForCommand(() => {
      expect(main.sendCommand("p 温度")).toBe(true);
    });

    expect(command).toBe("p 温度");
    expect(main.sendCommand("continue")).toBe(false);
  });

  it("passes an empty command so pdb can repeat the previous command", () => {
    const main = SharedDebuggerChannel.create()!;
    const worker = SharedDebuggerChannel.attach(main.toTransfer());

    expect(
      worker.waitForCommand(() => {
        expect(main.sendCommand("")).toBe(true);
      }),
    ).toBe("");
  });

  it("rejects a command that exceeds the bounded shared buffer", () => {
    const main = SharedDebuggerChannel.create()!;
    const worker = SharedDebuggerChannel.attach(main.toTransfer());

    expect(() =>
      worker.waitForCommand(() => {
        main.sendCommand("x".repeat(MAX_DEBUGGER_COMMAND_BYTES + 1));
      }),
    ).toThrow(RangeError);
  });

  it("rejects an uninitialized shared buffer", () => {
    expect(() =>
      SharedDebuggerChannel.attach({
        buffer: new SharedArrayBuffer(
          Int32Array.BYTES_PER_ELEMENT * 4 + MAX_DEBUGGER_COMMAND_BYTES,
        ),
      }),
    ).toThrow(/format marker/);
  });
});
