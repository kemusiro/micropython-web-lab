/// <reference lib="webworker" />
import { CONTROL_HEADER as H, CONTROL_VERSION, SharedArmChannel, snapshotArmProfile } from "./channel";
import { OneAxisArm, DEFAULT_ARM_PHYSICS, ARM_MODEL } from "../physics/one-axis-arm";
declare const self: DedicatedWorkerGlobalScope;
let started = false;
self.onmessage = event => {
  let channel: SharedArmChannel | undefined;
  try {
    if (started) throw new Error("Simulation already started");
    started = true;
    const profile = snapshotArmProfile(event.data);
    channel = SharedArmChannel.attach(profile.buffer, profile.identity.generation);
    const conditions = profile.conditions;
    const arm = new OneAxisArm({ parameters: { ...DEFAULT_ARM_PHYSICS, payloadMassKg: conditions.payloadMassKg },
      initialState: { angleRad: conditions.initialAngleRad, angularVelocityRadPerS: 0 }, maxTicks: conditions.durationMs / 10 });
    channel.publish(arm.read());
    self.postMessage({ version: CONTROL_VERSION, type: "ready", identity: profile.identity, model: ARM_MODEL });
    let startedAt: number | undefined, emittedAt = 0, sequence = 0;
    while (!Atomics.load(channel.controls, H.cancel)) {
      channel.assertLive();
      const previous = channel.completed;
      if (channel.requested === previous) { Atomics.wait(channel.controls, H.request, previous, 50); continue; }
      if (channel.requested !== previous + 1 || previous !== arm.tick) throw new Error("Simulation request sequence mismatch");
      startedAt ??= performance.now();
      const result = arm.step(channel.torque);
      const due = startedAt + result.observation.timeS * 1000;
      const remaining = due - performance.now();
      if (remaining > 0) Atomics.wait(channel.controls, H.cancel, 0, remaining);
      channel.publish(result.observation, result.interval);
      const now = performance.now();
      if (now - emittedAt >= 50) {
        emittedAt = now;
        self.postMessage({ version: CONTROL_VERSION, type: "progress", identity: profile.identity, model: ARM_MODEL,
          sequence: ++sequence, tick: arm.tick, lagMs: Math.max(0, now - due) });
      }
    }
  } catch (error) {
    if (channel && Atomics.load(channel.controls, H.cancel)) return;
    channel?.fail();
    self.postMessage({ version: CONTROL_VERSION, type: "error", message: error instanceof Error ? error.message : "Simulation failed" });
  }
};
