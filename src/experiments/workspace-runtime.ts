import { RuntimeClient, type RuntimeClientHandlers, type RuntimeClientOptions, type RuntimeWorkerFactory } from "../runtime/client";
import { RUNTIME_PROTOCOL_VERSION, MAX_SCRIPT_CHARACTERS, type RuntimeStatus, type ScriptExecutionMode } from "../runtime/protocol";
import { ArmRuntimeSession, type ArmRunResult, type ArmSessionOptions } from "../control/session";
import type { ArmTelemetry } from "../control/channel";
import { snapshotArmControlConditions, type ArmControlConditions } from "../physics/arm-control";
import { ProjectFiles, type ProjectSnapshot } from "../project/filesystem";
import type { ConnectionGraphV1 } from "../connections/connection-model";
import type { ExperimentSession } from "./coordinator";

interface ArmExecution { start(): Promise<void>; execute(source: string): Promise<ArmRunResult>; stop(): void }
interface Handlers extends RuntimeClientHandlers {
  onArmFrame(frame: ArmTelemetry, lagMs: number): void;
  onArmResult(result: ArmRunResult): void;
}
/** Host routing only. The ordinary board client keeps its existing behavior.
 * Models allocate a fresh pair at Run, after file edits; opening a set never runs code. */
export class WorkspaceRuntime {
  readonly #board: RuntimeClient;
  #model: { session: ExperimentSession; conditions: ArmControlConditions } | undefined;
  #status: RuntimeStatus = "stopped";
  #project: ProjectSnapshot = { version: 1, entries: [] };
  #epoch = 0;
  #arm: ArmExecution | undefined;
  #job: Promise<void> = Promise.resolve();
  #stopped = false;
  constructor(readonly handlers: Handlers, boardOptions: RuntimeClientOptions = {}, boardFactory?: RuntimeWorkerFactory,
    readonly armFactory: (options: ArmSessionOptions) => ArmExecution = options => new ArmRuntimeSession(options)) {
    this.#board = new RuntimeClient({ ...handlers,
      onMessage: message => { if (!this.#model) handlers.onMessage(message); },
      onStatus: status => { if (!this.#model) handlers.onStatus(status); },
    }, boardFactory, boardOptions);
  }
  get status(): RuntimeStatus { return this.#model ? this.#status : this.#board.status; }
  get isModel(): boolean { return this.#model !== undefined; }
  configureModel(model: { session: ExperimentSession; conditions: ArmControlConditions } | null): void {
    this.#epoch++;
    this.#arm?.stop(); this.#arm = undefined;
    // Stop board callbacks before installing a model; no board Worker is kept in parallel.
    this.#board.stop();
    this.#model = model ? { session: { ...model.session }, conditions: snapshotArmControlConditions(model.conditions) } : undefined;
    this.#status = "stopped";
  }
  setConditions(conditions: ArmControlConditions): void {
    if (!this.#model || this.#arm) throw new Error("Arm conditions are locked during execution");
    this.#model.conditions = snapshotArmControlConditions(conditions);
  }
  setProject(project: ProjectSnapshot): void {
    this.#project = new ProjectFiles(project).snapshot();
    if (!this.#model) this.#board.setProject(project);
  }
  setConnectionGraph(graph: ConnectionGraphV1): void {
    if (this.#model) throw new Error("A model has no board wiring");
    this.#board.setConnectionGraph(graph);
  }
  start(): void {
    if (!this.#model) { this.#board.start(); return; }
    if (this.#arm) throw new Error("Stop the current arm run first");
    this.#stopped = false;
    if (typeof SharedArrayBuffer === "undefined" || !globalThis.crossOriginIsolated) {
      this.setStatus("error");
      this.handlers.onMessage({ version: RUNTIME_PROTOCOL_VERSION, type: "error", message: "Arm execution requires cross-origin isolation and SharedArrayBuffer." });
    } else this.setStatus("ready");
  }
  stop(): void {
    if (!this.#model) { this.#board.stop(); return; }
    this.#stopped = true; this.#arm?.stop(); this.setStatus("stopped");
  }
  async settled(): Promise<void> { await this.#job; }
  restart(): void {
    if (!this.#model) { this.#board.restart(); return; }
    this.stop(); const epoch = this.#epoch;
    void this.settled().then(() => { if (epoch === this.#epoch) this.start(); });
  }
  sendInput(data: string): boolean { return this.#model ? false : this.#board.sendInput(data); }
  sendDebuggerCommand(command: string): boolean { return this.#model ? false : this.#board.sendDebuggerCommand(command); }
  executeScript(source: string, mode: ScriptExecutionMode = "run", path?: string): boolean {
    if (!this.#model) return this.#board.executeScript(source, mode, path);
    if (this.#status !== "ready" || this.#arm || mode !== "run" || source.length > MAX_SCRIPT_CHARACTERS) return false;
    const epoch = ++this.#epoch, model = this.#model;
    this.#stopped = false;
    const current = () => epoch === this.#epoch;
    let revision = 0;
    const arm = this.armFactory({ setId: model.session.setId, generation: model.session.generation,
      conditions: model.conditions, project: this.#project,
      onStatus: status => { if (current() && (status === "starting" || status === "executing")) this.setStatus(status); },
      onOutput: (type, data) => { if (current()) this.handlers.onMessage({ version: RUNTIME_PROTOCOL_VERSION, type, data }); },
      onFrame: (frame, lag) => { if (current()) this.handlers.onArmFrame(frame, lag); },
      onProject: project => {
        if (!current()) return;
        this.#project = new ProjectFiles(project).snapshot();
        this.handlers.onMessage({ version: RUNTIME_PROTOCOL_VERSION, type: "filesystem", project, revision: ++revision, checkpoint: false });
      },
      onCheckpoint: () => current() ? this.handlers.onCheckpoint?.() ?? Promise.resolve() : Promise.resolve(),
    });
    this.#arm = arm;
    this.setStatus("starting");
    this.#job = (async () => {
      try {
        await arm.start();
        if (!current() || this.#stopped) return;
        const result = await arm.execute(source);
        if (!current()) return;
        this.handlers.onArmResult(result);
        this.setStatus(this.#stopped || result.status === "stopped" ? "stopped" : result.status === "failed" ? "error" : "ready");
      } catch (error) {
        if (!current() || this.#stopped) return;
        this.handlers.onMessage({ version: RUNTIME_PROTOCOL_VERSION, type: "error", message: error instanceof Error ? error.message : "Arm runtime failed" });
        this.setStatus("error");
      } finally {
        arm.stop();
        if (current() && this.#arm === arm) this.#arm = undefined;
      }
    })();
    return true;
  }
  private setStatus(status: RuntimeStatus): void { this.#status = status; this.handlers.onStatus(status); }
}
