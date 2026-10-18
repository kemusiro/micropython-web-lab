import { expect, test } from "@playwright/test";
import { runArmControl, DEFAULT_ARM_CONTROL } from "../../src/physics/arm-control";

test("runs the reference controller in restricted MicroPython against the Simulation Worker", async ({ page }) => {
  await page.goto("/fixtures/control/");
  await page.waitForFunction(() => (window as any).armFixture);
  const result = await page.evaluate(async () => {
    const f = (window as any).armFixture;
    const started = performance.now();
    const result = await f.run(undefined, { durationMs: 1000 });
    return { elapsedMs: performance.now() - started, status: result.status, reason: result.reason, rows: Array.from(result.telemetry?.rows ?? []), metadata: result.metadata, output: f.output };
  });
  console.log("arm runtime smoke", result.status, result.reason, result.output);
  expect(result.status).toBe("completed"); expect(result.elapsedMs).toBeGreaterThanOrEqual(950);
  const expected = runArmControl({ ...DEFAULT_ARM_CONTROL, durationMs: 1000 });
  expect(result.rows).toHaveLength(101 * 12);
  expect(Math.abs(Number(result.rows[100 * 12]) - expected.observations[100]!.angleRad)).toBeLessThan(0.0001);
});

for (const [name, changes] of [["normal", {}], ["compensated", { gravityCompensation: true }], ["low damping", { kdNmSPerRad: 0.005 }], ["overloaded", { payloadMassKg: 0.6 }]] as const) {
  test(`Python reproduces all 601 observations of the ${name} reference case`, async ({ page }) => {
    await page.goto("/fixtures/control/"); await page.waitForFunction(() => (window as any).armFixture);
    const result = await page.evaluate(async changes => {
      const result = await (window as any).armFixture.run(undefined, changes);
      return { status: result.status, rows: Array.from(result.telemetry.rows), first: result.telemetry.firstTick, last: result.telemetry.lastTick, metadata: result.metadata };
    }, changes);
    expect(result.status).toBe("completed"); expect(result.first).toBe(0); expect(result.last).toBe(600);
    const expected = runArmControl({ ...DEFAULT_ARM_CONTROL, ...changes });
    const maxErrorDegrees = Math.max(...expected.observations.map((point, tick) => Math.abs(point.angleRad - Number(result.rows[tick * 12])) * 180 / Math.PI));
    console.log("Python arm angle error", name, maxErrorDegrees);
    expect(maxErrorDegrees).toBeLessThan(0.01);
    expect(result.metadata.sourceHash).toMatch(/^[a-f0-9]{64}$/); expect(result.metadata.projectHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.metadata.conditions).toEqual({ ...DEFAULT_ARM_CONTROL, ...changes });
  });
}

test("read does not advance time, the last command is held, and early finish is a partial record", async ({ page }) => {
  await page.goto("/fixtures/control/"); await page.waitForFunction(() => (window as any).armFixture);
  const result = await page.evaluate(async () => {
    const f = (window as any).armFixture;
    const result = await f.run('from weblab.control import Experiment\ne = Experiment()\nj = e.joint("arm")\nassert e.time_s == 0\nassert j.read() == (0, 0)\nfrom time import sleep_ms\nsleep_ms(20)\nassert e.time_s == 0\nj.set_torque(0.5)\nj.set_torque(0.7)\ne.step()\nassert e.time_s == 0.01\ne.step()\nprint("sync read", e.time_s, j.read())', { durationMs: 1000 });
    return { status: result.status, rows: Array.from(result.telemetry.rows), output: f.output };
  });
  expect(result.status).toBe("stopped"); expect(result.rows).toHaveLength(3 * 12);
  expect(result.rows[12 + 7]).toBeCloseTo(0.7, 6); expect(result.rows[24 + 7]).toBeCloseTo(0.7, 6);
  expect(result.output).toContain("sync read");
});

test("rejects invalid API calls and exposes neither a board nor generic JavaScript or networking", async ({ page }) => {
  await page.goto("/fixtures/control/"); await page.waitForFunction(() => (window as any).armFixture);
  const result = await page.evaluate(async () => {
    const f = (window as any).armFixture;
    const result = await f.run(`from weblab.control import Experiment
e = Experiment()
j = e.joint("arm")
errors = 0
for value in [float("nan"), float("inf"), True, "bad"]:
    try:
        j.set_torque(value)
    except Exception:
        errors += 1
try:
    e.joint("unknown")
except ValueError:
    errors += 1
try:
    Experiment()
except Exception:
    errors += 1
for module in ["js", "jsffi", "socket", "network", "machine"]:
    try:
        __import__(module)
    except ImportError:
        errors += 1
import _web_lab_control as bridge
for obj in [bridge, bridge.invoke, bridge.invoke.call]:
    for name in ["constructor", "__proto__", "prototype"]:
        try:
            getattr(obj, name)
        except AttributeError:
            errors += 1
assert errors == 20
print("allowlist verified", errors)
`, { durationMs: 1000 });
    return { status: result.status, reason: result.reason, output: f.output, tick: result.telemetry.lastTick };
  });
  expect(result.output).toContain("allowlist verified 20"); expect(result.tick).toBe(0); expect(result.status).toBe("stopped");
});

test("fails a dead Simulation Worker within the communication deadline while the main thread remains responsive", async ({ page }) => {
  await page.goto("/fixtures/control/"); await page.waitForFunction(() => (window as any).armFixture);
  await page.evaluate(() => { const f = (window as any).armFixture; f.begin(undefined, { durationMs: 10000 }); (window as any).beats = 0; setInterval(() => (window as any).beats++, 10); });
  await page.waitForFunction(() => (window as any).armFixture.frames.length > 0);
  await page.evaluate(() => (window as any).armFixture.simulationWorkers.at(-1).terminate());
  await page.waitForFunction(() => (window as any).armFixture.result, undefined, { timeout: 4000 });
  const result = await page.evaluate(() => ({ status: (window as any).armFixture.result.status, reason: (window as any).armFixture.result.reason, beats: (window as any).beats }));
  expect(result.status).toBe("failed"); expect(result.reason).toContain("timed out"); expect(result.beats).toBeGreaterThan(10);
});

for (const stepping of [false, true]) {
  test(`force-stops ${stepping ? "synchronous step calls" : "Python without step calls"} and restarts in fresh Workers`, async ({ page }) => {
    await page.goto("/fixtures/control/"); await page.waitForFunction(() => (window as any).armFixture);
    await page.evaluate(stepping => (window as any).armFixture.begin(stepping
      ? 'from weblab.control import Experiment\ne=Experiment()\nprint("started")\nwhile True:\n    e.step()'
      : 'print("started")\nwhile True:\n    pass', { durationMs: 10000 }), stepping);
    await page.waitForFunction(() => (window as any).armFixture.output.includes("started"));
    const stopped = await page.evaluate(async () => {
      const f = (window as any).armFixture; f.session.stop(); const result = await f.job;
      return { status: result.status, identity: result.metadata.identity, tick: result.telemetry?.lastTick };
    });
    expect(stopped.status).toBe("stopped"); expect(stopped.tick).toBeGreaterThanOrEqual(0);
    const restarted = await page.evaluate(async () => {
      const result = await (window as any).armFixture.run(undefined, { durationMs: 1000 });
      return { status: result.status, identity: result.metadata.identity, tick: result.telemetry.lastTick };
    });
    expect(restarted.status).toBe("completed"); expect(restarted.identity.generation).toBeGreaterThan(stopped.identity.generation);
    expect(restarted.identity.runId).not.toBe(stopped.identity.runId); expect(restarted.tick).toBe(100);
  });
}

test("page hiding stops the pair and retains the committed observation prefix", async ({ page }) => {
  await page.goto("/fixtures/control/"); await page.waitForFunction(() => (window as any).armFixture);
  await page.evaluate(() => (window as any).armFixture.begin(undefined, { durationMs: 10000 }));
  await page.waitForFunction(() => (window as any).armFixture.frames.length > 0);
  const result = await page.evaluate(async () => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange"));
    const result = await (window as any).armFixture.job; return { status: result.status, tick: result.telemetry.lastTick, reason: result.reason };
  });
  expect(result.status).toBe("stopped"); expect(result.tick).toBeGreaterThan(0); expect(result.reason).toContain("hidden");
});

test("missing isolation leaves source and model conditions readable and refuses model execution", async ({ page }) => {
  await page.route("**/fixtures/control/", async route => {
    const response = await route.fetch(); const headers = response.headers(); delete headers["cross-origin-opener-policy"]; delete headers["cross-origin-embedder-policy"];
    await route.fulfill({ response, headers });
  });
  await page.goto("/fixtures/control/"); await page.waitForFunction(() => (window as any).armFixture);
  const message = await page.evaluate(async () => { try { await (window as any).armFixture.run(); return "unexpected success"; } catch (error) { return String(error); } });
  expect(message).toContain("cross-origin isolation");
  await expect(page.getByText("Development-only arm control integration.", { exact: false })).toBeVisible();
});


test("preserves Python-written files and hashes the starting project independently of its outputs", async ({ page }) => {
  await page.goto("/fixtures/control/"); await page.waitForFunction(() => (window as any).armFixture);
  const result = await page.evaluate(async () => {
    const f = (window as any).armFixture;
    const project = { version: 1, entries: [
      { kind: "directory", path: "empty" },
      { kind: "file", path: "helper.py", data: new TextEncoder().encode("VALUE = 42\n") },
      { kind: "file", path: "seed.bin", data: new Uint8Array([255, 0]) },
    ] };
    const source = 'import helper\nassert helper.VALUE == 42\nopen("data.bin", "wb").write(bytes([0, 255]))\nprint("files retained")';
    const first = await f.run(source, { durationMs: 1000 }, project);
    project.entries[2].data = new Uint8Array([0, 255]);
    const second = await f.run(source, { durationMs: 1000 }, project);
    return { sourceSame: first.metadata.sourceHash === second.metadata.sourceHash, projectChanged: first.metadata.projectHash !== second.metadata.projectHash,
      bytes: Array.from(first.project.entries.find((entry: any) => entry.path === "data.bin").data),
      empty: first.project.entries.some((entry: any) => entry.path === "empty" && entry.kind === "directory"), output: f.output };
  });
  expect(result).toEqual({ sourceSame: true, projectChanged: true, bytes: [0, 255], empty: true, output: "files retained\n" });
});

test("step beyond the planned duration is a Python control error with a retained full record", async ({ page }) => {
  await page.goto("/fixtures/control/"); await page.waitForFunction(() => (window as any).armFixture);
  const result = await page.evaluate(async () => {
    const result = await (window as any).armFixture.run('from weblab.control import Experiment\ne=Experiment()\nfor _ in range(e.steps + 1):\n    e.step()', { durationMs: 1000 });
    return { status: result.status, reason: result.reason, tick: result.telemetry.lastTick };
  });
  expect(result.status).toBe("failed"); expect(result.reason).toContain("sequence or length"); expect(result.tick).toBe(100);
});

test("preserves a large finite Python integer torque before applying saturation", async ({ page }) => {
  await page.goto("/fixtures/control/"); await page.waitForFunction(() => (window as any).armFixture);
  const rows = await page.evaluate(async () => {
    const result = await (window as any).armFixture.run('from weblab.control import Experiment\ne=Experiment()\nj=e.joint("arm")\nj.set_torque(2**40)\ne.step()', { durationMs: 1000 });
    return Array.from(result.telemetry.rows);
  });
  expect(rows[12 + 7]).toBe(2 ** 40); expect(rows[12 + 8]).toBe(1.2);
});
