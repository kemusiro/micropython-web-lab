/** Host-internal prototype protocol; this is not a Device SDK capability. */
export const YM_AUDIO_VERSION = 1 as const;
export const YM_INSTANCE = "ym2203-prototype";
export const YM_ADDRESS = 0x44;
export const MAX_YM_EVENTS = 131_071;
export const MAX_YM_DURATION_MS = 0xFFFFFFFF; // uint32 milliseconds: ~49.7 days.
export const MIN_YM_LOOP_MS = 100;
export const MAX_YM_PLAYBACK_EVENTS = MAX_YM_EVENTS * (Math.ceil(MAX_YM_DURATION_MS / MIN_YM_LOOP_MS) + 1);
export type YmCommand =
  | { version: 1; action: "write"; pairs: number[] }
  | { version: 1; action: "play"; events: number[]; durationMs: number; loopMs?: number }
  | { version: 1; action: "stop" }
  | { version: 1; action: "gain"; percent: number };

const integer = (value: unknown, maximum: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum;
export function validYmEvents(events: unknown): events is number[] {
  if (!Array.isArray(events) || events.length === 0 || events.length % 3 || events.length > MAX_YM_EVENTS * 3) return false;
  let previous = 0;
  for (let i = 0; i < events.length; i += 3) {
    if (!integer(events[i], MAX_YM_DURATION_MS) || events[i] < previous || !integer(events[i + 1], 255) || !integer(events[i + 2], 255)) return false;
    previous = events[i];
  }
  return true;
}
export function isYmCommand(value: unknown): value is YmCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  if (command.version !== YM_AUDIO_VERSION) return false;
  switch (command.action) {
    case "stop": return true;
    case "gain": return integer(command.percent, 100);
    case "write": return Array.isArray(command.pairs) && command.pairs.length > 0 && command.pairs.length <= 256 && command.pairs.length % 2 === 0 && Array.from(command.pairs).every(value => integer(value, 255));
    case "play": return validYmEvents(command.events) && integer(command.durationMs, MAX_YM_DURATION_MS) && command.durationMs > 0 && command.events[command.events.length - 3]! <= command.durationMs
      && (command.loopMs === undefined || (integer(command.loopMs, command.durationMs) && command.loopMs >= MIN_YM_LOOP_MS && command.events[command.events.length - 3]! <= command.loopMs));
    default: return false;
  }
}
