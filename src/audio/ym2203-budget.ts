import { MAX_YM_EVENTS, type YmCommand } from "./ym2203-protocol";

export const MAX_YM_AUDIO_MESSAGES = 1024;
// One maximum-size reservation plus the previous immediate-control allowance.
export const MAX_YM_AUDIO_VALUES = MAX_YM_EVENTS * 3 + 32_768;

/** Cumulative per runtime generation; stop cannot replenish an abusive sender. */
export class YmCommandBudget {
  #messages = 0;
  #values = 0;
  consume(command: YmCommand): void {
    const size = command.action === "write" ? command.pairs.length : command.action === "play" ? command.events.length : 1;
    if (this.#messages >= MAX_YM_AUDIO_MESSAGES || this.#values + size > MAX_YM_AUDIO_VALUES) {
      throw new RangeError("Prototype audio command budget exceeded; restart the runtime.");
    }
    this.#messages++;
    this.#values += size;
  }
}
