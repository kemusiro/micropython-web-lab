import { expect, test } from "@playwright/test";
import { DEFAULT_ARM_CONTROL, runArmControl } from "../../src/physics/arm-control";

for (const [name, change] of [
  ["gravity-bias", {}], ["gravity-compensation", { gravityCompensation: true }],
  ["low-damping", { kdNmSPerRad: 0.005 }], ["overloaded", { payloadMassKg: 0.6 }],
] as const) {
  test(`matches the Node reference and repeats the ${name} series in Chromium`, async ({ page }, testInfo) => {
    await page.goto("/fixtures/experiments/");
    const conditions = { ...DEFAULT_ARM_CONTROL, ...change };
    const expected = runArmControl(conditions);
    const result = await page.evaluate(async conditions => {
      const { runArmControl } = await import("/src/physics/arm-control.ts");
      const first = runArmControl(conditions), again = runArmControl(conditions), fine = runArmControl(conditions, 500);
      return { first, repeat: JSON.stringify(first) === JSON.stringify(again),
        halvedStepAngleDifference: Math.max(...first.observations.map((point: any, i: number) => Math.abs(point.angleRad - fine.observations[i].angleRad))) };
    }, conditions);
    expect(result.repeat).toBe(true);
    expect(result.first.observations).toHaveLength(601);
    const nodeDifference = Math.max(...result.first.observations.map((point: any, i: number) => Math.abs(point.angleRad - expected.observations[i]!.angleRad)));
    const nodeSpeedDifference = Math.max(...result.first.observations.map((point: any, i: number) => Math.abs(point.angularVelocityRadPerS - expected.observations[i]!.angularVelocityRadPerS)));
    expect(nodeDifference).toBeLessThan(1e-9); expect(nodeSpeedDifference).toBeLessThan(1e-8);
    expect(result.halvedStepAngleDifference * 180 / Math.PI).toBeLessThan(0.01);
    expect(result.first.intervals.map((point: any) => point.tick)).toEqual(expected.intervals.map(point => point.tick));
    const summary = { name, finalDegrees: result.first.observations.at(-1)!.angleRad * 180 / Math.PI,
      peakDegrees: Math.max(...result.first.observations.map((point: any) => point.angleRad * 180 / Math.PI)),
      halvedStepDifferenceDegrees: result.halvedStepAngleDifference * 180 / Math.PI, nodeDifference };
    await testInfo.attach("arm-reference.json", { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
    console.log("arm reference", JSON.stringify(summary));
  });
}

test("keeps results independent of host scheduling and retains bounded records after stopping", async ({ page }) => {
  await page.goto("/fixtures/experiments/");
  const result = await page.evaluate(async () => {
    const { OneAxisArm } = await import("/src/physics/one-axis-arm.ts");
    const direct = new OneAxisArm(), batched = new OneAxisArm();
    const torque = (tick: number) => 0.5 + 0.3 * Math.sin(tick / 7);
    for (let tick = 0; tick < 100; tick++) direct.step(torque(tick));
    for (let tick = 0; tick < 100; tick++) {
      batched.step(torque(tick));
      if (tick % 13 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
    }
    batched.end(); const before = batched.trace();
    let error = ""; try { batched.step(1); } catch (e) { error = (e as Error).message; }
    return { same: JSON.stringify(direct.trace().observations) === JSON.stringify(before.observations) && JSON.stringify(direct.trace().intervals) === JSON.stringify(before.intervals), status: before.status, unchanged: JSON.stringify(before) === JSON.stringify(batched.trace()),
      count: before.observations.length, error };
  });
  expect(result).toEqual({ same: true, unchanged: true, count: 101, status: "stopped", error: "Arm simulation has ended" });
});
