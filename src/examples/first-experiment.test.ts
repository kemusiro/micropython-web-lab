import { describe, expect, it } from "vitest";
import { FirstExperiment } from "./first-experiment";

function blink(experiment: FirstExperiment): void {
  experiment.observeLed(false);
  experiment.observeLed(true);
  experiment.observeLed(false);
}

describe("first experiment progress", () => {
  it("requires a successful blink, then edited code and another successful blink", () => {
    const experiment = new FirstExperiment();
    experiment.start("interval_ms = 500");
    blink(experiment);
    experiment.finish(true);
    expect(experiment.stage).toBe("edit");
    experiment.start("interval_ms = 500");
    blink(experiment);
    experiment.finish(true);
    expect(experiment.stage).toBe("edit");
    experiment.start("interval_ms = 200");
    blink(experiment);
    experiment.finish(true);
    expect(experiment.stage).toBe("complete");
  });

  it("does not advance for unrelated successful code or for on without off", () => {
    const experiment = new FirstExperiment();
    experiment.observeLed(true); // Events before this run cannot count.
    experiment.start("print(42)");
    experiment.observeLed(false);
    experiment.finish(true);
    expect(experiment.stage).toBe("run");
    expect(experiment.feedback).toBe("noBlink");
    experiment.start("led.on()");
    experiment.observeLed(true);
    experiment.finish(true);
    expect(experiment.stage).toBe("run");
  });

  it("does not advance on errors even after the LED has blinked", () => {
    const experiment = new FirstExperiment();
    experiment.start("blink_then_raise()");
    blink(experiment);
    experiment.finish(false);
    expect(experiment.stage).toBe("run");
    expect(experiment.feedback).toBe("error");
  });

  it("ignores late completion after interruption and allows retry", () => {
    const experiment = new FirstExperiment();
    experiment.start("sample");
    blink(experiment);
    experiment.interrupt();
    experiment.finish(true);
    expect(experiment.stage).toBe("run");
    expect(experiment.feedback).toBe("stopped");
    experiment.start("sample");
    blink(experiment);
    experiment.finish(true);
    expect(experiment.stage).toBe("edit");
  });

  it("clears progress and previous-run observations when restarted", () => {
    const experiment = new FirstExperiment();
    experiment.start("sample");
    blink(experiment);
    experiment.finish(true);
    experiment.reset();
    experiment.start("sample");
    experiment.finish(true);
    expect(experiment.stage).toBe("run");
    expect(experiment.feedback).toBe("noBlink");
  });
});
