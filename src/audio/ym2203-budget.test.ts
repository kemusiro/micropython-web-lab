import { expect, it } from "vitest";
import { YmCommandBudget, MAX_YM_AUDIO_MESSAGES, MAX_YM_AUDIO_VALUES } from "./ym2203-budget";
import { MAX_YM_EVENTS } from "./ym2203-protocol";

it("allows one full reservation, retains a bounded immediate allowance, and rejects the next full score", () => {
  const budget = new YmCommandBudget();
  const command = { version: 1, action: "play", events: new Array(MAX_YM_EVENTS * 3).fill(0), durationMs: 100 } as const;
  budget.consume({ version: 1, action: "stop" });
  budget.consume(command);
  expect(() => budget.consume(command)).toThrow(/budget/);
  // Failed consumption is atomic; smaller commands remain possible.
  budget.consume({ version: 1, action: "gain", percent: 20 });
  expect(MAX_YM_AUDIO_VALUES).toBe(MAX_YM_EVENTS * 3 + 32768);
});

it("does not reset message allowance on stop and rejects the 1025th command", () => {
  const budget = new YmCommandBudget();
  for (let i = 0; i < MAX_YM_AUDIO_MESSAGES; i++) budget.consume({ version: 1, action: "stop" });
  expect(() => budget.consume({ version: 1, action: "gain", percent: 20 })).toThrow(/budget/);
});

it("accepts the exact value budget and rejects one more value atomically", () => {
  const budget = new YmCommandBudget();
  budget.consume({ version: 1, action: "play", events: new Array(MAX_YM_EVENTS * 3).fill(0), durationMs: 100 });
  for (let i = 0; i < 128; i++) budget.consume({ version: 1, action: "write", pairs: new Array(256).fill(0) });
  expect(() => budget.consume({ version: 1, action: "gain", percent: 20 })).toThrow(/budget/);
});
