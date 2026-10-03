import { describe, expect, it } from "vitest";

import { runPico2WConformance } from "@micropython-web-lab/device-testkit";

import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../board/raspberry-pi-pico-2-w";
import { DeviceHost, type DeviceStateEvent } from "../device-api/device-host";
import {
  SSD1331_HEIGHT,
  SSD1331_WIDTH,
  createSsd1331Definition,
} from "./ssd1331";

const BOARD_CONTEXT = {
  profileId: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.id,
  profileVersion: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.version,
  capabilities: RASPBERRY_PI_PICO_2_W_BOARD_PROFILE.capabilities,
};

describe("QT095B SSD1331 Device API model", () => {
  it("passes the Pico 2 W Device API conformance test", () => {
    expect(runPico2WConformance(createSsd1331Definition())).toMatchObject({
      ok: true,
      issues: [],
    });
  });

  it("accepts command and RGB565 data transactions over SPI", () => {
    const events: DeviceStateEvent[] = [];
    const host = new DeviceHost(BOARD_CONTEXT, (event) => events.push(event));
    host.create("display", createSsd1331Definition());
    const spi = host.getPort("display", "spi", "spi-target");
    const cs = host.getPort("display", "cs", "gpio-observer");
    const dc = host.getPort("display", "dc", "gpio-observer");

    spi.configure({ baudrate: 8_000_000, polarity: 0, phase: 0, firstBit: "msb", bits: 8 });
    send(cs, dc, spi, 0, Uint8Array.of(0xae));
    send(cs, dc, spi, 0, Uint8Array.of(0xa0, 0x72));
    send(cs, dc, spi, 0, Uint8Array.of(0x15, 0, 2));
    send(cs, dc, spi, 0, Uint8Array.of(0x75, 0, 0));
    send(cs, dc, spi, 1, Uint8Array.of(0xf8, 0x00, 0x07, 0xe0, 0x00, 0x1f));
    send(cs, dc, spi, 0, Uint8Array.of(0xaf));

    const state = events.at(-1)?.state;
    expect(state).toMatchObject({
      width: SSD1331_WIDTH,
      height: SSD1331_HEIGHT,
      displayOn: true,
      transferCount: 6,
      dataBytes: 6,
      baudrate: 8_000_000,
      mode: 0,
    });
    const frame = decodeBase64(String(state?.framebuffer));
    expect(frame).toHaveLength(SSD1331_WIDTH * SSD1331_HEIGHT);
    expect([...frame.slice(0, 3)]).toEqual([0xe0, 0x1c, 0x03]);
  });

  it("ignores unselected transfers and clears the display on reset", () => {
    const events: DeviceStateEvent[] = [];
    const host = new DeviceHost(BOARD_CONTEXT, (event) => events.push(event));
    host.create("display", createSsd1331Definition());
    const spi = host.getPort("display", "spi", "spi-target");
    const cs = host.getPort("display", "cs", "gpio-observer");
    const dc = host.getPort("display", "dc", "gpio-observer");
    const reset = host.getPort("display", "reset", "gpio-observer");

    spi.transfer(Uint8Array.of(0xaf));
    expect(events.at(-1)?.state.displayOn).toBe(false);

    send(cs, dc, spi, 0, Uint8Array.of(0xaf));
    expect(events.at(-1)?.state.displayOn).toBe(true);
    reset.write(0);
    reset.write(1);
    const state = events.at(-1)?.state;
    expect(state?.displayOn).toBe(false);
    expect(decodeBase64(String(state?.framebuffer)).every((value) => value === 0)).toBe(true);
  });

  it("draws and clears bounded SSD1331 graphics commands", () => {
    const events: DeviceStateEvent[] = [];
    const host = new DeviceHost(BOARD_CONTEXT, (event) => events.push(event));
    host.create("display", createSsd1331Definition());
    const spi = host.getPort("display", "spi", "spi-target");
    const cs = host.getPort("display", "cs", "gpio-observer");
    const dc = host.getPort("display", "dc", "gpio-observer");

    send(cs, dc, spi, 0, Uint8Array.of(0x26, 0x01));
    send(
      cs,
      dc,
      spi,
      0,
      Uint8Array.of(0x22, 1, 1, 3, 3, 63, 0, 0, 0, 0, 63),
    );
    send(cs, dc, spi, 0, Uint8Array.of(0xaf));
    let frame = decodeBase64(String(events.at(-1)?.state.framebuffer));
    expect(frame[1 * SSD1331_WIDTH + 1]).toBe(0xe0);
    expect(frame[2 * SSD1331_WIDTH + 2]).toBe(0x03);

    send(cs, dc, spi, 0, Uint8Array.of(0x25, 1, 1, 3, 3));
    frame = decodeBase64(String(events.at(-1)?.state.framebuffer));
    expect(frame[1 * SSD1331_WIDTH + 1]).toBe(0);
    expect(frame[2 * SSD1331_WIDTH + 2]).toBe(0);
  });
});

function send(
  cs: { write(value: 0 | 1): void },
  dc: { write(value: 0 | 1): void },
  spi: { transfer(data: Uint8Array): Uint8Array },
  dataMode: 0 | 1,
  data: Uint8Array,
): void {
  dc.write(dataMode);
  cs.write(0);
  spi.transfer(data);
  cs.write(1);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
