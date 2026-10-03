import { describe, expect, it } from "vitest";

import { BoardResourceRegistry } from "./board-profile";
import {
  LEGACY_PICO_2_W_PROFILE_ID,
  RASPBERRY_PI_PICO_2_W_BOARD_PROFILE,
  RASPBERRY_PI_PICO_2_W_PROFILE_ID,
  resolveBoardProfile,
} from "./raspberry-pi-pico-2-w";

const profile = RASPBERRY_PI_PICO_2_W_BOARD_PROFILE;

describe("Raspberry Pi Pico 2 W Board Profile", () => {
  it("describes physical GPIO, ground, power, control, and internal LED resources", () => {
    expect(profile.id).toBe(RASPBERRY_PI_PICO_2_W_PROFILE_ID);
    expect(profile.version).toBe(1);
    expect(profile.physicalPins).toHaveLength(40);
    expect(profile.physicalPins[0]).toEqual({
      number: 1,
      name: "GP0",
      kind: "gpio",
      gpioId: "GP0",
    });
    expect(profile.physicalPins[2]).toEqual({ number: 3, name: "GND", kind: "ground" });
    expect(profile.physicalPins[29]).toEqual({ number: 30, name: "RUN", kind: "control" });
    expect(profile.physicalPins[39]).toEqual({ number: 40, name: "VBUS", kind: "power" });
    expect(profile.resolvePin("LED")).toEqual(
      expect.objectContaining({
        resourceId: "pin:WL_GPIO0",
        runtimeId: "LED",
        physicalPin: null,
        internal: true,
      }),
    );
  });

  it("resolves exposed GPIO aliases and rejects non-existent or non-exposed pins", () => {
    expect(profile.resolvePin(15)).toEqual(
      expect.objectContaining({ resourceId: "pin:GP15", runtimeId: "15", physicalPin: 20 }),
    );
    expect(profile.resolvePin("GP26")).toEqual(
      expect.objectContaining({ resourceId: "pin:GP26", physicalPin: 31 }),
    );
    expect(() => profile.resolvePin(23)).toThrow("Unsupported Pico 2 W GPIO pin");
    expect(() => profile.resolvePin("unknown")).toThrow("Unsupported Pico 2 W GPIO pin");
    expect(() => profile.resolvePin(1.5)).toThrow("Pin id");
  });

  it("resolves ADC0 through its channel, GPIO, or resolved Pin", () => {
    expect(profile.resolveAdc(0)).toEqual(
      expect.objectContaining({ channel: 0, pin: expect.objectContaining({ runtimeId: "26" }) }),
    );
    expect(profile.resolveAdc(26).channel).toBe(0);
    expect(profile.resolveAdc(profile.resolvePin(26)).channel).toBe(0);
    expect(() => profile.resolveAdc(27)).toThrow("Unsupported ADC source: 27");
  });

  it("validates the initial I2C0, SPI0, UART0, and PWM mappings", () => {
    expect(profile.resolveI2c(0)).toEqual(
      expect.objectContaining({
        id: 0,
        scl: expect.objectContaining({ resourceId: "pin:GP9" }),
        sda: expect.objectContaining({ resourceId: "pin:GP8" }),
      }),
    );
    expect(() => profile.resolveI2c(0, { scl: profile.resolvePin(7) })).toThrow(
      "I2C0 SCL must use GP9",
    );
    expect(() => profile.resolveI2c(1)).toThrow("Unsupported I2C bus: 1");

    expect(profile.resolveSpi(0)).toEqual(
      expect.objectContaining({
        sck: expect.objectContaining({ resourceId: "pin:GP6" }),
        mosi: expect.objectContaining({ resourceId: "pin:GP7" }),
        miso: expect.objectContaining({ resourceId: "pin:GP4" }),
      }),
    );
    expect(() => profile.resolveSpi(0, { sck: profile.resolvePin(10) })).toThrow(
      "SPI0 SCK must use GP6",
    );
    expect(() => profile.resolveSpi(1)).toThrow("Unsupported SPI bus: 1");

    expect(profile.resolveUart(0)).toEqual(
      expect.objectContaining({
        tx: expect.objectContaining({ resourceId: "pin:GP0" }),
        rx: expect.objectContaining({ resourceId: "pin:GP1" }),
      }),
    );
    expect(() => profile.resolveUart(0, { tx: profile.resolvePin(4) })).toThrow(
      "UART0 TX must use GP0",
    );
    expect(() => profile.resolveUart(1)).toThrow("Unsupported UART bus: 1");

    expect(profile.resolvePwm(profile.resolvePin(2)).pin.resourceId).toBe("pin:GP2");
    expect(() => profile.resolvePwm(profile.resolvePin("LED"))).toThrow("Unsupported PWM pin");
  });

  it("accepts the legacy book profile id without making it canonical", () => {
    expect(resolveBoardProfile(LEGACY_PICO_2_W_PROFILE_ID)).toBe(profile);
    expect(resolveBoardProfile(RASPBERRY_PI_PICO_2_W_PROFILE_ID)).toBe(profile);
    expect(() => resolveBoardProfile("other-board")).toThrow("Unsupported board profile");
  });

  it("detects conflicting pin, bus, and I2C address claims", () => {
    const resources = new BoardResourceRegistry();
    resources.claimPin("device-a", profile.resolvePin(15));
    resources.claimBus("device-a", "uart", 0);
    resources.claimI2cAddress("device-a", 0, 0x50);

    expect(() => resources.claimPin("device-b", profile.resolvePin(15))).toThrow(
      "already claimed by device-a",
    );
    expect(() => resources.claimBus("device-b", "uart", 0)).toThrow(
      "already claimed by device-a",
    );
    expect(() => resources.claimI2cAddress("device-b", 0, 0x50)).toThrow(
      "already claimed by device-a",
    );

    resources.release("device-a");
    expect(() => resources.claimPin("device-b", profile.resolvePin(15))).not.toThrow();
    expect(() => resources.claimI2cAddress("device-b", 0, 0x07)).toThrow("0x08 to 0x77");
  });
});
