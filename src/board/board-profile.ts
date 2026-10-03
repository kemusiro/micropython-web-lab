export type BoardCapability =
  | "digital-gpio-v1"
  | "adc-input-v1"
  | "i2c-controller-v1"
  | "spi-controller-v1"
  | "uart-controller-v1"
  | "pwm-output-v1";

export type BoardPhysicalPinKind =
  | "gpio"
  | "ground"
  | "power"
  | "control"
  | "analog-reference";

export interface BoardPhysicalPin {
  readonly number: number;
  readonly name: string;
  readonly kind: BoardPhysicalPinKind;
  readonly gpioId?: string;
}

export interface ResolvedBoardPin {
  readonly resourceId: string;
  readonly runtimeId: string;
  readonly displayName: string;
  readonly gpioNumber: number | null;
  readonly physicalPin: number | null;
  readonly internal: boolean;
}

export interface ResolvedAdcChannel {
  readonly channel: number;
  readonly pin: ResolvedBoardPin;
}

export interface ResolvedI2cController {
  readonly id: number;
  readonly scl: ResolvedBoardPin;
  readonly sda: ResolvedBoardPin;
}

export interface ResolvedSpiController {
  readonly id: number;
  readonly sck: ResolvedBoardPin;
  readonly mosi: ResolvedBoardPin;
  readonly miso: ResolvedBoardPin;
}

export interface ResolvedUartController {
  readonly id: number;
  readonly tx: ResolvedBoardPin;
  readonly rx: ResolvedBoardPin;
}

export interface ResolvedPwmOutput {
  readonly pin: ResolvedBoardPin;
}

export interface I2cPinSelection {
  readonly scl?: ResolvedBoardPin;
  readonly sda?: ResolvedBoardPin;
}

export interface SpiPinSelection {
  readonly sck?: ResolvedBoardPin;
  readonly mosi?: ResolvedBoardPin;
  readonly miso?: ResolvedBoardPin;
}

export interface UartPinSelection {
  readonly tx?: ResolvedBoardPin;
  readonly rx?: ResolvedBoardPin;
}

export interface BoardProfile {
  readonly id: string;
  readonly version: number;
  readonly capabilities: readonly BoardCapability[];
  readonly physicalPins: readonly BoardPhysicalPin[];
  resolvePin(reference: unknown): ResolvedBoardPin;
  resolveAdc(source: unknown | ResolvedBoardPin): ResolvedAdcChannel;
  resolveI2c(id: unknown, pins?: I2cPinSelection): ResolvedI2cController;
  resolveSpi(id: unknown, pins?: SpiPinSelection): ResolvedSpiController;
  resolveUart(id: unknown, pins?: UartPinSelection): ResolvedUartController;
  resolvePwm(pin: ResolvedBoardPin): ResolvedPwmOutput;
}

type BoardBusKind = "i2c" | "spi" | "uart";

export class BoardResourceRegistry {
  readonly #claims = new Map<string, string>();

  claimPin(ownerId: string, pin: ResolvedBoardPin): void {
    this.#claim(ownerId, pin.resourceId);
  }

  claimBus(ownerId: string, kind: BoardBusKind, busId: number): void {
    if (!Number.isSafeInteger(busId) || busId < 0) {
      throw new RangeError("Bus id must be a non-negative integer.");
    }
    this.#claim(ownerId, `bus:${kind}:${busId}`);
  }

  claimI2cAddress(ownerId: string, busId: number, address: number): void {
    if (!Number.isSafeInteger(busId) || busId < 0) {
      throw new RangeError("I2C bus id must be a non-negative integer.");
    }
    if (!Number.isSafeInteger(address) || address < 0x08 || address > 0x77) {
      throw new RangeError("I2C address must be a 7-bit device address from 0x08 to 0x77.");
    }
    this.#claim(ownerId, `i2c:${busId}:${address}`);
  }

  release(ownerId: string): void {
    this.#assertOwnerId(ownerId);
    for (const [resourceId, owner] of this.#claims) {
      if (owner === ownerId) {
        this.#claims.delete(resourceId);
      }
    }
  }

  #claim(ownerId: string, resourceId: string): void {
    this.#assertOwnerId(ownerId);
    const currentOwner = this.#claims.get(resourceId);
    if (currentOwner !== undefined && currentOwner !== ownerId) {
      throw new Error(`Board resource ${resourceId} is already claimed by ${currentOwner}.`);
    }
    this.#claims.set(resourceId, ownerId);
  }

  #assertOwnerId(ownerId: string): void {
    if (ownerId.length === 0) {
      throw new TypeError("Board resource owner id must not be empty.");
    }
  }
}
