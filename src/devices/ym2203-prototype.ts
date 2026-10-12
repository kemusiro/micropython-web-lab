import type { DeviceDefinition } from "../device-api/types.ts";
import { MAX_YM_EVENTS, YM_ADDRESS, YM_INSTANCE, validYmEvents, isYmCommand, type YmCommand } from "../audio/ym2203-protocol.ts";

/** All I2C operations are synchronous. Only the host receives the audio sink. */
export function createYm2203PrototypeDefinition(send: (command: YmCommand) => void): DeviceDefinition {
  return {
    manifest: {
      schemaVersion: 1, id: "org.micropython-web-lab.ym2203-prototype", version: "0.1.0",
      deviceApiVersion: 1, name: "YM2203 FM + SSG prototype", license: "MIT",
      description: "Experimental I2C-controlled FM/SSG module; not an official Yamaha product",
      entrypoint: "./dist/device.js", requires: { boardCapabilities: ["i2c-controller-v1"] },
      ports: [{ id: "i2c", kind: "i2c-target", defaultAddress: YM_ADDRESS }],
    },
    create(context) {
      let events: number[] = [];
      let transactions = 0;
      let gain = 50;
      let plays = 0;
      const emit = (): void => context.emitState({ address: YM_ADDRESS, queuedEvents: events.length / 3, transactions, gain, plays });
      const reset = (): void => { send({ version: 1, action: "stop" }); send({ version: 1, action: "gain", percent: 50 }); events = []; gain = 50; transactions = plays = 0; emit(); };
      const write = (data: Uint8Array): void => {
        // 00 pairs; 01/02 legacy uint16 events/play; 05/06 uint32 events/play(+loop).
        const opcode = data[0];
        const payload = data.subarray(1);
        let command: YmCommand | null = null;
        let nextEvents = events;
        let addition: number[] | null = null;
        if (opcode === 0 && payload.length > 0 && payload.length % 2 === 0) {
          command = { version: 1, action: "write", pairs: [...payload] };
        } else if ((opcode === 1 || opcode === 5) && payload.length > 0 && payload.length % (opcode === 1 ? 4 : 6) === 0) {
          addition = [];
          const width = opcode === 1 ? 2 : 4;
          const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
          for (let i = 0; i < payload.length; i += width + 2) addition.push(width === 2 ? view.getUint16(i, true) : view.getUint32(i, true), payload[i + width]!, payload[i + width + 1]!);
          // Validate only the new batch. Copying/revalidating the whole queue on
          // every 256-byte transfer makes a full song quadratic in its size.
          if (events.length + addition.length > MAX_YM_EVENTS * 3 || !validYmEvents(addition)
            || (events.length > 0 && addition[0]! < events[events.length - 3]!)) {
            throw new RangeError(`YM2203 queue requires ordered uint32 times and at most ${MAX_YM_EVENTS} events.`);
          }
        } else if ((opcode === 2 && payload.length === 2) || (opcode === 6 && (payload.length === 4 || payload.length === 8))) {
          const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
          const durationMs = opcode === 2 ? view.getUint16(0, true) : view.getUint32(0, true);
          command = { version: 1, action: "play", events: [...events], durationMs,
            ...(payload.length === 8 ? { loopMs: view.getUint32(4, true) } : {}) };
          if (!isYmCommand(command)) throw new RangeError("YM2203 play requires queued events and valid duration/loop timing.");
          nextEvents = [];
        } else if (opcode === 3 && payload.length === 0) {
          command = { version: 1, action: "stop" }; nextEvents = [];
        } else if (opcode === 4 && payload.length === 1 && payload[0]! <= 100) {
          command = { version: 1, action: "gain", percent: payload[0]! };
        } else throw new TypeError("Invalid YM2203 I2C command.");
        // Publish before committing local state: transport rejection is atomic.
        if (command) send(command);
        if (addition) for (const value of addition) events.push(value);
        events = nextEvents;
        if (command?.action === "gain") gain = command.percent;
        if (command?.action === "play") plays++;
        transactions++;
        emit();
      };
      emit();
      return {
        ports: { i2c: {
          kind: "i2c-target", addresses: [YM_ADDRESS],
          write,
          read(count) {
            // Module status, not reads of YM2203's write-only FM registers.
            const result = new Uint8Array(count);
            const queued = events.length / 3;
            // Legacy four-byte readers get a saturated nonzero count. A six-
            // byte read exposes uint32 count bytes around the unchanged gain.
            const countValue = count >= 6 ? queued : Math.min(queued, 0xFFFF);
            const status = [1, countValue & 255, countValue >>> 8 & 255, gain, queued >>> 16 & 255, queued >>> 24];
            result.set(status.slice(0, count));
            return result;
          },
          writeMemory(reg, data) {
            if (data.length !== 1) throw new TypeError("YM2203 writeto_mem writes exactly one chip register.");
            write(Uint8Array.of(0, reg, data[0]!));
          },
          readMemory() { throw new TypeError("Use readfrom for module status; FM registers are not readable."); },
        } },
        reset,
      };
    },
  };
}

export const YM_PROTOTYPE_GRAPH = {
  schemaVersion: 1 as const,
  boardProfile: { id: "raspberry-pi-pico-2-w-v1", version: 1 },
  devices: [{ instanceId: YM_INSTANCE, deviceId: "org.micropython-web-lab.ym2203-prototype", deviceVersion: "0.1.0",
    ports: [{ portId: "i2c", endpoint: { kind: "i2c" as const, controller: 0, address: YM_ADDRESS } }] }],
};
