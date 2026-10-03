import { describe, expect, it, vi } from "vitest";

import {
  MAX_RUNTIME_EXECUTION_MS,
  MAX_RUNTIME_OUTPUT_CHARACTERS,
  UNEXPECTED_WORKER_RECOVERY_WINDOW_MS,
  RuntimeClient,
  type RuntimeWorker,
} from "./client";
import { RUNTIME_PROTOCOL_VERSION, type MainToWorkerMessage } from "./protocol";
import {
  SharedDeviceInputs,
  WEB_LAB_DEVICE_INPUT_LAYOUT,
} from "../simulation/shared-device-inputs";
import { SharedDebuggerChannel } from "./debugger-channel";
import { MANAGED_CONNECTION_GRAPH } from "../connections/managed-connection-graph";

const readyMessage = {
  version: RUNTIME_PROTOCOL_VERSION,
  type: "ready",
  micropythonVersion: "MicroPython v1.28.0",
  runtimeBuild: {
    sourceVersion: "1.28.0",
    sourceCommit: "e0e9fbb17ed6fd06bb76e266ae554784c9c80804",
    variant: "web-lab-restricted",
  },
} as const;

class FakeWorker implements RuntimeWorker {
  readonly postMessage = vi.fn<(message: MainToWorkerMessage) => void>();
  readonly terminate = vi.fn<() => void>();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }

  emitError(message = ""): void {
    this.onerror?.({ message } as ErrorEvent);
  }

  emitMessageError(): void {
    this.onmessageerror?.({ data: null } as MessageEvent<unknown>);
  }
}

describe("RuntimeClient", () => {
  it("starts the worker and forwards input only after ready", () => {
    const worker = new FakeWorker();
    const statuses: string[] = [];
    const client = new RuntimeClient(
      { onMessage: vi.fn(), onStatus: (status) => statuses.push(status) },
      () => worker,
    );

    client.start();
    expect(worker.postMessage).toHaveBeenCalledWith({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "start",
    });
    expect(client.sendInput("1 + 2\n")).toBe(false);

    worker.emit(readyMessage);

    expect(client.sendInput("1 + 2\n")).toBe(true);
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "input",
      data: "1 + 2\n",
    });
    expect(statuses).toEqual(["starting", "ready"]);
  });

  it("shares the configured virtual input state when starting a worker", () => {
    const worker = new FakeWorker();
    const deviceInputs = SharedDeviceInputs.create(WEB_LAB_DEVICE_INPUT_LAYOUT)!.toTransfer();
    const client = new RuntimeClient(
      { onMessage: vi.fn(), onStatus: vi.fn() },
      () => worker,
      { deviceInputs },
    );

    client.start();

    expect(worker.postMessage).toHaveBeenCalledWith({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "start",
      deviceInputs,
    });
  });

  it("restarts with an updated browser connection graph", () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const client = new RuntimeClient(
      { onMessage: vi.fn(), onStatus: vi.fn() },
      () => workers.shift()!,
    );

    client.start();
    client.setConnectionGraph(MANAGED_CONNECTION_GRAPH);
    client.restart();

    expect(secondWorker.postMessage).toHaveBeenCalledWith({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "start",
      connectionGraph: MANAGED_CONNECTION_GRAPH,
    });
  });

  it("terminates an unresponsive worker before restarting", () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const client = new RuntimeClient(
      { onMessage: vi.fn(), onStatus: vi.fn() },
      () => {
        const worker = workers.shift();
        if (worker === undefined) {
          throw new Error("Unexpected worker creation");
        }
        return worker;
      },
    );

    client.start();
    client.restart();

    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    expect(secondWorker.postMessage).toHaveBeenCalledWith({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "start",
    });
  });

  it("automatically replaces a worker after its first unexpected error", () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const onMessage = vi.fn();
    const statuses: string[] = [];
    const client = new RuntimeClient(
      { onMessage, onStatus: (status) => statuses.push(status) },
      () => workers.shift()!,
    );

    client.start();
    firstWorker.emit(readyMessage);
    firstWorker.emitError("");

    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    expect(secondWorker.postMessage).toHaveBeenCalledWith({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "start",
    });
    expect(onMessage).toHaveBeenCalledWith({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "error",
      message:
        "Workerで予期しないエラーが発生しました。 新しいWorkerへ自動的に切り替えます。",
    });
    expect(client.status).toBe("starting");
    expect(statuses).toEqual(["starting", "ready", "starting"]);
  });

  it("also recovers when a worker message cannot be deserialized", () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const onMessage = vi.fn();
    const client = new RuntimeClient(
      { onMessage, onStatus: vi.fn() },
      () => workers.shift()!,
    );

    client.start();
    firstWorker.emit(readyMessage);
    firstWorker.emitMessageError();

    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    expect(secondWorker.postMessage).toHaveBeenCalledWith({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "start",
    });
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("メッセージを受信できませんでした"),
      }),
    );
  });

  it("stops automatic recovery when unexpected worker failures repeat", () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const onMessage = vi.fn();
    const client = new RuntimeClient(
      { onMessage, onStatus: vi.fn() },
      () => workers.shift()!,
    );

    client.start();
    firstWorker.emitError("first failure");
    secondWorker.emitError("second failure");

    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    expect(secondWorker.terminate).toHaveBeenCalledOnce();
    expect(client.status).toBe("error");
    expect(onMessage).toHaveBeenLastCalledWith({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "error",
      message:
        "second failure 短時間に繰り返し失敗したため自動再生成を停止しました。「再起動」を押してください。",
    });
  });

  it("allows another automatic recovery after the failure window", () => {
    vi.useFakeTimers();
    try {
      const firstWorker = new FakeWorker();
      const secondWorker = new FakeWorker();
      const thirdWorker = new FakeWorker();
      const workers = [firstWorker, secondWorker, thirdWorker];
      const client = new RuntimeClient(
        { onMessage: vi.fn(), onStatus: vi.fn() },
        () => workers.shift()!,
      );

      client.start();
      firstWorker.emitError("first failure");
      vi.advanceTimersByTime(UNEXPECTED_WORKER_RECOVERY_WINDOW_MS);
      secondWorker.emitError("later failure");

      expect(secondWorker.terminate).toHaveBeenCalledOnce();
      expect(thirdWorker.postMessage).toHaveBeenCalledWith({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "start",
      });
      expect(client.status).toBe("starting");
    } finally {
      vi.useRealTimers();
    }
  });

  it("executes one script at a time and returns to ready after its result", () => {
    const worker = new FakeWorker();
    const statuses: string[] = [];
    const client = new RuntimeClient(
      { onMessage: vi.fn(), onStatus: (status) => statuses.push(status) },
      () => worker,
    );

    client.start();
    worker.emit(readyMessage);

    expect(client.executeScript('print("hello")')).toBe(true);
    expect(client.status).toBe("executing");
    expect(client.executeScript('print("second")')).toBe(false);
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "execute",
      requestId: "execution-1",
      source: 'print("hello")',
      mode: "run",
    });

    worker.emit({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "execution-result",
      requestId: "execution-1",
      ok: true,
    });

    expect(client.status).toBe("ready");
    expect(statuses).toEqual(["starting", "ready", "executing", "ready"]);
  });

  it("rejects a result that does not match the active script", () => {
    const worker = new FakeWorker();
    const onMessage = vi.fn();
    const client = new RuntimeClient(
      { onMessage, onStatus: vi.fn() },
      () => worker,
    );

    client.start();
    worker.emit(readyMessage);
    client.executeScript("pass");
    worker.emit({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "execution-result",
      requestId: "unexpected",
      ok: true,
    });

    expect(client.status).toBe("error");
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });

  it("pauses the execution timer while waiting for a debugger command", () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const statuses: string[] = [];
      const debuggerChannel = SharedDebuggerChannel.create()!;
      const client = new RuntimeClient(
        { onMessage: vi.fn(), onStatus: (status) => statuses.push(status) },
        () => worker,
        { debuggerChannel },
      );

      client.start();
      worker.emit(readyMessage);
      client.executeScript("value = 1", "debug");
      vi.advanceTimersByTime(4_000);
      worker.emit({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "debugger-paused",
        requestId: "execution-1",
        filename: "main.py",
        line: 1,
        functionName: "<module>",
        globals: [],
      });

      vi.advanceTimersByTime(MAX_RUNTIME_EXECUTION_MS);
      expect(worker.terminate).not.toHaveBeenCalled();
      expect(client.status).toBe("debugging");

      const workerSide = SharedDebuggerChannel.attach(debuggerChannel.toTransfer());
      expect(
        workerSide.waitForCommand(() => {
          expect(client.sendDebuggerCommand("continue")).toBe(true);
        }),
      ).toBe("continue");
      worker.emit({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "debugger-resumed",
        requestId: "execution-1",
      });
      vi.advanceTimersByTime(5_999);
      expect(worker.terminate).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(statuses).toContain("debugging");
    } finally {
      vi.useRealTimers();
    }
  });

  it("quits a paused debugger by replacing the worker", () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const debuggerChannel = SharedDebuggerChannel.create()!;
    const client = new RuntimeClient(
      { onMessage: vi.fn(), onStatus: vi.fn() },
      () => workers.shift()!,
      { debuggerChannel },
    );

    client.start();
    firstWorker.emit(readyMessage);
    client.executeScript("pass", "debug");
    firstWorker.emit({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "debugger-paused",
      requestId: "execution-1",
      filename: "main.py",
      line: 1,
      functionName: "<module>",
      globals: [],
    });

    expect(client.sendDebuggerCommand("quit")).toBe(true);
    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    expect(secondWorker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "start", debuggerChannel: debuggerChannel.toTransfer() }),
    );
  });

  it("rejects malformed worker messages", () => {
    const worker = new FakeWorker();
    const onMessage = vi.fn();
    const client = new RuntimeClient(
      { onMessage, onStatus: vi.fn() },
      () => worker,
    );

    client.start();
    worker.emit({ version: 99, type: "ready" });

    expect(client.status).toBe("error");
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });

  it("replaces a worker when script execution exceeds the time limit", () => {
    vi.useFakeTimers();
    try {
      const firstWorker = new FakeWorker();
      const secondWorker = new FakeWorker();
      const workers = [firstWorker, secondWorker];
      const onMessage = vi.fn();
      const client = new RuntimeClient(
        { onMessage, onStatus: vi.fn() },
        () => {
          const worker = workers.shift();
          if (worker === undefined) {
            throw new Error("Unexpected worker creation");
          }
          return worker;
        },
      );

      client.start();
      firstWorker.emit(readyMessage);
      client.executeScript("while True: pass");
      vi.advanceTimersByTime(MAX_RUNTIME_EXECUTION_MS);

      expect(firstWorker.terminate).toHaveBeenCalledOnce();
      expect(secondWorker.postMessage).toHaveBeenCalledWith({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "start",
      });
      expect(onMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", message: expect.stringContaining("10秒") }),
      );
      expect(client.status).toBe("starting");
    } finally {
      vi.useRealTimers();
    }
  });

  it("replaces a worker when one operation exceeds the output limit", () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const onMessage = vi.fn();
    const client = new RuntimeClient(
      { onMessage, onStatus: vi.fn() },
      () => {
        const worker = workers.shift();
        if (worker === undefined) {
          throw new Error("Unexpected worker creation");
        }
        return worker;
      },
    );

    client.start();
    firstWorker.emit(readyMessage);
    client.executeScript('print("x")');
    firstWorker.emit({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "stdout",
      data: "x".repeat(MAX_RUNTIME_OUTPUT_CHARACTERS + 1),
    });

    expect(firstWorker.terminate).toHaveBeenCalledOnce();
    expect(secondWorker.postMessage).toHaveBeenCalledWith({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "start",
    });
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", message: expect.stringContaining("出力量") }),
    );
    expect(onMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "stdout" }));
  });

  it("does not time out while the REPL is waiting at a continuation prompt", () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const client = new RuntimeClient(
        { onMessage: vi.fn(), onStatus: vi.fn() },
        () => worker,
      );

      client.start();
      worker.emit(readyMessage);
      client.sendInput("def answer():\r");
      worker.emit({
        version: RUNTIME_PROTOCOL_VERSION,
        type: "stdout",
        data: "... ",
      });
      vi.advanceTimersByTime(MAX_RUNTIME_EXECUTION_MS);

      expect(worker.terminate).not.toHaveBeenCalled();
      expect(client.status).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });
});
