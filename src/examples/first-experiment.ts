export const FIRST_EXPERIMENT_SOURCE = `from machine import Pin
from time import sleep_ms

interval_ms = 500
led = Pin("LED", Pin.OUT)

for _ in range(3):
    led.on()
    sleep_ms(interval_ms)
    led.off()
    sleep_ms(interval_ms)
print("LED blink complete")`;

export type ExperimentStage = "run" | "edit" | "complete";
export type ExperimentFeedback = "idle" | "running" | "blinked" | "complete" | "noBlink" | "error" | "stopped";

/** UI progress follows real execution and GPIO events, independent of the DOM. */
export class FirstExperiment {
  stage: ExperimentStage = "run";
  feedback: ExperimentFeedback = "idle";
  #source: string | null = null;
  #firstSuccessfulSource: string | null = null;
  #sawOn = false;
  #sawOffAfterOn = false;

  get running(): boolean { return this.#source !== null; }

  reset(): void {
    this.stage = "run";
    this.feedback = "idle";
    this.#source = null;
    this.#firstSuccessfulSource = null;
  }

  start(source: string): void {
    this.#source = source;
    this.#sawOn = false;
    this.#sawOffAfterOn = false;
    this.feedback = "running";
  }

  observeLed(on: boolean): void {
    if (!this.running) return;
    if (on) this.#sawOn = true;
    else if (this.#sawOn) this.#sawOffAfterOn = true;
  }

  finish(ok: boolean): void {
    const source = this.#source;
    if (source === null) return;
    this.#source = null;
    if (!ok) {
      this.feedback = "error";
    } else if (!this.#sawOffAfterOn) {
      this.feedback = "noBlink";
    } else if (this.stage === "run") {
      this.#firstSuccessfulSource = source;
      this.stage = "edit";
      this.feedback = "blinked";
    } else if (source !== this.#firstSuccessfulSource) {
      this.stage = "complete";
      this.feedback = "complete";
    } else {
      this.feedback = this.stage === "complete" ? "complete" : "blinked";
    }
  }

  interrupt(): void {
    if (!this.running) return;
    this.#source = null;
    this.feedback = "stopped";
  }
}
