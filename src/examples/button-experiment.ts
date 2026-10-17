export type ButtonExperimentFeedback = "idle" | "running" | "pressed" | "released" | "complete" | "noInput" | "error" | "stopped";

/** Progress follows button model events observed during a successful execution. */
export class ButtonExperiment {
  feedback: ButtonExperimentFeedback = "idle";
  #running = false;
  #sawPress = false;
  #sawRelease = false;
  #lastSequence = -1;

  get running(): boolean { return this.#running; }

  reset(): void {
    this.#running = false;
    this.#sawPress = false;
    this.#sawRelease = false;
    this.#lastSequence = -1;
    this.feedback = "idle";
  }

  start(): void {
    this.#running = true;
    this.#sawPress = false;
    this.#sawRelease = false;
    this.feedback = "running";
  }

  observe(pressed: boolean, sequence: number): void {
    if (sequence <= this.#lastSequence) return;
    this.#lastSequence = sequence;
    if (!this.#running) return;
    if (pressed) this.#sawPress = true;
    else if (this.#sawPress) this.#sawRelease = true;
    this.feedback = pressed ? "pressed" : this.#sawPress ? "released" : "running";
  }

  finish(ok: boolean): void {
    if (!this.#running) return;
    this.#running = false;
    this.feedback = !ok ? "error" : this.#sawRelease ? "complete" : "noInput";
  }

  interrupt(): void {
    if (this.#running) this.feedback = "stopped";
    this.#running = false;
    this.#lastSequence = -1;
  }
}
