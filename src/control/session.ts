import { RuntimeClient, type RuntimeWorkerFactory } from "../runtime/client";
import { RUNTIME_PROTOCOL_VERSION, MAX_SCRIPT_CHARACTERS, type WorkerToMainMessage } from "../runtime/protocol";
import { ProjectFiles, type ProjectSnapshot } from "../project/filesystem";
import { ARM_MODEL, ARM_CONTROL_PERIOD_US } from "../physics/one-axis-arm";
import { snapshotArmControlConditions, type ArmControlConditions } from "../physics/arm-control";
import { MANAGED_EXPERIMENT_RUNTIME } from "../runtime/build-reference";
import { CONTROL_START_TIMEOUT_MS, CONTROL_VERSION, SharedArmChannel, snapshotIdentity, sameIdentity, validateTelemetry, parseSimulationNotice, CONTROL_HEADER,
  type ControlIdentity, type ArmRuntimeProfile, type ArmTelemetry } from "./channel";

export interface SimulationWorker {
  postMessage(profile: ArmRuntimeProfile): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}
export type ArmSessionStatus = "stopped" | "starting" | "ready" | "executing" | "completed" | "failed";
export interface ArmRunMetadata {
  readonly identity: ControlIdentity; readonly sourceHash: string; readonly projectHash: string;
  readonly runtimeProtocol: number; readonly controlProtocol: number; readonly controlPeriodUs: number; readonly integrationStepUs: number;
  readonly conditions: ArmControlConditions; readonly model: typeof ARM_MODEL; readonly runtime: typeof MANAGED_EXPERIMENT_RUNTIME;
}
export interface ArmRunResult {
  readonly status: "completed" | "stopped" | "failed"; readonly reason?: string;
  readonly project: ProjectSnapshot;
  readonly metadata: ArmRunMetadata; readonly telemetry: ArmTelemetry | null;
}
export interface ArmSessionOptions {
  setId: string; generation: number; conditions: ArmControlConditions; project?: ProjectSnapshot;
  onStatus?(status: ArmSessionStatus): void;
  onOutput?(type: "stdout" | "stderr", text: string): void;
  onProject?(project: ProjectSnapshot): void;
  onFrame?(frame: ArmTelemetry, lagMs: number): void;
  runtimeFactory?: RuntimeWorkerFactory;
  simulationFactory?: () => SimulationWorker;
}
async function hash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), value => value.toString(16).padStart(2, "0")).join("");
}
function copiedFrame(frame: ArmTelemetry): ArmTelemetry { return { ...frame, identity: { ...frame.identity }, model: { ...frame.model }, rows: frame.rows.slice() }; }

/** One host-owned run. Restart means constructing a fresh pair and fresh shared memory.
 * Board/REPL operation remains with the existing RuntimeClient. This never creates a Pico fallback. */
export class ArmRuntimeSession {
  readonly #identity: ControlIdentity;
  readonly #conditions: ArmControlConditions;
  readonly #project: ProjectSnapshot;
  #latestProject: ProjectSnapshot;
  #channel: SharedArmChannel | undefined;
  #runtime: RuntimeClient | undefined;
  #simulation: SimulationWorker | undefined;
  #closed = false;
  #status: ArmSessionStatus = "stopped";
  #sequence = 0;
  #simulationSequence = 0;
  #lastFrame: ArmTelemetry | null = null;
  #metadata: ArmRunMetadata | undefined;
  #resolve: ((result: ArmRunResult) => void) | undefined;
  #rejectStart: ((error: Error) => void) | undefined;
  #startupTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #visibility = () => { if (document.hidden) this.stop("Arm execution stopped while the page was hidden"); };
  constructor(readonly options: ArmSessionOptions) {
    this.#identity = snapshotIdentity({ setId: options.setId, generation: options.generation, runId: crypto.randomUUID() });
    this.#conditions = snapshotArmControlConditions(options.conditions);
    this.#project = new ProjectFiles(options.project ?? { version: 1, entries: [] }).snapshot();
    this.#latestProject = new ProjectFiles(this.#project).snapshot();
  }
  get identity(): ControlIdentity { return { ...this.#identity }; }
  get status(): ArmSessionStatus { return this.#status; }
  async start(): Promise<void> {
    if (this.#closed || this.#status !== "stopped") throw new Error("Create a fresh arm session to restart");
    if (typeof SharedArrayBuffer === "undefined" || !globalThis.crossOriginIsolated) { this.#closed = true; this.setStatus("failed"); throw new Error("Arm control requires cross-origin isolation and SharedArrayBuffer"); }
    if (typeof document !== "undefined" && document.hidden) { this.#closed = true; this.setStatus("failed"); throw new Error("Arm execution requires a visible page"); }
    this.#channel = SharedArmChannel.create(this.#identity.generation);
    const profile: ArmRuntimeProfile = { kind: "arm", version: CONTROL_VERSION, identity: this.identity,
      conditions: { ...this.#conditions }, buffer: this.#channel.buffer };
    this.setStatus("starting");
    if (this.#closed) throw new Error("Arm startup cancelled");
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.#visibility);
    return new Promise<void>((resolve, reject) => {
      this.#rejectStart = reject;
      let runtimeReady = false, simulationReady = false;
      const ready = () => {
        if (this.#closed || !runtimeReady || !simulationReady) return;
        clearTimeout(this.#startupTimer); this.#rejectStart = undefined;
        this.setStatus("ready"); if (this.#closed) reject(new Error("Arm startup cancelled")); else resolve();
      };
      this.#startupTimer = setTimeout(() => this.finish("failed", "Arm Worker startup timed out"), CONTROL_START_TIMEOUT_MS);
      try {
        const simulation: SimulationWorker = this.options.simulationFactory?.() ?? new Worker(new URL("./simulation.worker.ts", import.meta.url), { type: "module", name: "arm-simulation" });
        this.#simulation = simulation;
        simulation.onmessage = event => {
          if (this.#closed || this.#simulation !== simulation) return;
          try {
            const message = parseSimulationNotice(event.data);
            if (message.type === "error") throw new Error(typeof message.message === "string" ? message.message.slice(0, 500) : "Simulation failed");
            const identity = snapshotIdentity(message.identity);
            if (!sameIdentity(identity, this.#identity)) return;
            if (message.model?.id !== ARM_MODEL.id || message.model.version !== ARM_MODEL.version || message.model.integrator !== ARM_MODEL.integrator || message.model.integratorVersion !== ARM_MODEL.integratorVersion) throw new Error("Simulation model version mismatch");
            if (message.type === "ready") {
              if (simulationReady) throw new Error("Duplicate Simulation Worker readiness");
              this.#channel!.readRows(0, 0); simulationReady = true; ready();
            } else if (message.type === "progress") {
              if (!simulationReady || this.#status !== "executing" || (this.#lastFrame !== null && message.tick <= this.#lastFrame.lastTick) || !Number.isSafeInteger(message.sequence) || message.sequence <= this.#simulationSequence ||
                  !Number.isInteger(message.tick) || message.tick < 0 || message.tick > this.#conditions.durationMs / 10 ||
                  !Number.isFinite(message.lagMs) || message.lagMs < 0) throw new Error("Invalid simulation progress");
              this.#simulationSequence = message.sequence;
              const frame = this.frame(Math.max(0, message.tick - 127), message.tick);
              this.#lastFrame = copiedFrame(frame);
              this.options.onFrame?.(copiedFrame(frame), message.lagMs);
            } else throw new Error("Unknown Simulation Worker message");
          } catch (error) { this.finish("failed", error instanceof Error ? error.message : "Simulation failed"); }
        };
        simulation.onerror = () => this.finish("failed", "Simulation Worker failed");
        simulation.onmessageerror = () => this.finish("failed", "Simulation Worker message could not be decoded");
        this.#runtime = new RuntimeClient({ onStatus: status => { if (!this.#closed && status === "ready" && this.#status === "starting") { runtimeReady = true; ready(); } },
          onMessage: message => this.message(message) }, this.options.runtimeFactory, { runtimeProfile: profile, project: this.#project });
        simulation.postMessage(profile);
        if (!this.#closed) this.#runtime.start();
      } catch (error) { this.finish("failed", error instanceof Error ? error.message : "Arm startup failed"); }
    });
  }
  async execute(source: string): Promise<ArmRunResult> {
    if (this.#closed || this.#status !== "ready" || this.#metadata) throw new Error("Arm runtime is not ready for a new execution");
    if (typeof source !== "string" || source.length > MAX_SCRIPT_CHARACTERS) throw new Error("Invalid arm source length");
    // Lock before hashing so a second execute cannot start while hashes are pending.
    this.setStatus("executing");
    try {
      const entries = [];
      for (const entry of [...this.#project.entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
        entries.push({ path: entry.path, kind: entry.kind, hash: entry.kind === "file" ? await hash(entry.data) : null });
      }
      const [sourceHash, projectHash] = await Promise.all([hash(new TextEncoder().encode(source)), hash(new TextEncoder().encode(JSON.stringify(entries)))]);
      if (this.#closed) throw new Error("Arm execution cancelled before starting");
      this.#metadata = { identity: this.identity, sourceHash, projectHash, runtimeProtocol: RUNTIME_PROTOCOL_VERSION, controlProtocol: CONTROL_VERSION, controlPeriodUs: ARM_CONTROL_PERIOD_US, integrationStepUs: 1000, conditions: { ...this.#conditions }, model: { ...ARM_MODEL }, runtime: { ...MANAGED_EXPERIMENT_RUNTIME } };
      return await new Promise<ArmRunResult>(resolve => {
        this.#resolve = resolve;
        if (!this.#runtime!.executeScript(source)) this.finish("failed", "MicroPython refused arm execution");
      });
    } catch (error) { this.finish("failed", error instanceof Error ? error.message : "Arm execution failed"); throw error; }
  }
  stop(reason = "Arm execution stopped"): void { this.finish("stopped", reason); }
  private message(message: WorkerToMainMessage): void {
    if (this.#closed) return;
    if (message.type === "filesystem") {
      this.#latestProject = new ProjectFiles(message.project).snapshot();
      this.options.onProject?.(new ProjectFiles(this.#latestProject).snapshot());
    } else if (message.type === "stdout" || message.type === "stderr") this.options.onOutput?.(message.type, message.data);
    else if (message.type === "error") this.finish("failed", message.message);
    else if (message.type === "execution-result") {
      const complete = this.#channel?.tick === this.#conditions.durationMs / 10;
      const fault = this.#channel && Atomics.load(this.#channel.controls, CONTROL_HEADER.fault);
      this.finish(message.ok && !fault ? complete ? "completed" : "stopped" : "failed", message.error ?? (fault ? "Arm simulation failed" : complete ? undefined : "Python finished before the planned arm duration"));
    }
  }
  private frame(firstTick: number, lastTick: number, full = false): ArmTelemetry {
    return validateTelemetry({ version: CONTROL_VERSION, identity: this.identity, model: { ...ARM_MODEL }, sequence: ++this.#sequence,
      firstTick, lastTick, rows: this.#channel!.readRows(firstTick, lastTick) }, full ? 1001 : 128);
  }
  private finish(status: "completed" | "stopped" | "failed", reason?: string): void {
    if (this.#closed) return;
    reason = reason?.slice(0, 500);
    this.#closed = true;
    clearTimeout(this.#startupTimer);
    this.#channel?.cancel();
    this.#runtime?.stop();
    if (this.#simulation) {
      this.#simulation.onmessage = null; this.#simulation.onerror = null; this.#simulation.onmessageerror = null;
      this.#simulation.terminate(); this.#simulation = undefined;
    }
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.#visibility);
    let telemetry = this.#lastFrame;
    try { if (this.#channel) telemetry = this.frame(0, this.#channel.tick, true); } catch { /* Keep only an already validated observation frame. */ }
    this.setStatus(status);
    this.#rejectStart?.(new Error(reason ?? "Arm startup interrupted")); this.#rejectStart = undefined;
    if (this.#metadata) this.#resolve?.({ status, project: new ProjectFiles(this.#latestProject).snapshot(), ...(reason ? { reason } : {}), metadata: structuredClone(this.#metadata), telemetry: telemetry ? copiedFrame(telemetry) : null });
    this.#resolve = undefined;
  }
  private setStatus(status: ArmSessionStatus): void { this.#status = status; this.options.onStatus?.(status); }
}
