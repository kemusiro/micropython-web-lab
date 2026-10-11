import { expect, it } from "vitest";
import { isAudioMeter, isYmReceipt, isYmWorkletCommand, YmDeliveryTracker, type AudioMeter } from "./ym2203-delivery";
import { MAX_YM_DURATION_MS, MAX_YM_PLAYBACK_EVENTS } from "./ym2203-protocol";
const stop = { version: 1, action: "stop" } as const;
const meter = (epoch: number, sequence: number, frame = 128): AudioMeter => ({ version: 1, type: "meter", epoch, sequence, frame,
  active: false, state: "stopped", mode: "idle", elapsedMs: 0, durationMs: 0, total: 0,
  pending: 0, applied: 0, fmRms: 0, ssgRms: 0, rms: 0, peak: 0 });
const receipt = (epoch: number, sequence: number) => ({ version: 1, type: "accepted", epoch, sequence } as const);
it("counts only explicit acceptance, and keeps newer submissions pending after an old meter", () => {
  const delivery = new YmDeliveryTracker();
  delivery.submit(stop); delivery.submit({ version: 1, action: "gain", percent: 50 });
  expect(delivery.pendingAcceptance).toBe(2);
  expect(delivery.render(meter(0, 1))).toBe(false);
  expect(delivery.pendingAcceptance).toBe(2);
  expect(delivery.accept(receipt(0, 1))).toBe(true);
  expect(delivery.render(meter(0, 1))).toBe(false);
  expect(delivery.state).toEqual({ epoch: 0, sent: 2, accepted: 1, rendered: 1 });
  expect(delivery.accept(receipt(0, 2))).toBe(true);
  expect(delivery.render(meter(0, 2, 256))).toBe(true);
  expect(delivery.pendingAcceptance).toBe(0);
  expect(delivery.render(meter(0, 1, 512))).toBe(false);
  expect(delivery.render(meter(0, 2, 128))).toBe(false);
});
it("fences delayed reports across stop, repeated playback and worklet replacement", () => {
  const delivery = new YmDeliveryTracker();
  for (let epoch = 1; epoch <= 20; epoch++) {
    delivery.reset();
    const command = delivery.submit(stop);
    expect(command).toMatchObject({ epoch, sequence: 1 });
    expect(delivery.accept(receipt(epoch - 1, 1))).toBe(false);
    expect(delivery.render(meter(epoch - 1, 1))).toBe(false);
    expect(delivery.accept(receipt(epoch, 2))).toBe(false);
    expect(delivery.accept(receipt(epoch, 1))).toBe(true);
    expect(delivery.render(meter(epoch, 1))).toBe(true);
  }
});
it("validates transport versions, identities, finite meters and playback limits", () => {
  const command = { version: 1, type: "command", epoch: 1, sequence: 1, command: stop };
  expect(isYmWorkletCommand(command)).toBe(true);
  for (const change of [{ version: 2 }, { epoch: -1 }, { sequence: 0 }, { sequence: 1.5 }, { command: { version: 1, action: "other" } }]) expect(isYmWorkletCommand({ ...command, ...change })).toBe(false);
  expect(isYmReceipt(receipt(1, 1))).toBe(true);
  expect(isYmReceipt({ ...receipt(1, 1), sequence: Infinity })).toBe(false);
  expect(isAudioMeter(meter(1, 1))).toBe(true);
  for (const change of [{ version: 2 }, { frame: NaN }, { rms: Infinity }, { pending: 1 }, { active: true }, { durationMs: MAX_YM_DURATION_MS + 1 }, { elapsedMs: 1 }, { total: MAX_YM_PLAYBACK_EVENTS + 1 }, { mode: "other" }]) expect(isAudioMeter({ ...meter(1, 1), ...change })).toBe(false);
});
