import { applyExperimentContent, experimentProject, snapshotExperiment, type ExperimentContent, type ExperimentSet } from "./record";
import type { ExperimentPersistence, SwitchTarget } from "./store";
import type { ProjectPersistence, StoredProject } from "../project/project-state";

export interface ExperimentSession { readonly setId: string; readonly generation: number }
export type ExperimentPhase = "idle" | "preparing" | "saving" | "starting" | "failed";
export interface ExperimentHost {
  /** Read-only preflight: resolve approved runtime/device capabilities without touching live execution. */
  prepare(record: ExperimentSet): Promise<void>;
  lock(locked: boolean): void;
  /** Terminate workers from outside, stop audio reservations and release pressed inputs. */
  stop(): void | Promise<void>;
  capture(): ExperimentContent;
  install(record: ExperimentSet, session: ExperimentSession): void;
  /** Create initial runtime state only. Never run the user's code here. */
  start(record: ExperimentSet, session: ExperimentSession): Promise<void>;
}

export class ExperimentCoordinator {
  #current: ExperimentSet;
  #generation = 1;
  #busy = false;
  #locked = false;
  #tail: Promise<void> = Promise.resolve();
  #saveFailure: unknown;
  phase: ExperimentPhase = "idle";
  error: unknown;

  constructor(readonly store: ExperimentPersistence, readonly host: ExperimentHost, record: ExperimentSet) {
    this.#current = snapshotExperiment(record);
  }
  get current(): ExperimentSet { return snapshotExperiment(this.#current); }
  get session(): ExperimentSession { return Object.freeze({ setId: this.#current.id, generation: this.#generation }); }
  isCurrent(session: ExperimentSession): boolean {
    return session.setId === this.#current.id && session.generation === this.#generation;
  }

  /** Capture at enqueue time; serialize writes with the current committed revision. */
  save(content: ExperimentContent, session: ExperimentSession): Promise<void> {
    if (this.#locked || !this.isCurrent(session)) return Promise.reject(new Error("Obsolete or locked experiment session"));
    const stamp = Object.freeze({ ...session });
    const captured = applyExperimentContent(this.#current, content);
    this.#current = captured;
    const saving = this.#tail.then(async () => {
      if (!this.isCurrent(stamp)) throw new Error("Obsolete experiment session");
      const committed = await this.store.save(snapshotExperiment({ ...captured, revision: this.#current.revision }));
      if (!this.isCurrent(stamp)) throw new Error("Obsolete experiment save completion");
      // Newer queued editor changes remain in memory while the committed revision advances.
      this.#current = snapshotExperiment({ ...this.#current, revision: committed.revision, savedAt: committed.savedAt });
      this.#saveFailure = undefined;
    });
    this.#tail = saving.catch(error => { this.#saveFailure = error; });
    return saving;
  }

  async switchTo(target: { kind: "saved"; id: string } | { kind: "new"; record: ExperimentSet }, signal?: AbortSignal): Promise<void> {
    if (this.#busy) throw new Error("An experiment switch is already in progress");
    if (target.kind === "saved" && target.id === this.#current.id) return;
    this.#busy = true;
    this.phase = "preparing";
    this.error = undefined;
    let stopped = false;
    let committed = false;
    try {
      const candidate = target.kind === "new" ? snapshotExperiment(target.record) : await this.store.load(target.id);
      if (candidate.id === this.#current.id) throw new Error("Duplicate experiment ID");
      if (candidate.environment.kind === "unavailable") throw new Error("Experiment configuration requires recovery");
      // Also validate the source before the runtime is stopped.
      this.#current = applyExperimentContent(this.#current, this.host.capture());
      await beforeBarrier(this.host.prepare(snapshotExperiment(candidate)), signal);
      if (signal?.aborted) throw new DOMException("Experiment switch cancelled", "AbortError");
      this.#locked = true;
      this.host.lock(true);
      await this.#tail;
      if (this.#saveFailure !== undefined) throw this.#saveFailure;
      // Generations advance even if stopping/saving fails: old callbacks cannot become current again.
      this.#generation++;
      stopped = true;
      await this.host.stop();
      this.#current = applyExperimentContent(this.#current, this.host.capture());
      this.phase = "saving";
      const destination: SwitchTarget = target.kind === "new"
        ? { kind: "new", record: candidate }
        : { kind: "saved", id: candidate.id, revision: candidate.revision };
      const selected = await this.store.switch(this.#current, destination);
      this.#current = snapshotExperiment(selected);
      committed = true;
      this.phase = "starting";
      const session = this.session;
      this.host.install(this.current, session);
      await this.host.start(this.current, session);
      this.phase = "idle";
    } catch (error) {
      this.phase = "failed";
      this.error = error;
      if (stopped && !committed) this.host.install(this.current, this.session);
      throw error;
    } finally {
      if (this.#locked) this.host.lock(false);
      this.#locked = false;
      this.#busy = false;
    }
  }
}

/** Bind each ProjectWorkspace to one session; late saves cannot follow the active pointer. */
export class ExperimentProjectPersistence implements ProjectPersistence {
  readonly session: ExperimentSession;
  constructor(readonly coordinator: ExperimentCoordinator, session = coordinator.session) {
    this.session = Object.freeze({ ...session });
  }
  async load(): Promise<StoredProject> {
    if (!this.coordinator.isCurrent(this.session)) throw new Error("Obsolete project workspace");
    return experimentProject(this.coordinator.current);
  }
  async save(value: StoredProject): Promise<void> {
    await this.coordinator.save({ ...this.coordinator.current, filesystem: value.filesystem,
      editor: { tabs: value.tabs, activeTabId: value.activeTabId } }, this.session);
  }
}

function beforeBarrier(preparation: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return preparation;
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(new DOMException("Experiment switch cancelled", "AbortError"));
    if (signal.aborted) { void preparation.catch(() => {}); abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    preparation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
