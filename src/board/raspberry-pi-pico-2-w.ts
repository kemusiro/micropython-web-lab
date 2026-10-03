import type {
  BoardCapability,
  BoardPhysicalPin,
  BoardProfile,
  I2cPinSelection,
  ResolvedAdcChannel,
  ResolvedBoardPin,
  ResolvedI2cController,
  ResolvedPwmOutput,
  ResolvedSpiController,
  ResolvedUartController,
  SpiPinSelection,
  UartPinSelection,
} from "./board-profile.ts";

export const RASPBERRY_PI_PICO_2_W_PROFILE_ID = "raspberry-pi-pico-2-w-v1" as const;
export const RASPBERRY_PI_PICO_2_W_PROFILE_VERSION = 1 as const;
export const LEGACY_PICO_2_W_PROFILE_ID = "pico-2-w" as const;

const EXPOSED_GPIO_NUMBERS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 26, 27, 28,
] as const;
const EXPOSED_GPIO_NUMBER_SET = new Set<number>(EXPOSED_GPIO_NUMBERS);

const GPIO_PHYSICAL_PINS = new Map<number, number>([
  [0, 1], [1, 2], [2, 4], [3, 5], [4, 6], [5, 7], [6, 9], [7, 10], [8, 11],
  [9, 12], [10, 14], [11, 15], [12, 16], [13, 17], [14, 19], [15, 20], [16, 21],
  [17, 22], [18, 24], [19, 25], [20, 26], [21, 27], [22, 29], [26, 31], [27, 32],
  [28, 34],
]);

const PHYSICAL_PINS: readonly BoardPhysicalPin[] = [
  gpio(1, 0), gpio(2, 1), other(3, "GND", "ground"), gpio(4, 2), gpio(5, 3),
  gpio(6, 4), gpio(7, 5), other(8, "GND", "ground"), gpio(9, 6), gpio(10, 7),
  gpio(11, 8), gpio(12, 9), other(13, "GND", "ground"), gpio(14, 10), gpio(15, 11),
  gpio(16, 12), gpio(17, 13), other(18, "GND", "ground"), gpio(19, 14), gpio(20, 15),
  gpio(21, 16), gpio(22, 17), other(23, "GND", "ground"), gpio(24, 18), gpio(25, 19),
  gpio(26, 20), gpio(27, 21), other(28, "GND", "ground"), gpio(29, 22),
  other(30, "RUN", "control"), gpio(31, 26), gpio(32, 27), other(33, "AGND", "ground"),
  gpio(34, 28), other(35, "ADC_VREF", "analog-reference"), other(36, "3V3(OUT)", "power"),
  other(37, "3V3_EN", "control"), other(38, "GND", "ground"),
  other(39, "VSYS", "power"), other(40, "VBUS", "power"),
];

const CAPABILITIES: readonly BoardCapability[] = [
  "digital-gpio-v1",
  "adc-input-v1",
  "i2c-controller-v1",
  "spi-controller-v1",
  "uart-controller-v1",
  "pwm-output-v1",
];

class RaspberryPiPico2WBoardProfile implements BoardProfile {
  readonly id = RASPBERRY_PI_PICO_2_W_PROFILE_ID;
  readonly version = RASPBERRY_PI_PICO_2_W_PROFILE_VERSION;
  readonly capabilities = CAPABILITIES;
  readonly physicalPins = PHYSICAL_PINS;

  resolvePin(reference: unknown): ResolvedBoardPin {
    if (reference === "LED") {
      return {
        resourceId: "pin:WL_GPIO0",
        runtimeId: "LED",
        displayName: "LED (WL_GPIO0)",
        gpioNumber: null,
        physicalPin: null,
        internal: true,
      };
    }

    const gpioNumber = normalizeGpioNumber(reference);
    if (!EXPOSED_GPIO_NUMBER_SET.has(gpioNumber)) {
      throw new RangeError(`Unsupported Pico 2 W GPIO pin: ${String(reference)}`);
    }
    return {
      resourceId: `pin:GP${gpioNumber}`,
      runtimeId: String(gpioNumber),
      displayName: `GP${gpioNumber}`,
      gpioNumber,
      physicalPin: GPIO_PHYSICAL_PINS.get(gpioNumber) ?? null,
      internal: false,
    };
  }

  resolveAdc(source: unknown | ResolvedBoardPin): ResolvedAdcChannel {
    const pin = isResolvedBoardPin(source)
      ? source
      : source === 0 || source === "0"
        ? this.resolvePin(26)
        : this.resolvePin(source);
    if (pin.resourceId !== "pin:GP26") {
      throw new RangeError(`Unsupported ADC source: ${formatAdcSource(source)}`);
    }
    return { channel: 0, pin };
  }

  resolveI2c(id: unknown, pins: I2cPinSelection = {}): ResolvedI2cController {
    const busId = normalizeBusId(id, "I2C");
    if (busId !== 0) {
      throw new RangeError(`Unsupported I2C bus: ${busId}`);
    }
    const scl = pins.scl ?? this.resolvePin(9);
    const sda = pins.sda ?? this.resolvePin(8);
    requirePin(scl, "pin:GP9", "I2C0 SCL", "GP9");
    requirePin(sda, "pin:GP8", "I2C0 SDA", "GP8");
    return { id: busId, scl, sda };
  }

  resolveSpi(id: unknown, pins: SpiPinSelection = {}): ResolvedSpiController {
    const busId = normalizeBusId(id, "SPI");
    if (busId !== 0) {
      throw new RangeError(`Unsupported SPI bus: ${busId}`);
    }
    const sck = pins.sck ?? this.resolvePin(6);
    const mosi = pins.mosi ?? this.resolvePin(7);
    const miso = pins.miso ?? this.resolvePin(4);
    requirePin(sck, "pin:GP6", "SPI0 SCK", "GP6");
    requirePin(mosi, "pin:GP7", "SPI0 MOSI", "GP7");
    requirePin(miso, "pin:GP4", "SPI0 MISO", "GP4");
    return { id: busId, sck, mosi, miso };
  }

  resolveUart(id: unknown, pins: UartPinSelection = {}): ResolvedUartController {
    const busId = normalizeBusId(id, "UART");
    if (busId !== 0) {
      throw new RangeError(`Unsupported UART bus: ${busId}`);
    }
    const tx = pins.tx ?? this.resolvePin(0);
    const rx = pins.rx ?? this.resolvePin(1);
    requirePin(tx, "pin:GP0", "UART0 TX", "GP0");
    requirePin(rx, "pin:GP1", "UART0 RX", "GP1");
    return { id: busId, tx, rx };
  }

  resolvePwm(pin: ResolvedBoardPin): ResolvedPwmOutput {
    if (pin.internal || pin.gpioNumber === null) {
      throw new RangeError(`Unsupported PWM pin: ${pin.displayName}`);
    }
    return { pin };
  }
}

export const RASPBERRY_PI_PICO_2_W_BOARD_PROFILE: BoardProfile =
  new RaspberryPiPico2WBoardProfile();

export function resolveBoardProfile(profileId: string, version = 1): BoardProfile {
  if (
    (profileId === RASPBERRY_PI_PICO_2_W_PROFILE_ID || profileId === LEGACY_PICO_2_W_PROFILE_ID) &&
    version === RASPBERRY_PI_PICO_2_W_PROFILE_VERSION
  ) {
    return RASPBERRY_PI_PICO_2_W_BOARD_PROFILE;
  }
  throw new RangeError(`Unsupported board profile: ${profileId}@${version}`);
}

function gpio(number: number, gpioNumber: number): BoardPhysicalPin {
  return { number, name: `GP${gpioNumber}`, kind: "gpio", gpioId: `GP${gpioNumber}` };
}

function other(
  number: number,
  name: string,
  kind: Exclude<BoardPhysicalPin["kind"], "gpio">,
): BoardPhysicalPin {
  return { number, name, kind };
}

function normalizeGpioNumber(reference: unknown): number {
  if (typeof reference === "number") {
    if (Number.isSafeInteger(reference) && reference >= 0) {
      return reference;
    }
    throw new TypeError("Pin id must be a non-negative integer or supported string.");
  }
  if (typeof reference !== "string" || reference.length === 0) {
    throw new TypeError("Pin id must be a non-empty string or number.");
  }
  const match = /^(?:GP)?(\d+)$/.exec(reference);
  if (match === null) {
    throw new RangeError(`Unsupported Pico 2 W GPIO pin: ${reference}`);
  }
  return Number(match[1]);
}

function normalizeBusId(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} bus id must be a non-negative integer.`);
  }
  return value;
}

function requirePin(
  pin: ResolvedBoardPin,
  resourceId: string,
  label: string,
  expected: string,
): void {
  if (pin.resourceId !== resourceId) {
    throw new RangeError(`${label} must use ${expected}, received ${pin.displayName}.`);
  }
}

function isResolvedBoardPin(value: unknown): value is ResolvedBoardPin {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<ResolvedBoardPin>).resourceId === "string"
  );
}

function formatAdcSource(source: unknown): string {
  return isResolvedBoardPin(source) ? source.runtimeId : String(source);
}
