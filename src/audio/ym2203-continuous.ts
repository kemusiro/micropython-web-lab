import { validateYmPatch, type YmPatch } from "./ym2203-patch";

export const YM_LIVE_CHANGE_MS = 80;
const copy = (patch: YmPatch): YmPatch => ({ ...patch, operators: patch.operators.map(op => ({ ...op })) });
/** UI-independent ownership/debounce. Long playback needs no recurring I2C keepalive. */
export class YmContinuousAudition {
  #active = false;
  #ready = false;
  #pending: YmPatch | null = null;
  #stopDue = false;
  #change: ReturnType<typeof setTimeout> | null = null;
  constructor(readonly hooks: {
    write(patch: YmPatch, renew: boolean): void;
    stop(): void;
    error(error: unknown): void;
  }) {}
  get active(): boolean { return this.#active; }
  setReady(ready: boolean): void {
    this.#ready = ready;
    if (ready && this.#active && this.#stopDue) { this.#stopDue = false; this.hooks.stop(); }
    if (ready && this.#active && this.#pending && this.#change === null) {
      this.#change = setTimeout(() => { this.#change = null; this.flush(); }, 0);
    }
  }
  start(patch: YmPatch): void {
    validateYmPatch(patch);
    this.#active = true; this.#pending = copy(patch); this.flush();
  }
  update(patch: YmPatch): void {
    validateYmPatch(patch);
    if (!this.#active) return;
    this.#pending = copy(patch);
    if (this.#change !== null) clearTimeout(this.#change);
    this.#change = setTimeout(() => { this.#change = null; this.flush(); }, YM_LIVE_CHANGE_MS);
  }
  pause(): void {
    if (!this.#active) return;
    this.clear(); this.#pending = null;
    this.#stopDue = !this.#ready;
    if (this.#ready) this.hooks.stop();
  }
  stop(): void {
    const active = this.#active;
    this.#active = false; this.clear(); this.#pending = null; this.#stopDue = false;
    if (active) this.hooks.stop();
  }
  private clear(): void {
    if (this.#change !== null) clearTimeout(this.#change);
    this.#change = null;
  }
  private flush(): void {
    if (!this.#active || !this.#ready) return;
    const patch = this.#pending;
    if (!patch) return;
    this.#pending = null;
    try {
      this.hooks.write(patch, false);
    } catch (error) { this.stop(); this.hooks.error(error); }
  }
}
