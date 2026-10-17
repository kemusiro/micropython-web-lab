import { describe, expect, it } from "vitest";
import { ButtonExperiment } from "./button-experiment";

describe("button experiment", () => {
  it("requires a press followed by a release during a successful run", () => {
    const experiment = new ButtonExperiment();
    experiment.start();
    experiment.observe(false, 1);
    expect(experiment.feedback).toBe("running");
    experiment.observe(true, 2);
    expect(experiment.feedback).toBe("pressed");
    experiment.observe(false, 3);
    expect(experiment.feedback).toBe("released");
    experiment.finish(true);
    expect(experiment.feedback).toBe("complete");
  });

  it("ignores inputs before execution and out-of-order or repeated events", () => {
    const experiment = new ButtonExperiment();
    experiment.observe(true, 2);
    experiment.start();
    experiment.observe(true, 2);
    experiment.observe(false, 1);
    experiment.observe(false, 3);
    experiment.finish(true);
    expect(experiment.feedback).toBe("noInput");
  });

  it("does not complete without a release or after a failed run", () => {
    const experiment = new ButtonExperiment();
    experiment.start();
    experiment.observe(true, 1);
    experiment.finish(true);
    expect(experiment.feedback).toBe("noInput");
    experiment.start();
    experiment.observe(true, 2);
    experiment.observe(false, 3);
    experiment.finish(false);
    expect(experiment.feedback).toBe("error");
  });

  it("ignores late completion after interruption and accepts a new Worker sequence", () => {
    const experiment = new ButtonExperiment();
    experiment.start();
    experiment.observe(true, 10);
    experiment.interrupt();
    experiment.finish(true);
    expect(experiment.feedback).toBe("stopped");
    experiment.start();
    experiment.observe(true, 1);
    experiment.observe(false, 2);
    experiment.finish(true);
    expect(experiment.feedback).toBe("complete");
  });

  it("clears observations on retry and progress on reopening", () => {
    const experiment = new ButtonExperiment();
    experiment.start();
    experiment.observe(true, 1);
    experiment.observe(false, 2);
    experiment.finish(true);
    experiment.start();
    experiment.finish(true);
    expect(experiment.feedback).toBe("noInput");
    experiment.reset();
    expect(experiment.running).toBe(false);
    expect(experiment.feedback).toBe("idle");
  });
});
