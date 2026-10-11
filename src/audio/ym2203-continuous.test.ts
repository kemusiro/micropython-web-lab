import { afterEach, expect, it, vi } from "vitest";
import { YmContinuousAudition, YM_LIVE_CHANGE_MS } from "./ym2203-continuous";
import { defaultYmPatch } from "./ym2203-patch";
afterEach(() => { vi.useRealTimers(); });
function setup() {
  vi.useFakeTimers();
  const hooks = { write: vi.fn(), stop: vi.fn(), error: vi.fn() };
  const live = new YmContinuousAudition(hooks); live.setReady(true);
  return { live, hooks };
}
it("debounces edits to the newest independent snapshot without periodic I2C traffic", () => {
  const { live, hooks } = setup();
  const patch = defaultYmPatch(); live.start(patch);
  expect(hooks.write).toHaveBeenLastCalledWith(patch, false);
  patch.note = 60; live.update(patch);
  patch.note = 64; live.update(patch);
  patch.note = 67; // Edits after submission cannot mutate the pending snapshot.
  vi.advanceTimersByTime(YM_LIVE_CHANGE_MS);
  expect(hooks.write).toHaveBeenCalledTimes(2);
  expect(hooks.write.mock.calls[1]![0].note).toBe(64);
  vi.advanceTimersByTime(24 * 60 * 60 * 1000);
  expect(hooks.write).toHaveBeenCalledTimes(2);
  live.stop(); vi.advanceTimersByTime(60_000);
  expect(hooks.write).toHaveBeenCalledTimes(2);
  expect(hooks.stop).toHaveBeenCalledOnce();
});
it("waits for its busy runtime, pauses on invalid editing and resumes only with a new valid patch", () => {
  const { live, hooks } = setup();
  live.setReady(false); live.start(defaultYmPatch());
  vi.advanceTimersByTime(10_000); expect(hooks.write).not.toHaveBeenCalled();
  live.setReady(true); vi.advanceTimersByTime(0); expect(hooks.write).toHaveBeenCalledOnce();
  live.setReady(false); vi.advanceTimersByTime(2000);
  const patch = defaultYmPatch(); patch.feedback = 5; live.update(patch);
  vi.advanceTimersByTime(YM_LIVE_CHANGE_MS);
  live.setReady(true); vi.advanceTimersByTime(0);
  expect(hooks.write).toHaveBeenLastCalledWith(expect.objectContaining({ feedback: 5 }), false);
  live.pause(); vi.advanceTimersByTime(60_000);
  expect(hooks.write).toHaveBeenCalledTimes(2);
  expect(live.active).toBe(true);
  live.update(defaultYmPatch()); vi.advanceTimersByTime(YM_LIVE_CHANGE_MS);
  expect(hooks.write).toHaveBeenCalledTimes(3);
});
it("disarms errors and stop, so delayed readiness cannot restart a closed audition", () => {
  const { live, hooks } = setup();
  hooks.write.mockImplementation(() => { throw new Error("runtime stopped"); });
  live.start(defaultYmPatch());
  expect(live.active).toBe(false); expect(hooks.error).toHaveBeenCalledOnce();
  expect(hooks.stop).toHaveBeenCalledOnce();
  live.setReady(false); live.setReady(true); vi.advanceTimersByTime(30_000);
  expect(hooks.write).toHaveBeenCalledOnce();
  hooks.write.mockReset(); live.setReady(false); live.start(defaultYmPatch());
  live.update(defaultYmPatch()); live.stop(); live.setReady(true); vi.advanceTimersByTime(30_000);
  expect(hooks.write).not.toHaveBeenCalled();
});

it("waits for an owned write to finish before stopping invalid editing, then accepts the corrected patch", () => {
  const { live, hooks } = setup(); live.start(defaultYmPatch());
  live.setReady(false); live.pause();
  expect(hooks.stop).not.toHaveBeenCalled();
  live.update(defaultYmPatch()); live.setReady(true);
  expect(hooks.stop).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(YM_LIVE_CHANGE_MS);
  expect(hooks.write).toHaveBeenCalledTimes(2);
  expect(live.active).toBe(true);
});
