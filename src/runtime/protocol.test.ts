import { describe, expect, it } from "vitest";

import { RUNTIME_PROTOCOL_VERSION, isWorkerToMainMessage, isMainToWorkerMessage } from "./protocol";

it("validates filesystem payloads in both directions and named execution paths", () => {
  const project = { version: 1, entries: [{ path: "helper.py", kind: "file", data: new Uint8Array([42]) }] };
  const message = { version: RUNTIME_PROTOCOL_VERSION, type: "filesystem", project, revision: 1, checkpoint: true };
  expect(isWorkerToMainMessage(message)).toBe(true);
  expect(isWorkerToMainMessage({ ...message, revision: 0 })).toBe(false);
  expect(isWorkerToMainMessage({ ...message, project: { ...project, entries: [{ ...project.entries[0], path: "../escape" }] } })).toBe(false);
  expect(isMainToWorkerMessage({ version: RUNTIME_PROTOCOL_VERSION, type: "project-sync", project })).toBe(true);
  expect(isMainToWorkerMessage({ version: RUNTIME_PROTOCOL_VERSION - 1, type: "project-sync", project })).toBe(false);
  expect(isMainToWorkerMessage({ version: RUNTIME_PROTOCOL_VERSION, type: "execute", requestId: "1", source: "pass", mode: "run", path: "/outside.py" })).toBe(false);
});

describe("isWorkerToMainMessage", () => {
  it("accepts sorted breakpoint snapshots and rejects malformed line numbers", () => {
    const snapshot = {
      version: RUNTIME_PROTOCOL_VERSION,
      type: "debugger-breakpoints",
      requestId: "execution-1",
    };
    for (const lines of [[], [1, 3, 50]]) {
      expect(isWorkerToMainMessage({ ...snapshot, lines })).toBe(true);
    }
    for (const lines of [undefined, [0], [-1], [1.5], ["2"], [NaN], [200_002], [1, 1], [2, 1]]) {
      expect(isWorkerToMainMessage({ ...snapshot, lines })).toBe(false);
    }
    expect(isWorkerToMainMessage({ ...snapshot, requestId: "", lines: [] })).toBe(false);
    expect(isWorkerToMainMessage({ ...snapshot, version: RUNTIME_PROTOCOL_VERSION - 1, lines: [] })).toBe(false);
  });
  it("accepts valid runtime messages", () => {
    for (const type of ["repl-reset", "repl-executing", "output-limit"]) {
      expect(isWorkerToMainMessage({ version: RUNTIME_PROTOCOL_VERSION, type, requestId: "input-1" })).toBe(true);
      expect(isWorkerToMainMessage({ version: RUNTIME_PROTOCOL_VERSION - 1, type })).toBe(false);
    }
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "ready",
        micropythonVersion: "MicroPython v1.28.0",
        runtimeBuild: {
          sourceVersion: "1.28.0",
          sourceCommit: "e0e9fbb17ed6fd06bb76e266ae554784c9c80804",
          variant: "web-lab-restricted",
        },
      }),
    ).toBe(true);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "debugger-paused",
        requestId: "execution-1",
        filename: "main.py",
        line: 4,
        functionName: "sample",
        globals: [{ name: "answer", typeName: "int", value: "42" }],
      }),
    ).toBe(true);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "debugger-resumed",
        requestId: "execution-1",
      }),
    ).toBe(true);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "device-state",
        state: {
          kind: "i2c-transaction",
          sequence: 1,
          busId: 0,
          operation: "read-memory",
          address: 0x50,
          memoryAddress: 0x10,
          byteCount: 3,
        },
      }),
    ).toBe(true);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "device-state",
        state: {
          kind: "adc-channel",
          sequence: 2,
          pinId: "26",
          value: 32_768,
        },
      }),
    ).toBe(true);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "device-state",
        state: {
          kind: "gpio-pin",
          sequence: 1,
          pinId: "LED",
          mode: "output",
          value: 1,
        },
      }),
    ).toBe(true);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "device-model-state",
        event: {
          instanceId: "built-in-led",
          sequence: 1,
          state: { value: 0, enabled: false },
        },
      }),
    ).toBe(true);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "stdout",
        data: ">>> ",
      }),
    ).toBe(true);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "execution-result",
        requestId: "execution-1",
        ok: true,
      }),
    ).toBe(true);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "execution-result",
        requestId: "execution-2",
        ok: false,
        error: "ValueError",
      }),
    ).toBe(true);
  });

  it("rejects unknown versions and malformed messages", () => {
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION + 1,
        type: "stdout",
        data: "hello",
      }),
    ).toBe(false);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "debugger-paused",
        requestId: "execution-1",
        filename: "main.py",
        line: 0,
        functionName: "sample",
        globals: [],
      }),
    ).toBe(false);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "debugger-paused",
        requestId: "execution-1",
        filename: "main.py",
        line: 1,
        functionName: "sample",
        globals: [{ name: "value", typeName: "int", value: "x".repeat(257) }],
      }),
    ).toBe(false);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "device-state",
        state: {
          kind: "i2c-transaction",
          sequence: 1,
          busId: 0,
          operation: "read-memory",
          address: 0x50,
          byteCount: 257,
        },
      }),
    ).toBe(false);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "device-state",
        state: {
          kind: "adc-channel",
          sequence: 1,
          pinId: "26",
          value: 65_536,
        },
      }),
    ).toBe(false);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "device-state",
        state: {
          kind: "gpio-pin",
          sequence: 0,
          pinId: "LED",
          mode: "output",
          value: 1,
        },
      }),
    ).toBe(false);
    expect(
      isWorkerToMainMessage({ version: RUNTIME_PROTOCOL_VERSION, type: "stdout" }),
    ).toBe(false);
    expect(
      isWorkerToMainMessage({ version: RUNTIME_PROTOCOL_VERSION, type: "unknown" }),
    ).toBe(false);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "device-model-state",
        event: {
          instanceId: "built-in-led",
          sequence: 0,
          state: { value: 0 },
        },
      }),
    ).toBe(false);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "device-model-state",
        event: {
          instanceId: "built-in-led",
          sequence: 1,
          state: { value: Number.NaN },
        },
      }),
    ).toBe(false);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "device-model-state",
        event: {
          instanceId: "built-in-led",
          sequence: 1,
          state: { nested: { value: 1 } },
        },
      }),
    ).toBe(false);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "ready",
        micropythonVersion: "MicroPython v1.28.0",
        runtimeBuild: {
          sourceVersion: "1.28.0",
          sourceCommit: "not-a-commit",
          variant: "web-lab-restricted",
        },
      }),
    ).toBe(false);
    expect(
      isWorkerToMainMessage({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "execution-result",
        requestId: "execution-3",
        ok: false,
      }),
    ).toBe(false);
    expect(isWorkerToMainMessage(null)).toBe(false);
  });
});

it("requires an explicit supported arm profile and rejects mixed board configurations", async () => {
  const { SharedArmChannel, CONTROL_VERSION } = await import("../control/channel");
  const { DEFAULT_ARM_CONTROL } = await import("../physics/arm-control");
  const channel = SharedArmChannel.create(1);
  const runtimeProfile = { kind: "arm", version: CONTROL_VERSION, identity: { setId: "set", generation: 1, runId: "run" }, conditions: DEFAULT_ARM_CONTROL, buffer: channel.buffer };
  const start = { type: "start", version: RUNTIME_PROTOCOL_VERSION, runtimeProfile };
  expect(isMainToWorkerMessage(start)).toBe(true);
  expect(isMainToWorkerMessage({ ...start, connectionGraph: {} })).toBe(false);
  expect(isMainToWorkerMessage({ ...start, deviceInputs: {} })).toBe(false);
  expect(isMainToWorkerMessage({ ...start, runtimeProfile: { ...runtimeProfile, kind: "unknown" } })).toBe(false);
  expect(isMainToWorkerMessage({ ...start, runtimeProfile: { ...runtimeProfile, version: 77 } })).toBe(false);
  expect(isMainToWorkerMessage({ ...start, version: 15 })).toBe(false);
});
