import type {
  DeviceContext,
  DeviceDefinition,
  DeviceModel,
  PwmSignal,
} from "../device-api/types.ts";

type ColorChannel = "red" | "green" | "blue";

const CHANNELS: readonly ColorChannel[] = Object.freeze(["red", "green", "blue"]);
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function createOstamc5a31aVvDefinition(): DeviceDefinition {
  return {
    manifest: {
      schemaVersion: 1,
      id: "org.micropython-web-lab.ostamc5a31a-vv",
      version: "0.1.0",
      deviceApiVersion: 1,
      name: "OSTAMC5A31A-VV Resistor-Integrated RGB LED",
      description:
        "Akizuki 117578 / OptoSupply common-cathode RGB LED driven by three PWM channels",
      license: "MIT",
      entrypoint: "./dist/device.js",
      requires: { boardCapabilities: ["pwm-output-v1"] },
      ports: CHANNELS.map((id) => ({ id, kind: "pwm-observer" as const })),
    },
    create: createOstamc5a31aVvModel,
  };
}

function createOstamc5a31aVvModel(context: DeviceContext): DeviceModel {
  const signals: Record<ColorChannel, PwmSignal> = {
    red: defaultSignal(),
    green: defaultSignal(),
    blue: defaultSignal(),
  };
  let updateCount = 0;

  const emit = (): void => {
    const redDutyU16 = effectiveDuty(signals.red);
    const greenDutyU16 = effectiveDuty(signals.green);
    const blueDutyU16 = effectiveDuty(signals.blue);
    const red = dutyToU8(redDutyU16);
    const green = dutyToU8(greenDutyU16);
    const blue = dutyToU8(blueDutyU16);
    context.emitState({
      active: redDutyU16 > 0 || greenDutyU16 > 0 || blueDutyU16 > 0,
      colorHex: `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`,
      framebuffer: encodeOneByteBase64(rgb332(red, green, blue)),
      redDutyU16,
      greenDutyU16,
      blueDutyU16,
      redFrequencyHz: signals.red.frequencyHz,
      greenFrequencyHz: signals.green.frequencyHz,
      blueFrequencyHz: signals.blue.frequencyHz,
      updateCount,
    });
  };
  const port = (channel: ColorChannel) => ({
    kind: "pwm-observer" as const,
    update(signal: PwmSignal): void {
      signals[channel] = { ...signal };
      updateCount += 1;
      emit();
    },
  });

  emit();
  return {
    ports: {
      red: port("red"),
      green: port("green"),
      blue: port("blue"),
    },
    reset(): void {
      for (const channel of CHANNELS) {
        signals[channel] = defaultSignal();
      }
      updateCount = 0;
      emit();
    },
  };
}

function defaultSignal(): PwmSignal {
  return { enabled: false, frequencyHz: 1_000, dutyU16: 0, inverted: false };
}

function effectiveDuty(signal: PwmSignal): number {
  if (!signal.enabled) {
    return 0;
  }
  return signal.inverted ? 65_535 - signal.dutyU16 : signal.dutyU16;
}

function dutyToU8(dutyU16: number): number {
  return Math.round((dutyU16 / 65_535) * 255);
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function rgb332(red: number, green: number, blue: number): number {
  const red3 = Math.round((red / 255) * 7);
  const green3 = Math.round((green / 255) * 7);
  const blue2 = Math.round((blue / 255) * 3);
  return (red3 << 5) | (green3 << 2) | blue2;
}

function encodeOneByteBase64(value: number): string {
  return `${BASE64_ALPHABET[value >> 2]}${BASE64_ALPHABET[(value & 0x03) << 4]}==`;
}
