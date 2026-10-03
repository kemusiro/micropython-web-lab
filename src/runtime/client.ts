import {
  RUNTIME_PROTOCOL_VERSION,
  isWorkerToMainMessage,
  type MainToWorkerMessage,
  type RuntimeStatus,
  type WorkerToMainMessage,
} from "./protocol";
import type { SharedDeviceInputTransfer } from "../simulation/shared-device-inputs";
import { SharedDebuggerChannel } from "./debugger-channel";
import type { ScriptExecutionMode } from "./protocol";
import type { ConnectionGraphV1 } from "../connections/connection-model";

export const MAX_RUNTIME_EXECUTION_MS = 10_000;
export const MAX_RUNTIME_OUTPUT_CHARACTERS = 100_000;
export const UNEXPECTED_WORKER_RECOVERY_WINDOW_MS = 30_000;
export const MAX_UNEXPECTED_WORKER_AUTO_RECOVERIES = 1;

type RuntimeOperation = "repl" | "script";

export interface RuntimeClientHandlers {
  onMessage(message: WorkerToMainMessage): void;
  onStatus(status: RuntimeStatus): void;
}

export interface RuntimeWorker {
  postMessage(message: MainToWorkerMessage): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export type RuntimeWorkerFactory = () => RuntimeWorker;

export interface RuntimeClientOptions {
  deviceInputs?: SharedDeviceInputTransfer;
  debuggerChannel?: SharedDebuggerChannel;
  connectionGraph?: ConnectionGraphV1;
}

export class RuntimeClient {
  readonly #handlers: RuntimeClientHandlers;
  readonly #workerFactory: RuntimeWorkerFactory;
  readonly #deviceInputs: SharedDeviceInputTransfer | undefined;
  readonly #debuggerChannel: SharedDebuggerChannel | undefined;
  #connectionGraph: ConnectionGraphV1 | undefined;
  #worker: RuntimeWorker | null = null;
  #status: RuntimeStatus = "stopped";
  #activeExecutionId: string | null = null;
  #nextExecutionNumber = 1;
  #activeOperation: RuntimeOperation | null = null;
  #operationOutputCharacters = 0;
  #operationTimer: ReturnType<typeof setTimeout> | null = null;
  #operationElapsedMs = 0;
  #operationSegmentStartedAt: number | null = null;
  #replOutputTail = "";
  #unexpectedWorkerFailureTimes: number[] = [];

  constructor(
    handlers: RuntimeClientHandlers,
    workerFactory: RuntimeWorkerFactory = createRuntimeWorker,
    options: RuntimeClientOptions = {},
  ) {
    this.#handlers = handlers;
    this.#workerFactory = workerFactory;
    this.#deviceInputs = options.deviceInputs;
    this.#debuggerChannel = options.debuggerChannel;
    this.#connectionGraph = options.connectionGraph;
  }

  get status(): RuntimeStatus {
    return this.#status;
  }

  start(): void {
    this.#unexpectedWorkerFailureTimes = [];
    this.#startWorker();
  }

  #startWorker(): void {
    this.#discardWorker();
    this.#debuggerChannel?.reset();
    this.#setStatus("starting");

    const worker = this.#workerFactory();
    this.#worker = worker;

    worker.onmessage = (event) => {
      if (worker !== this.#worker) {
        return;
      }

      if (!isWorkerToMainMessage(event.data)) {
        this.#reportClientError("Workerから不正なメッセージを受信しました。");
        return;
      }

      if (
        (event.data.type === "stdout" || event.data.type === "stderr") &&
        !this.#acceptOutput(event.data.data)
      ) {
        return;
      }

      if (event.data.type === "ready") {
        this.#clearOperation();
        this.#setStatus("ready");
      } else if (event.data.type === "execution-result") {
        if (event.data.requestId !== this.#activeExecutionId) {
          this.#reportClientError("実行結果の識別子が現在のリクエストと一致しません。");
          return;
        }
        this.#clearOperation();
        this.#setStatus("ready");
      } else if (event.data.type === "debugger-paused") {
        if (
          event.data.requestId !== this.#activeExecutionId ||
          this.#activeOperation !== "script" ||
          this.#debuggerChannel === undefined
        ) {
          this.#reportClientError("デバッガ停止通知が現在の実行と一致しません。");
          return;
        }
        this.#pauseOperationTimer();
        this.#setStatus("debugging");
      } else if (event.data.type === "debugger-resumed") {
        if (
          event.data.requestId !== this.#activeExecutionId ||
          this.#status !== "debugging"
        ) {
          this.#reportClientError("デバッガ再開通知が現在の実行と一致しません。");
          return;
        }
        this.#resumeOperationTimer();
        this.#setStatus("executing");
      } else if (event.data.type === "error") {
        this.#clearOperation();
        this.#setStatus("error");
      }

      this.#handlers.onMessage(event.data);
    };

    worker.onerror = (event) => {
      if (worker !== this.#worker) {
        return;
      }
      this.#recoverFromUnexpectedWorkerFailure(
        event.message.trim(),
        "Workerで予期しないエラーが発生しました。",
      );
    };

    worker.onmessageerror = () => {
      if (worker !== this.#worker) {
        return;
      }
      this.#recoverFromUnexpectedWorkerFailure(
        "",
        "Workerからのメッセージを受信できませんでした。",
      );
    };

    worker.postMessage({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "start",
      ...(this.#deviceInputs === undefined
        ? {}
        : { deviceInputs: this.#deviceInputs }),
      ...(this.#debuggerChannel === undefined
        ? {}
        : { debuggerChannel: this.#debuggerChannel.toTransfer() }),
      ...(this.#connectionGraph === undefined
        ? {}
        : { connectionGraph: this.#connectionGraph }),
    });
  }

  restart(): void {
    this.start();
  }

  setConnectionGraph(connectionGraph: ConnectionGraphV1): void {
    this.#connectionGraph = connectionGraph;
  }

  stop(): void {
    this.#discardWorker();
    this.#setStatus("stopped");
  }

  sendInput(data: string): boolean {
    if (this.#worker === null || this.#status !== "ready") {
      return false;
    }

    this.#worker.postMessage({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "input",
      data,
    });
    if (data.includes("\r") || data.includes("\n")) {
      this.#beginOperation("repl");
    }
    return true;
  }

  executeScript(source: string, mode: ScriptExecutionMode = "run"): boolean {
    if (this.#worker === null || this.#status !== "ready") {
      return false;
    }

    const requestId = `execution-${this.#nextExecutionNumber}`;
    this.#nextExecutionNumber += 1;
    this.#beginOperation("script");
    this.#activeExecutionId = requestId;
    this.#setStatus("executing");
    this.#worker.postMessage({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "execute",
      requestId,
      source,
      mode,
    });
    return true;
  }

  sendDebuggerCommand(command: string): boolean {
    if (
      this.#worker === null ||
      this.#status !== "debugging" ||
      this.#debuggerChannel === undefined
    ) {
      return false;
    }
    if (/^(?:q|quit|exit)$/i.test(command.trim())) {
      this.start();
      return true;
    }
    return this.#debuggerChannel.sendCommand(command);
  }

  #discardWorker(): void {
    if (this.#worker === null) {
      return;
    }

    this.#worker.onmessage = null;
    this.#worker.onmessageerror = null;
    this.#worker.onerror = null;
    this.#worker.terminate();
    this.#worker = null;
    this.#clearOperation();
  }

  #beginOperation(operation: RuntimeOperation): void {
    this.#clearOperation();
    this.#activeOperation = operation;
    this.#operationElapsedMs = 0;
    this.#resumeOperationTimer();
  }

  #resumeOperationTimer(): void {
    const remaining = MAX_RUNTIME_EXECUTION_MS - this.#operationElapsedMs;
    if (remaining <= 0) {
      this.#recoverFromLimit(
        `実行時間が${MAX_RUNTIME_EXECUTION_MS / 1000}秒の上限を超えたため、Workerを再生成しました。`,
      );
      return;
    }
    this.#operationSegmentStartedAt = Date.now();
    this.#operationTimer = setTimeout(() => {
      this.#recoverFromLimit(
        `実行時間が${MAX_RUNTIME_EXECUTION_MS / 1000}秒の上限を超えたため、Workerを再生成しました。`,
      );
    }, remaining);
  }

  #pauseOperationTimer(): void {
    if (this.#operationSegmentStartedAt !== null) {
      this.#operationElapsedMs += Date.now() - this.#operationSegmentStartedAt;
      this.#operationSegmentStartedAt = null;
    }
    if (this.#operationTimer !== null) {
      clearTimeout(this.#operationTimer);
      this.#operationTimer = null;
    }
  }

  #acceptOutput(data: string): boolean {
    if (this.#activeOperation === null) {
      return true;
    }

    this.#operationOutputCharacters += data.length;
    if (this.#operationOutputCharacters > MAX_RUNTIME_OUTPUT_CHARACTERS) {
      this.#recoverFromLimit(
        `出力量が${MAX_RUNTIME_OUTPUT_CHARACTERS.toLocaleString("ja-JP")}文字の上限を超えたため、Workerを再生成しました。`,
      );
      return false;
    }

    if (this.#activeOperation === "repl" && this.#isWaitingForReplInput(data)) {
      this.#clearOperation();
    }
    return true;
  }

  #isWaitingForReplInput(data: string): boolean {
    this.#replOutputTail = (this.#replOutputTail + data).slice(-64);
    const currentLine = this.#replOutputTail.split(/\r\n|\r|\n/).at(-1);
    return currentLine === ">>> " || currentLine === "... ";
  }

  #recoverFromLimit(message: string): void {
    this.#handlers.onMessage({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "error",
      message,
    });
    this.start();
  }

  #recoverFromUnexpectedWorkerFailure(detail: string, fallback: string): void {
    const now = Date.now();
    this.#unexpectedWorkerFailureTimes = this.#unexpectedWorkerFailureTimes.filter(
      (failedAt) => now - failedAt < UNEXPECTED_WORKER_RECOVERY_WINDOW_MS,
    );
    const canRecover =
      this.#unexpectedWorkerFailureTimes.length < MAX_UNEXPECTED_WORKER_AUTO_RECOVERIES;
    this.#unexpectedWorkerFailureTimes.push(now);
    const cause = detail.length === 0 ? fallback : detail;

    this.#handlers.onMessage({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "error",
      message: canRecover
        ? `${cause} 新しいWorkerへ自動的に切り替えます。`
        : `${cause} 短時間に繰り返し失敗したため自動再生成を停止しました。「再起動」を押してください。`,
    });

    if (canRecover) {
      this.#startWorker();
      return;
    }

    this.#discardWorker();
    this.#setStatus("error");
  }

  #clearOperation(): void {
    if (this.#operationTimer !== null) {
      clearTimeout(this.#operationTimer);
      this.#operationTimer = null;
    }
    this.#activeExecutionId = null;
    this.#activeOperation = null;
    this.#operationOutputCharacters = 0;
    this.#operationElapsedMs = 0;
    this.#operationSegmentStartedAt = null;
    this.#replOutputTail = "";
  }

  #reportClientError(message: string): void {
    this.#clearOperation();
    this.#setStatus("error");
    this.#handlers.onMessage({
      version: RUNTIME_PROTOCOL_VERSION,
      type: "error",
      message,
    });
  }

  #setStatus(status: RuntimeStatus): void {
    this.#status = status;
    this.#handlers.onStatus(status);
  }
}

function createRuntimeWorker(): RuntimeWorker {
  return new Worker(new URL("./micropython.worker.ts", import.meta.url), {
    type: "module",
    name: "micropython-runtime",
  });
}
