export const DEVICE_API_VERSION = 1 as const;

export type DigitalValue = 0 | 1;
export type DeviceStateValue = string | number | boolean | null;
export type DeviceState = Readonly<Record<string, DeviceStateValue>>;

export interface DeviceAction {
  readonly controlId: string;
  readonly value: DeviceStateValue;
}

export interface DeviceLimits {
  readonly maxI2cTransferBytes: number;
  readonly maxSpiTransferBytes: number;
  readonly maxUartTransferBytes: number;
  readonly maxUartBufferedBytes: number;
  readonly maxStateBytes: number;
}

export const DEFAULT_DEVICE_LIMITS: DeviceLimits = Object.freeze({
  maxI2cTransferBytes: 256,
  maxSpiTransferBytes: 256,
  maxUartTransferBytes: 256,
  maxUartBufferedBytes: 4_096,
  maxStateBytes: 16 * 1_024,
});

export interface DeviceBoardContext {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly capabilities: readonly string[];
}

export interface DeviceClock {
  monotonicMilliseconds(): number;
}

export interface DeviceContext {
  readonly instanceId: string;
  readonly board: DeviceBoardContext;
  readonly limits: DeviceLimits;
  readonly clock?: DeviceClock;
  emitState(state: DeviceState): void;
}

export type DevicePortKind =
  | "gpio-observer"
  | "gpio-driver"
  | "adc-source"
  | "i2c-target"
  | "spi-target"
  | "uart-peer"
  | "pwm-observer";

export interface DevicePortManifestV1 {
  readonly id: string;
  readonly kind: DevicePortKind;
  readonly defaultAddress?: number;
}

export interface DeviceManifestV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly deviceApiVersion: 1;
  readonly name: string;
  readonly description: string;
  readonly license: string;
  readonly entrypoint: string;
  readonly requires: {
    readonly boardCapabilities: readonly string[];
  };
  readonly ports: readonly DevicePortManifestV1[];
}

export interface DeviceDefinition {
  readonly manifest: DeviceManifestV1;
  create(context: DeviceContext): DeviceModel;
}

export interface DeviceModel {
  readonly ports: Readonly<Record<string, DevicePort>>;
  reset(): void;
  handleAction?(action: DeviceAction): void;
  dispose?(): void;
}

export interface GpioObserverPort {
  readonly kind: "gpio-observer";
  write(value: DigitalValue): void;
}

export interface GpioDriverPort {
  readonly kind: "gpio-driver";
  read(): DigitalValue;
}

export interface AdcSourcePort {
  readonly kind: "adc-source";
  readU16(): number;
}

export interface I2cTargetPort {
  readonly kind: "i2c-target";
  readonly addresses: readonly number[];
  read(byteCount: number): Uint8Array;
  write(data: Uint8Array): void;
  readMemory(memoryAddress: number, byteCount: number): Uint8Array;
  writeMemory(memoryAddress: number, data: Uint8Array): void;
}

export interface SpiConfiguration {
  readonly baudrate: number;
  readonly polarity: 0 | 1;
  readonly phase: 0 | 1;
  readonly firstBit: "msb" | "lsb";
  readonly bits: 8;
}

export interface SpiTargetPort {
  readonly kind: "spi-target";
  configure(configuration: SpiConfiguration): void;
  transfer(writeData: Uint8Array): Uint8Array;
}

export interface UartConfiguration {
  readonly baudrate: number;
  readonly bits: 8;
  readonly parity: "none" | "even" | "odd";
  readonly stop: 1 | 2;
}

export interface UartPeerPort {
  readonly kind: "uart-peer";
  configure(configuration: UartConfiguration): void;
  writeFromBoard(data: Uint8Array): number;
  availableToBoard(): number;
  readForBoard(maxBytes: number): Uint8Array;
}

export interface PwmSignal {
  readonly enabled: boolean;
  readonly frequencyHz: number;
  readonly dutyU16: number;
  readonly inverted: boolean;
}

export interface PwmObserverPort {
  readonly kind: "pwm-observer";
  update(signal: PwmSignal): void;
}

export type DevicePort =
  | GpioObserverPort
  | GpioDriverPort
  | AdcSourcePort
  | I2cTargetPort
  | SpiTargetPort
  | UartPeerPort
  | PwmObserverPort;

export type DevicePortOfKind<Kind extends DevicePortKind> = Extract<
  DevicePort,
  { readonly kind: Kind }
>;
