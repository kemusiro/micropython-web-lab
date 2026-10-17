import { describe, expect, it } from "vitest";
import { FIRST_EXPERIMENT_SOURCE, FirstExperiment } from "./first-experiment";

function blink(experiment: FirstExperiment): void {
  experiment.observeLed(false);
  experiment.observeLed(true);
  experiment.observeLed(false);
}

describe("first experiment progress", () => {
  it("keeps the starter hint anchored to the first successful run while editing", () => {
    const experiment = new FirstExperiment();
    experiment.start(FIRST_EXPERIMENT_SOURCE);
    blink(experiment);
    experiment.finish(true);
    expect(experiment.editGuidance).toBe("starter");
    experiment.start(FIRST_EXPERIMENT_SOURCE.replace("500", "200"));
    expect(experiment.editGuidance).toBe("starter");
    blink(experiment);
    experiment.finish(true);
    expect(experiment.stage).toBe("complete");
  });

  it.each([
    { name: "retained 200ms interval", source: FIRST_EXPERIMENT_SOURCE.replace("500", "200") },
    { name: "renamed variable", source: FIRST_EXPERIMENT_SOURCE.replaceAll("interval_ms", "pause_ms") },
    { name: "interval expression", source: FIRST_EXPERIMENT_SOURCE.replace("500", "100 + 100") },
  ])("does not assume the starter interval or variable name: $name", ({ source }) => {
    const experiment = new FirstExperiment();
    experiment.start(FIRST_EXPERIMENT_SOURCE);
    blink(experiment);
    experiment.finish(true);
    experiment.reset();
    experiment.start(source);
    blink(experiment);
    experiment.finish(true);
    expect(experiment.stage).toBe("edit");
    expect(experiment.editGuidance).toBe("custom");
  });

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
