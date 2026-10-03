import { describe, expect, it } from "vitest";

import {
  ManualDeviceClock,
  runPico2WConformance,
} from "@micropython-web-lab/device-testkit";

import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../board/raspberry-pi-pico-2-w";
import { DeviceHost, type DeviceStateEvent } from "../device-api/device-host";
import type { UartPeerPort } from "../device-api/types";
import {
  createGt502MggDefinition,
  createGt502MggNmeaSnapshot,
} from "./gt-502mgg";

const BOARD_CONTEXT = {
  profileId: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.id,
  profileVersion: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.version,
  capabilities: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.capabilities,
};

describe("GT-502MGG-N Device API model", () => {
  it("passes the Pico 2 W Device API conformance test", () => {
    expect(runPico2WConformance(createGt502MggDefinition())).toMatchObject({
      ok: true,
      issues: [],
    });
  });

  it("moves from acquisition to a valid fix and emits a checksummed snapshot each second", () => {
    const clock = new ManualDeviceClock();
    const events: DeviceStateEvent[] = [];
    const host = new DeviceHost(BOARD_CONTEXT, (event) => events.push(event), undefined, clock);
    host.create("gps", createGt502MggDefinition());
    const uart = host.getPort("gps", "uart", "uart-peer");
    uart.configure({ baudrate: 9_600, bits: 8, parity: "none", stop: 1 });

    const acquiring = readSnapshot(uart);
    expect(acquiring[0]).toContain("$GNGGA,030405.000,3540.87416,N,13946.02750,E,0,00");
    expect(acquiring[1]).toContain("$GNRMC,030405.000,V,3540.87416,N,13946.02750,E");

    clock.advance(3_000);
    const fixed = readSnapshot(uart);
    expect(fixed[0]).toContain("$GNGGA,030408.000,3540.87416,N,13946.02750,E,1,08");
    expect(fixed[1]).toContain("$GNRMC,030408.000,A,3540.87416,N,13946.02750,E");
    expect([...acquiring, ...fixed].every(hasValidNmeaChecksum)).toBe(true);
    expect(events.at(-1)?.state).toMatchObject({
      acquisitionState: "fixed",
      fix: true,
      satellites: 8,
      nmeaRateHz: 1,
      skippedSnapshots: 2,
    });

    clock.advance(1_000);
    expect(readSnapshot(uart)[0]).toContain("$GNGGA,030409.000");
  });

  it("replaces pending output when the simulated position changes and restarts acquisition on reset", () => {
    const clock = new ManualDeviceClock();
    const events: DeviceStateEvent[] = [];
    const host = new DeviceHost(BOARD_CONTEXT, (event) => events.push(event), undefined, clock);
    host.create("gps", createGt502MggDefinition());
    const uart = host.getPort("gps", "uart", "uart-peer");
    uart.configure({ baudrate: 9_600, bits: 8, parity: "none", stop: 1 });

    clock.advance(3_000);
    host.handleAction("gps", { controlId: "position", value: "43.06417,141.34694,18.5" });
    const data = new TextDecoder().decode(uart.readForBoard(256));
    expect(data).toContain("4303.85020,N,14120.81640,E");
    expect(events.at(-1)?.state).toMatchObject({
      latitude: 43.06417,
      longitude: 141.34694,
      altitudeMeters: 18.5,
      bufferedBytes: 0,
    });

    host.reset("gps");
    expect(uart.availableToBoard()).toBe(0);
    expect(events.at(-1)?.state).toMatchObject({
      latitude: 35.681236,
      longitude: 139.767125,
      acquisitionState: "acquiring",
      fix: false,
      sentenceCount: 0,
      commandBytes: 0,
    });
  });

  it("provides a polled PPS pulse after acquisition", () => {
    const clock = new ManualDeviceClock();
    const host = new DeviceHost(BOARD_CONTEXT, () => undefined, undefined, clock);
    host.create("gps", createGt502MggDefinition());
    const pps = host.getPort("gps", "pps", "gpio-driver");

    expect(pps.read()).toBe(0);
    clock.advance(2_999);
    expect(pps.read()).toBe(0);
    clock.advance(1);
    expect(pps.read()).toBe(1);
    clock.advance(99);
    expect(pps.read()).toBe(1);
    clock.advance(1);
    expect(pps.read()).toBe(0);
    clock.advance(900);
    expect(pps.read()).toBe(1);
  });

  it("preserves the previous 115200-bps UART echo sample", () => {
    const host = new DeviceHost(BOARD_CONTEXT);
    host.create("gps", createGt502MggDefinition());
    const uart = host.getPort("gps", "uart", "uart-peer");
    uart.configure({ baudrate: 115_200, bits: 8, parity: "none", stop: 1 });
    expect(uart.writeFromBoard(new TextEncoder().encode("echo"))).toBe(4);
    expect(new TextDecoder().decode(uart.readForBoard(4))).toBe("echo");
  });

  it("rejects invalid positions", () => {
    expect(() => createGt502MggNmeaSnapshot(91, 0, 0)).toThrow("latitude");
    const host = new DeviceHost(BOARD_CONTEXT);
    host.create("gps", createGt502MggDefinition());
    expect(() =>
      host.handleAction("gps", { controlId: "position", value: "35,181,0" }),
    ).toThrow("longitude");
  });
});

function hasValidNmeaChecksum(sentence: string): boolean {
  const separator = sentence.lastIndexOf("*");
  if (!sentence.startsWith("$") || separator < 0) {
    return false;
  }
  let checksum = 0;
  for (const character of sentence.slice(1, separator)) {
    checksum ^= character.charCodeAt(0);
  }
  return sentence.slice(separator + 1) === checksum.toString(16).toUpperCase().padStart(2, "0");
}

function readSnapshot(uart: UartPeerPort): string[] {
  const data = new TextDecoder().decode(uart.readForBoard(256));
  return data.trim().split("\r\n");
}
