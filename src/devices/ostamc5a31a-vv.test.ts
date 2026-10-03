import { describe, expect, it } from "vitest";

import { runPico2WConformance } from "@micropython-web-lab/device-testkit";

import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../board/raspberry-pi-pico-2-w";
import { DeviceHost, type DeviceStateEvent } from "../device-api/device-host";
import { createOstamc5a31aVvDefinition } from "./ostamc5a31a-vv";

const BOARD_CONTEXT = {
  profileId: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.id,
  profileVersion: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.version,
  capabilities: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.capabilities,
};

describe("OSTAMC5A31A-VV Device API model", () => {
  it("passes the Pico 2 W Device API conformance test", () => {
    expect(runPico2WConformance(createOstamc5a31aVvDefinition())).toMatchObject({
      ok: true,
      issues: [],
    });
  });

  it("mixes three active-high PWM duties into a deterministic RGB color", () => {
    const events: DeviceStateEvent[] = [];
    const host = new DeviceHost(BOARD_CONTEXT, (event) => events.push(event));
    host.create("rgb", createOstamc5a31aVvDefinition());
    const signal = (dutyU16: number) => ({
      enabled: true,
      frequencyHz: 1_000,
      dutyU16,
      inverted: false,
    }) as const;

    host.getPort("rgb", "red", "pwm-observer").update(signal(65_535));
    host.getPort("rgb", "green", "pwm-observer").update(signal(16_448));
    host.getPort("rgb", "blue", "pwm-observer").update(signal(46_260));

    expect(events.at(-1)?.state).toMatchObject({
      active: true,
      colorHex: "#ff40b4",
      redDutyU16: 65_535,
      greenDutyU16: 16_448,
      blueDutyU16: 46_260,
      updateCount: 3,
    });
    expect(events.at(-1)?.state.framebuffer).toBe("6g==");
  });

  it("turns disabled channels off, honors inversion, and resets", () => {
    const events: DeviceStateEvent[] = [];
    const host = new DeviceHost(BOARD_CONTEXT, (event) => events.push(event));
    host.create("rgb", createOstamc5a31aVvDefinition());
    const red = host.getPort("rgb", "red", "pwm-observer");
    red.update({ enabled: false, frequencyHz: 2_000, dutyU16: 65_535, inverted: false });
    expect(events.at(-1)?.state).toMatchObject({ active: false, colorHex: "#000000" });

    red.update({ enabled: true, frequencyHz: 2_000, dutyU16: 0, inverted: true });
    expect(events.at(-1)?.state).toMatchObject({ active: true, colorHex: "#ff0000" });

    host.reset("rgb");
    expect(events.at(-1)?.state).toMatchObject({
      active: false,
      colorHex: "#000000",
      updateCount: 0,
    });
  });
});
