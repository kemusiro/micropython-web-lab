import type {
  BoardProfile,
  I2cPinSelection,
  ResolvedBoardPin,
  SpiPinSelection,
  UartPinSelection,
} from "../board/board-profile";
import { RASPBERRY_PI_PICO_2_W_BOARD_PROFILE } from "../board/raspberry-pi-pico-2-w";
import type {
  PwmObserverPort,
  PwmSignal,
  SpiConfiguration,
  SpiTargetPort,
  UartConfiguration,
  UartPeerPort,
} from "../device-api/types";
import {
  VirtualGpioBoard,
  type VirtualAdcChannel,
  type VirtualGpioPin,
  type VirtualPinMode,
  type VirtualPinValue,
} from "./virtual-gpio";
import { VIRTUAL_I2C_BUS_ID, type VirtualI2cBus } from "./virtual-i2c";

export const MACHINE_PIN_IN = 0 as const;
export const MACHINE_PIN_OUT = 1 as const;
export const MACHINE_PIN_PULL_UP = 1 as const;
export const MACHINE_PIN_PULL_DOWN = 2 as const;
export const MACHINE_SPI_MSB = 0 as const;
export const MACHINE_SPI_LSB = 1 as const;

export interface MachinePin {
  init(mode: unknown, pull?: unknown, value?: unknown): void;
  value(): VirtualPinValue;
  value(nextValue: unknown): void;
  on(): void;
  off(): void;
  toggle(): void;
}

export interface MachinePinFactory {
  (pinId: unknown, mode?: unknown, pull?: unknown, value?: unknown): MachinePin;
  IN: typeof MACHINE_PIN_IN;
  OUT: typeof MACHINE_PIN_OUT;
  PULL_UP: typeof MACHINE_PIN_PULL_UP;
  PULL_DOWN: typeof MACHINE_PIN_PULL_DOWN;
}

export interface MachineAdc {
  read_u16(): number;
}

export interface MachineAdcFactory {
  (source: unknown): MachineAdc;
}

export interface MachineI2c {
  scan(): unknown;
  readfrom(address: unknown, byteCount: unknown, stop?: unknown): unknown;
  writeto(address: unknown, buffer: unknown, stop?: unknown): number;
  readfrom_mem(
    address: unknown,
    memoryAddress: unknown,
    byteCount: unknown,
    addressSize?: unknown,
  ): unknown;
  writeto_mem(
    address: unknown,
    memoryAddress: unknown,
    buffer: unknown,
    addressSize?: unknown,
  ): void;
}

export interface MachineI2cFactory {
  (id?: unknown, options?: unknown): MachineI2c;
}

export interface MachineSpi {
  init(baudrateOrOptions?: unknown, options?: unknown): void;
  deinit(): void;
  read(byteCount: unknown, write?: unknown): unknown;
  readinto(buffer: unknown, write?: unknown): void;
  write(buffer: unknown): void;
  write_readinto(writeBuffer: unknown, readBuffer: unknown): void;
  _readinto(byteCount: unknown, write?: unknown): unknown;
  _write_readinto(writeBuffer: unknown): unknown;
}

export interface MachineSpiFactory {
  (id?: unknown, baudrateOrOptions?: unknown, options?: unknown): MachineSpi;
  MSB: typeof MACHINE_SPI_MSB;
  LSB: typeof MACHINE_SPI_LSB;
}

export interface MachineUart {
  init(baudrateOrOptions?: unknown, options?: unknown): void;
  deinit(): void;
  any(): number;
  read(byteCount?: unknown): unknown;
  readinto(buffer: unknown, byteCount?: unknown): number | null;
  readline(): unknown;
  write(buffer: unknown): number;
  _readinto(byteCount: unknown): unknown;
}

export interface MachineUartFactory {
  (id?: unknown, baudrateOrOptions?: unknown, options?: unknown): MachineUart;
}

export interface MachinePwm {
  init(options?: unknown): void;
  deinit(): void;
  freq(): number;
  freq(value: unknown): void;
  duty_u16(): number;
  duty_u16(value: unknown): void;
  duty_ns(): number;
  duty_ns(value: unknown): void;
}

export interface MachinePwmFactory {
  (pin: unknown, options?: unknown): MachinePwm;
}

export interface MachineModuleOptions {
  boardProfile?: BoardProfile;
  i2cBus?: VirtualI2cBus;
  spiTarget?: SpiTargetPort;
  uartPeer?: UartPeerPort;
  pwmObserver?: (pinId: string) => PwmObserverPort | null;
  toPythonBytes?: (bytes: Iterable<number>) => unknown;
  toPythonList?: (values: readonly number[]) => unknown;
}

export interface MachineModule {
  Pin: MachinePinFactory;
  ADC: MachineAdcFactory;
  I2C: MachineI2cFactory;
  SPI: MachineSpiFactory;
  UART: MachineUartFactory;
  PWM: MachinePwmFactory;
}

export function createMachineModule(
  board: VirtualGpioBoard,
  options: MachineModuleOptions = {},
): MachineModule {
  const boardProfile = options.boardProfile ?? RASPBERRY_PI_PICO_2_W_BOARD_PROFILE;
  const resolvedPins = new WeakMap<object, ResolvedBoardPin>();
  const Pin: MachinePinFactory = Object.assign(
    (pinId: unknown, mode: unknown = MACHINE_PIN_IN, pull?: unknown, value?: unknown) => {
      normalizePull(pull);
      const resolvedPin = boardProfile.resolvePin(pinId);
      const pin = board.openPin(resolvedPin.runtimeId, normalizeMode(mode));
      const adapter = new MachinePinAdapter(pin);
      resolvedPins.set(adapter, resolvedPin);
      if (value !== undefined) {
        adapter.value(value);
      }
      return adapter;
    },
    {
      IN: MACHINE_PIN_IN,
      OUT: MACHINE_PIN_OUT,
      PULL_UP: MACHINE_PIN_PULL_UP,
      PULL_DOWN: MACHINE_PIN_PULL_DOWN,
    },
  );
  const ADC: MachineAdcFactory = (source: unknown) => {
    const resolvedPin =
      typeof source === "object" && source !== null ? resolvedPins.get(source) : undefined;
    const channel = boardProfile.resolveAdc(resolvedPin ?? source);
    return new MachineAdcAdapter(board.openAdc(channel.pin.runtimeId));
  };
  const I2C: MachineI2cFactory = (id: unknown = VIRTUAL_I2C_BUS_ID, i2cOptions?: unknown) => {
    if (options.i2cBus === undefined) {
      throw new Error("The virtual I2C bus is not configured.");
    }
    const controller = boardProfile.resolveI2c(
      id,
      normalizeI2cOptions(i2cOptions, resolvedPins),
    );
    if (controller.id !== options.i2cBus.id) {
      throw new RangeError(`Virtual I2C bus ${controller.id} is not configured.`);
    }
    return new MachineI2cAdapter(
      options.i2cBus,
      options.toPythonBytes ?? ((bytes) => Uint8Array.from(bytes)),
      options.toPythonList ?? ((values) => [...values]),
    );
  };

  const SPI: MachineSpiFactory = Object.assign(
    (id: unknown = 0, baudrateOrOptions?: unknown, spiOptions?: unknown) => {
      if (options.spiTarget === undefined) {
        throw new Error("The virtual SPI target is not configured.");
      }
      const normalized = normalizeSpiOptions(baudrateOrOptions, resolvedPins, spiOptions);
      boardProfile.resolveSpi(id, normalized.pins);
      return new MachineSpiAdapter(
        options.spiTarget,
        options.toPythonBytes ?? ((bytes) => Uint8Array.from(bytes)),
        normalized.configuration,
      );
    },
    { MSB: MACHINE_SPI_MSB, LSB: MACHINE_SPI_LSB },
  );
  const UART: MachineUartFactory = (
    id: unknown = 0,
    baudrateOrOptions?: unknown,
    uartOptions?: unknown,
  ) => {
    if (options.uartPeer === undefined) {
      throw new Error("The virtual UART peer is not configured.");
    }
    const normalized = normalizeUartOptions(baudrateOrOptions, uartOptions, resolvedPins);
    boardProfile.resolveUart(id, normalized.pins);
    return new MachineUartAdapter(
      options.uartPeer,
      options.toPythonBytes ?? ((bytes) => Uint8Array.from(bytes)),
      normalized.configuration,
    );
  };
  const PWM: MachinePwmFactory = (pin: unknown, pwmOptions?: unknown) => {
    const resolvedPin =
      typeof pin === "object" && pin !== null ? resolvedPins.get(pin) : undefined;
    if (resolvedPin === undefined) {
      throw new TypeError("PWM requires a machine.Pin instance.");
    }
    const output = boardProfile.resolvePwm(resolvedPin);
    const observer = options.pwmObserver?.(output.pin.runtimeId) ?? null;
    return new MachinePwmAdapter(observer, normalizePwmOptions(pwmOptions));
  };

  return { Pin, ADC, I2C, SPI, UART, PWM };
}

class MachinePinAdapter implements MachinePin {
  readonly #pin: VirtualGpioPin;

  constructor(pin: VirtualGpioPin) {
    this.#pin = pin;
  }

  init(mode: unknown, pull?: unknown, value?: unknown): void {
    normalizePull(pull);
    this.#pin.setMode(normalizeMode(mode));
    if (value !== undefined) {
      this.value(value);
    }
  }

  value(): VirtualPinValue;
  value(nextValue: unknown): void;
  value(nextValue?: unknown): VirtualPinValue | void {
    if (nextValue === undefined) {
      return this.#pin.read();
    }
    this.#pin.write(normalizeValue(nextValue));
  }

  on(): void {
    this.#pin.write(1);
  }

  off(): void {
    this.#pin.write(0);
  }

  toggle(): void {
    this.#pin.write(this.#pin.read() === 0 ? 1 : 0);
  }
}

class MachineAdcAdapter implements MachineAdc {
  readonly #channel: VirtualAdcChannel;

  constructor(channel: VirtualAdcChannel) {
    this.#channel = channel;
  }

  read_u16(): number {
    return this.#channel.readU16();
  }
}

class MachineI2cAdapter implements MachineI2c {
  readonly #bus: VirtualI2cBus;
  readonly #toPythonBytes: (bytes: Iterable<number>) => unknown;
  readonly #toPythonList: (values: readonly number[]) => unknown;

  constructor(
    bus: VirtualI2cBus,
    toPythonBytes: (bytes: Iterable<number>) => unknown,
    toPythonList: (values: readonly number[]) => unknown,
  ) {
    this.#bus = bus;
    this.#toPythonBytes = toPythonBytes;
    this.#toPythonList = toPythonList;
  }

  scan(): unknown {
    return this.#toPythonList(this.#bus.scan());
  }

  readfrom(address: unknown, byteCount: unknown, stop: unknown = true): unknown {
    normalizeStop(stop);
    return this.#toPythonBytes(
      this.#bus.read(normalizeI2cAddress(address), normalizeByteCount(byteCount)),
    );
  }

  writeto(address: unknown, buffer: unknown, stop: unknown = true): number {
    normalizeStop(stop);
    return this.#bus.write(normalizeI2cAddress(address), normalizeBuffer(buffer));
  }

  readfrom_mem(
    address: unknown,
    memoryAddress: unknown,
    byteCount: unknown,
    addressSize: unknown = 8,
  ): unknown {
    normalizeAddressSize(addressSize);
    return this.#toPythonBytes(
      this.#bus.readMemory(
        normalizeI2cAddress(address),
        normalizeMemoryAddress(memoryAddress),
        normalizeByteCount(byteCount),
      ),
    );
  }

  writeto_mem(
    address: unknown,
    memoryAddress: unknown,
    buffer: unknown,
    addressSize: unknown = 8,
  ): void {
    normalizeAddressSize(addressSize);
    this.#bus.writeMemory(
      normalizeI2cAddress(address),
      normalizeMemoryAddress(memoryAddress),
      normalizeBuffer(buffer),
    );
  }
}

class MachineSpiAdapter implements MachineSpi {
  readonly #target: SpiTargetPort;
  readonly #toPythonBytes: (bytes: Iterable<number>) => unknown;
  #configuration: SpiConfiguration;
  #active = true;

  constructor(
    target: SpiTargetPort,
    toPythonBytes: (bytes: Iterable<number>) => unknown,
    configuration: SpiConfiguration,
  ) {
    this.#target = target;
    this.#toPythonBytes = toPythonBytes;
    this.#configuration = configuration;
    this.#target.configure(configuration);
  }

  init(baudrateOrOptions?: unknown, options?: unknown): void {
    this.#configuration = normalizeSpiOptions(
      baudrateOrOptions,
      new WeakMap(),
      options,
    ).configuration;
    this.#active = true;
    this.#target.configure(this.#configuration);
  }

  deinit(): void {
    this.#active = false;
  }

  read(byteCount: unknown, write: unknown = 0): unknown {
    this.#assertActive();
    const count = normalizeByteCount(byteCount, "SPI byte count");
    const writeValue = normalizeByte(write, "SPI write value");
    return this.#toPythonBytes(this.#target.transfer(new Uint8Array(count).fill(writeValue)));
  }

  readinto(buffer: unknown, write: unknown = 0): void {
    this.#assertActive();
    const byteCount = getWritableBufferLength(buffer, "SPI read buffer");
    const writeValue = normalizeByte(write, "SPI write value");
    writeBuffer(buffer, this.#target.transfer(new Uint8Array(byteCount).fill(writeValue)));
  }

  _readinto(byteCount: unknown, write: unknown = 0): unknown {
    this.#assertActive();
    const count = normalizeByteCount(byteCount, "SPI byte count");
    const writeValue = normalizeByte(write, "SPI write value");
    return this.#toPythonBytes(this.#target.transfer(new Uint8Array(count).fill(writeValue)));
  }

  write(buffer: unknown): void {
    this.#assertActive();
    this.#target.transfer(normalizeBuffer(buffer, "SPI buffer"));
  }

  write_readinto(writeBufferValue: unknown, readBufferValue: unknown): void {
    this.#assertActive();
    const writeData = normalizeBuffer(writeBufferValue, "SPI write buffer");
    const readLength = getWritableBufferLength(readBufferValue, "SPI read buffer");
    if (readLength !== writeData.length) {
      throw new RangeError("SPI write and read buffers must have the same length.");
    }
    writeBuffer(readBufferValue, this.#target.transfer(writeData));
  }

  _write_readinto(writeBufferValue: unknown): unknown {
    this.#assertActive();
    return this.#toPythonBytes(
      this.#target.transfer(normalizeBuffer(writeBufferValue, "SPI write buffer")),
    );
  }

  #assertActive(): void {
    if (!this.#active) {
      throw new Error("SPI is deinitialized.");
    }
  }
}

class MachineUartAdapter implements MachineUart {
  readonly #peer: UartPeerPort;
  readonly #toPythonBytes: (bytes: Iterable<number>) => unknown;
  readonly #received: number[] = [];
  #configuration: UartConfiguration;
  #active = true;

  constructor(
    peer: UartPeerPort,
    toPythonBytes: (bytes: Iterable<number>) => unknown,
    configuration: UartConfiguration,
  ) {
    this.#peer = peer;
    this.#toPythonBytes = toPythonBytes;
    this.#configuration = configuration;
    this.#peer.configure(configuration);
  }

  init(baudrateOrOptions?: unknown, options?: unknown): void {
    this.#configuration = normalizeUartOptions(
      baudrateOrOptions,
      options,
      new WeakMap(),
    ).configuration;
    this.#active = true;
    this.#peer.configure(this.#configuration);
  }

  deinit(): void {
    this.#active = false;
    this.#received.length = 0;
  }

  any(): number {
    this.#assertActive();
    return this.#received.length + this.#peer.availableToBoard();
  }

  read(byteCount?: unknown): unknown {
    this.#assertActive();
    const requested =
      byteCount === undefined
        ? this.any()
        : normalizeByteCount(byteCount, "UART byte count");
    const data = this.#take(requested);
    return data.length === 0 ? null : this.#toPythonBytes(data);
  }

  readinto(buffer: unknown, byteCount?: unknown): number | null {
    this.#assertActive();
    const bufferLength = getWritableBufferLength(buffer, "UART read buffer");
    const requested =
      byteCount === undefined
        ? bufferLength
        : normalizeByteCount(byteCount, "UART byte count");
    if (requested > bufferLength) {
      throw new RangeError("UART byte count exceeds the read buffer length.");
    }
    const data = this.#take(requested);
    if (data.length === 0) {
      return null;
    }
    writeBuffer(buffer, data);
    return data.length;
  }

  readline(): unknown {
    this.#assertActive();
    this.#pull(this.#peer.availableToBoard());
    const newlineIndex = this.#received.indexOf(0x0a);
    const byteCount = newlineIndex < 0 ? this.#received.length : newlineIndex + 1;
    if (byteCount === 0) {
      return null;
    }
    return this.#toPythonBytes(Uint8Array.from(this.#received.splice(0, byteCount)));
  }

  write(buffer: unknown): number {
    this.#assertActive();
    return this.#peer.writeFromBoard(normalizeBuffer(buffer, "UART buffer"));
  }

  _readinto(byteCount: unknown): unknown {
    this.#assertActive();
    const requested = normalizeByteCount(byteCount, "UART byte count");
    const data = this.#take(requested);
    return data.length === 0 ? null : this.#toPythonBytes(data);
  }

  #take(byteCount: number): Uint8Array {
    this.#pull(Math.max(0, byteCount - this.#received.length));
    return Uint8Array.from(this.#received.splice(0, Math.min(byteCount, this.#received.length)));
  }

  #pull(byteCount: number): void {
    let remaining = byteCount;
    while (remaining > 0) {
      const chunk = this.#peer.readForBoard(Math.min(remaining, 256));
      if (chunk.length === 0) {
        return;
      }
      this.#received.push(...chunk);
      remaining -= chunk.length;
    }
  }

  #assertActive(): void {
    if (!this.#active) {
      throw new Error("UART is deinitialized.");
    }
  }
}

class MachinePwmAdapter implements MachinePwm {
  readonly #observer: PwmObserverPort | null;
  #signal: PwmSignal;

  constructor(observer: PwmObserverPort | null, signal: PwmSignal) {
    this.#observer = observer;
    this.#signal = signal;
    this.#emit();
  }

  init(options?: unknown): void {
    this.#signal = normalizePwmOptions(options, this.#signal);
    this.#signal = { ...this.#signal, enabled: true };
    this.#emit();
  }

  deinit(): void {
    this.#signal = { ...this.#signal, enabled: false };
    this.#emit();
  }

  freq(): number;
  freq(value: unknown): void;
  freq(value?: unknown): number | void {
    if (value === undefined) {
      return this.#signal.frequencyHz;
    }
    this.#signal = {
      ...this.#signal,
      frequencyHz: normalizePositiveFinite(value, "PWM frequency"),
    };
    this.#emit();
  }

  duty_u16(): number;
  duty_u16(value: unknown): void;
  duty_u16(value?: unknown): number | void {
    if (value === undefined) {
      return this.#signal.dutyU16;
    }
    this.#signal = { ...this.#signal, dutyU16: normalizeU16(value, "PWM duty_u16") };
    this.#emit();
  }

  duty_ns(): number;
  duty_ns(value: unknown): void;
  duty_ns(value?: unknown): number | void {
    const periodNs = 1_000_000_000 / this.#signal.frequencyHz;
    if (value === undefined) {
      return Math.round((this.#signal.dutyU16 / 65_535) * periodNs);
    }
    const nanoseconds = normalizeNonNegativeFinite(value, "PWM duty_ns");
    if (nanoseconds > periodNs) {
      throw new RangeError("PWM duty_ns must not exceed the current period.");
    }
    this.#signal = {
      ...this.#signal,
      dutyU16: Math.round((nanoseconds / periodNs) * 65_535),
    };
    this.#emit();
  }

  #emit(): void {
    this.#observer?.update(this.#signal);
  }
}

function normalizeMode(value: unknown): VirtualPinMode {
  if (value === MACHINE_PIN_IN) {
    return "input";
  }
  if (value === MACHINE_PIN_OUT) {
    return "output";
  }
  throw new TypeError(`Unsupported Pin mode: ${String(value)}`);
}

function normalizeValue(value: unknown): VirtualPinValue {
  if (typeof value !== "number" && typeof value !== "boolean") {
    throw new TypeError("Pin value must be a number or boolean.");
  }
  return Number(value) === 0 ? 0 : 1;
}

function normalizePull(value: unknown): void {
  if (
    value !== undefined &&
    value !== null &&
    value !== MACHINE_PIN_PULL_UP &&
    value !== MACHINE_PIN_PULL_DOWN
  ) {
    throw new TypeError(`Unsupported Pin pull: ${String(value)}`);
  }
}

function normalizeI2cOptions(
  value: unknown,
  resolvedPins: WeakMap<object, ResolvedBoardPin>,
): I2cPinSelection {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null) {
    throw new TypeError("I2C options must be keyword arguments.");
  }
  const options = value as Record<string, unknown>;
  for (const key of Object.keys(options)) {
    if (key !== "scl" && key !== "sda" && key !== "freq" && key !== "timeout") {
      throw new TypeError(`Unsupported I2C option: ${key}`);
    }
  }
  const scl =
    options.scl === undefined
      ? undefined
      : normalizeI2cPin(options.scl, "scl", resolvedPins);
  const sda =
    options.sda === undefined
      ? undefined
      : normalizeI2cPin(options.sda, "sda", resolvedPins);
  if (options.freq !== undefined) {
    normalizePositiveInteger(options.freq, "I2C frequency");
  }
  if (options.timeout !== undefined) {
    normalizePositiveInteger(options.timeout, "I2C timeout");
  }
  return {
    ...(scl === undefined ? {} : { scl }),
    ...(sda === undefined ? {} : { sda }),
  };
}

interface NormalizedSpiOptions {
  readonly pins: SpiPinSelection;
  readonly configuration: SpiConfiguration;
}

function normalizeSpiOptions(
  value: unknown,
  resolvedPins: WeakMap<object, ResolvedBoardPin>,
  keywordOptions?: unknown,
): NormalizedSpiOptions {
  let options: Record<string, unknown>;
  if (typeof value === "number") {
    options = {
      ...normalizeOptions(keywordOptions, "SPI"),
      baudrate: value,
    };
  } else {
    if (keywordOptions !== undefined) {
      throw new TypeError("SPI positional options must start with a baudrate.");
    }
    options = normalizeOptions(value, "SPI");
  }
  for (const key of Object.keys(options)) {
    if (
      !["baudrate", "polarity", "phase", "bits", "firstbit", "sck", "mosi", "miso"].includes(
        key,
      )
    ) {
      throw new TypeError(`Unsupported SPI option: ${key}`);
    }
  }
  const firstBitValue = options.firstbit ?? MACHINE_SPI_MSB;
  if (firstBitValue !== MACHINE_SPI_MSB && firstBitValue !== MACHINE_SPI_LSB) {
    throw new RangeError("SPI firstbit must be SPI.MSB or SPI.LSB.");
  }
  const sck = normalizeOptionalMachinePin(options.sck, "SPI sck", resolvedPins);
  const mosi = normalizeOptionalMachinePin(options.mosi, "SPI mosi", resolvedPins);
  const miso = normalizeOptionalMachinePin(options.miso, "SPI miso", resolvedPins);
  return {
    pins: {
      ...(sck === undefined ? {} : { sck }),
      ...(mosi === undefined ? {} : { mosi }),
      ...(miso === undefined ? {} : { miso }),
    },
    configuration: {
      baudrate: normalizePositiveInteger(options.baudrate ?? 1_000_000, "SPI baudrate"),
      polarity: normalizeBit(options.polarity ?? 0, "SPI polarity"),
      phase: normalizeBit(options.phase ?? 0, "SPI phase"),
      firstBit: firstBitValue === MACHINE_SPI_MSB ? "msb" : "lsb",
      bits: normalizeEightBits(options.bits ?? 8, "SPI"),
    },
  };
}

interface NormalizedUartOptions {
  readonly pins: UartPinSelection;
  readonly configuration: UartConfiguration;
}

function normalizeUartOptions(
  baudrateOrOptions: unknown,
  keywordOptions: unknown,
  resolvedPins: WeakMap<object, ResolvedBoardPin>,
): NormalizedUartOptions {
  let options: Record<string, unknown>;
  if (typeof baudrateOrOptions === "number") {
    options = {
      ...normalizeOptions(keywordOptions, "UART"),
      baudrate: baudrateOrOptions,
    };
  } else {
    if (keywordOptions !== undefined) {
      throw new TypeError("UART positional options must start with a baudrate.");
    }
    options = normalizeOptions(baudrateOrOptions, "UART");
  }
  for (const key of Object.keys(options)) {
    if (
      ![
        "baudrate",
        "bits",
        "parity",
        "stop",
        "tx",
        "rx",
        "timeout",
        "timeout_char",
        "invert",
      ].includes(key)
    ) {
      throw new TypeError(`Unsupported UART option: ${key}`);
    }
  }
  if (options.timeout !== undefined) {
    normalizeNonNegativeInteger(options.timeout, "UART timeout");
  }
  if (options.timeout_char !== undefined) {
    normalizeNonNegativeInteger(options.timeout_char, "UART timeout_char");
  }
  if (options.invert !== undefined && options.invert !== 0) {
    throw new RangeError("UART signal inversion is not supported in Device API v1.");
  }
  const tx = normalizeOptionalMachinePin(options.tx, "UART tx", resolvedPins);
  const rx = normalizeOptionalMachinePin(options.rx, "UART rx", resolvedPins);
  return {
    pins: {
      ...(tx === undefined ? {} : { tx }),
      ...(rx === undefined ? {} : { rx }),
    },
    configuration: {
      baudrate: normalizePositiveInteger(options.baudrate ?? 115_200, "UART baudrate"),
      bits: normalizeEightBits(options.bits ?? 8, "UART"),
      parity: normalizeUartParity(options.parity),
      stop: normalizeUartStop(options.stop ?? 1),
    },
  };
}

function normalizePwmOptions(value: unknown, current?: PwmSignal): PwmSignal {
  const options = normalizeOptions(value, "PWM");
  for (const key of Object.keys(options)) {
    if (!["freq", "duty_u16", "duty_ns", "invert"].includes(key)) {
      throw new TypeError(`Unsupported PWM option: ${key}`);
    }
  }
  if (options.duty_u16 !== undefined && options.duty_ns !== undefined) {
    throw new TypeError("PWM accepts either duty_u16 or duty_ns, not both.");
  }
  const frequencyHz = normalizePositiveFinite(
    options.freq ?? current?.frequencyHz ?? 1_000,
    "PWM frequency",
  );
  let dutyU16 = current?.dutyU16 ?? 0;
  if (options.duty_u16 !== undefined) {
    dutyU16 = normalizeU16(options.duty_u16, "PWM duty_u16");
  } else if (options.duty_ns !== undefined) {
    const periodNs = 1_000_000_000 / frequencyHz;
    const dutyNs = normalizeNonNegativeFinite(options.duty_ns, "PWM duty_ns");
    if (dutyNs > periodNs) {
      throw new RangeError("PWM duty_ns must not exceed the configured period.");
    }
    dutyU16 = Math.round((dutyNs / periodNs) * 65_535);
  }
  const inverted = options.invert ?? current?.inverted ?? false;
  if (typeof inverted !== "boolean") {
    throw new TypeError("PWM invert must be a boolean.");
  }
  return { enabled: true, frequencyHz, dutyU16, inverted };
}

function normalizeOptions(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} options must be keyword arguments.`);
  }
  return value as Record<string, unknown>;
}

function normalizeOptionalMachinePin(
  value: unknown,
  label: string,
  resolvedPins: WeakMap<object, ResolvedBoardPin>,
): ResolvedBoardPin | undefined {
  if (value === undefined) {
    return undefined;
  }
  const pin = typeof value === "object" && value !== null ? resolvedPins.get(value) : undefined;
  if (pin === undefined) {
    throw new TypeError(`${label} must be a machine.Pin instance.`);
  }
  return pin;
}

function normalizeI2cPin(
  value: unknown,
  optionName: "scl" | "sda",
  resolvedPins: WeakMap<object, ResolvedBoardPin>,
): ResolvedBoardPin {
  const pin = typeof value === "object" && value !== null ? resolvedPins.get(value) : undefined;
  if (pin === undefined) {
    throw new TypeError(`I2C ${optionName} must be a machine.Pin instance.`);
  }
  return pin;
}

function normalizePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

function normalizeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function normalizePositiveFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
  return value;
}

function normalizeNonNegativeFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function normalizeBit(value: unknown, label: string): 0 | 1 {
  if (value !== 0 && value !== 1) {
    throw new RangeError(`${label} must be 0 or 1.`);
  }
  return value;
}

function normalizeEightBits(value: unknown, label: string): 8 {
  if (value !== 8) {
    throw new RangeError(`${label} supports only 8 data bits.`);
  }
  return 8;
}

function normalizeUartParity(value: unknown): UartConfiguration["parity"] {
  if (value === undefined || value === null) {
    return "none";
  }
  if (value === 0) {
    return "even";
  }
  if (value === 1) {
    return "odd";
  }
  throw new RangeError("UART parity must be None, 0 (even), or 1 (odd).");
}

function normalizeUartStop(value: unknown): 1 | 2 {
  if (value !== 1 && value !== 2) {
    throw new RangeError("UART stop must be 1 or 2.");
  }
  return value;
}

function normalizeU16(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 65_535) {
    throw new RangeError(`${label} must be an integer from 0 to 65535.`);
  }
  return value;
}

function normalizeByte(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`${label} must be an integer from 0 to 255.`);
  }
  return value;
}

function normalizeI2cAddress(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0x08 || value > 0x77) {
    throw new RangeError("I2C address must be a 7-bit device address from 0x08 to 0x77.");
  }
  return value;
}

function normalizeMemoryAddress(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError("I2C memory address must be an integer from 0 to 255.");
  }
  return value;
}

function normalizeByteCount(value: unknown, label = "I2C byte count"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function normalizeBuffer(value: unknown, label = "I2C buffer"): Uint8Array {
  if (value instanceof Uint8Array) {
    return value.slice();
  }
  if (value === null || value === undefined || typeof value === "string") {
    throw new TypeError(`${label} must be a bytes-like iterable.`);
  }

  let values: unknown[];
  try {
    values = Array.from(value as Iterable<unknown>);
  } catch {
    throw new TypeError(`${label} must be a bytes-like iterable.`);
  }
  const bytes = values.map((item) => {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 0xff) {
      throw new RangeError(`${label} values must be integers from 0 to 255.`);
    }
    return item;
  });
  return Uint8Array.from(bytes);
}

function getWritableBufferLength(value: unknown, label: string): number {
  return normalizeBuffer(value, label).length;
}

function writeBuffer(target: unknown, data: Uint8Array): void {
  const targetLength = getWritableBufferLength(target, "Read buffer");
  if (data.length > targetLength) {
    throw new RangeError("Received data exceeds the read buffer length.");
  }
  if (target instanceof Uint8Array) {
    target.set(data);
    return;
  }
  if (typeof target !== "object" || target === null) {
    throw new TypeError("Read buffer must be writable.");
  }
  for (let index = 0; index < data.length; index += 1) {
    if (!Reflect.set(target, index, data[index])) {
      throw new TypeError("Read buffer must be writable.");
    }
  }
}

function normalizeStop(value: unknown): void {
  if (typeof value !== "boolean") {
    throw new TypeError("I2C stop must be a boolean.");
  }
}

function normalizeAddressSize(value: unknown): void {
  if (value !== 8) {
    throw new RangeError("The virtual register device supports only addrsize=8.");
  }
}
