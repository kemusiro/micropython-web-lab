export type VirtualPinMode = "input" | "output";
export type VirtualPinValue = 0 | 1;
export const MAX_VIRTUAL_ADC_VALUE = 65_535;

export interface VirtualPinState {
  kind: "gpio-pin";
  sequence: number;
  pinId: string;
  mode: VirtualPinMode;
  value: VirtualPinValue;
}

export interface VirtualAdcState {
  kind: "adc-channel";
  sequence: number;
  pinId: string;
  value: number;
}

export type VirtualDeviceState = VirtualPinState | VirtualAdcState;
export type VirtualDeviceStateHandler = (state: VirtualDeviceState) => void;
export type VirtualPinInputReader = (pinId: string) => VirtualPinValue | null;
export type VirtualAnalogInputReader = (pinId: string) => number | null;
export type VirtualPinOutputWriter = (pinId: string, value: VirtualPinValue) => void;

interface MutablePinState {
  pinId: string;
  mode: VirtualPinMode;
  value: VirtualPinValue;
}

interface MutableAdcState {
  pinId: string;
  value: number;
}

export class VirtualGpioBoard {
  readonly #pins = new Map<string, MutablePinState>();
  readonly #adcChannels = new Map<string, MutableAdcState>();
  readonly #onState: VirtualDeviceStateHandler;
  readonly #readInput: VirtualPinInputReader;
  readonly #readAnalogInput: VirtualAnalogInputReader;
  readonly #writeOutput: VirtualPinOutputWriter;
  #sequence = 0;

  constructor(
    onState: VirtualDeviceStateHandler,
    readInput: VirtualPinInputReader = () => null,
    readAnalogInput: VirtualAnalogInputReader = () => null,
    writeOutput: VirtualPinOutputWriter = () => undefined,
  ) {
    this.#onState = onState;
    this.#readInput = readInput;
    this.#readAnalogInput = readAnalogInput;
    this.#writeOutput = writeOutput;
  }

  openPin(pinId: string, mode: VirtualPinMode): VirtualGpioPin {
    const existing = this.#pins.get(pinId);
    const state: MutablePinState = existing ?? { pinId, mode, value: 0 };
    state.mode = mode;
    this.#refreshInput(state);
    this.#pins.set(pinId, state);
    this.#notifyOutput(state);
    this.#emit(state);
    return new VirtualGpioPin(this, pinId);
  }

  read(pinId: string): VirtualPinValue {
    const state = this.#requiredState(pinId);
    if (this.#refreshInput(state)) {
      this.#emit(state);
    }
    return state.value;
  }

  write(pinId: string, value: VirtualPinValue): void {
    const state = this.#requiredState(pinId);
    if (state.mode !== "output") {
      throw new Error(`Pin ${pinId} is not configured for output.`);
    }
    if (state.value === value) {
      return;
    }
    state.value = value;
    this.#notifyOutput(state);
    this.#emit(state);
  }

  setMode(pinId: string, mode: VirtualPinMode): void {
    const state = this.#requiredState(pinId);
    state.mode = mode;
    this.#refreshInput(state);
    this.#notifyOutput(state);
    this.#emit(state);
  }

  openAdc(pinId: string): VirtualAdcChannel {
    const existing = this.#adcChannels.get(pinId);
    const state: MutableAdcState = existing ?? { pinId, value: 0 };
    this.#refreshAnalogInput(state);
    this.#adcChannels.set(pinId, state);
    this.#emitAdc(state);
    return new VirtualAdcChannel(this, pinId);
  }

  readAnalog(pinId: string): number {
    const state = this.#requiredAdcState(pinId);
    if (this.#refreshAnalogInput(state)) {
      this.#emitAdc(state);
    }
    return state.value;
  }

  #requiredState(pinId: string): MutablePinState {
    const state = this.#pins.get(pinId);
    if (state === undefined) {
      throw new Error(`Pin ${pinId} has not been initialized.`);
    }
    return state;
  }

  #requiredAdcState(pinId: string): MutableAdcState {
    const state = this.#adcChannels.get(pinId);
    if (state === undefined) {
      throw new Error(`ADC pin ${pinId} has not been initialized.`);
    }
    return state;
  }

  #emit(state: MutablePinState): void {
    this.#sequence += 1;
    this.#onState({
      kind: "gpio-pin",
      sequence: this.#sequence,
      pinId: state.pinId,
      mode: state.mode,
      value: state.value,
    });
  }

  #refreshInput(state: MutablePinState): boolean {
    if (state.mode !== "input") {
      return false;
    }
    const nextValue = this.#readInput(state.pinId);
    if (nextValue === null || nextValue === state.value) {
      return false;
    }
    state.value = nextValue;
    return true;
  }

  #notifyOutput(state: MutablePinState): void {
    if (state.mode === "output") {
      this.#writeOutput(state.pinId, state.value);
    }
  }

  #emitAdc(state: MutableAdcState): void {
    this.#sequence += 1;
    this.#onState({
      kind: "adc-channel",
      sequence: this.#sequence,
      pinId: state.pinId,
      value: state.value,
    });
  }

  #refreshAnalogInput(state: MutableAdcState): boolean {
    const nextValue = this.#readAnalogInput(state.pinId);
    if (
      nextValue !== null &&
      (!Number.isInteger(nextValue) || nextValue < 0 || nextValue > MAX_VIRTUAL_ADC_VALUE)
    ) {
      throw new RangeError(`ADC pin ${state.pinId} must be an integer from 0 to 65535.`);
    }
    if (nextValue === null || nextValue === state.value) {
      return false;
    }
    state.value = nextValue;
    return true;
  }
}

export class VirtualGpioPin {
  readonly #board: VirtualGpioBoard;
  readonly #pinId: string;

  constructor(board: VirtualGpioBoard, pinId: string) {
    this.#board = board;
    this.#pinId = pinId;
  }

  read(): VirtualPinValue {
    return this.#board.read(this.#pinId);
  }

  write(value: VirtualPinValue): void {
    this.#board.write(this.#pinId, value);
  }

  setMode(mode: VirtualPinMode): void {
    this.#board.setMode(this.#pinId, mode);
  }
}

export class VirtualAdcChannel {
  readonly #board: VirtualGpioBoard;
  readonly #pinId: string;

  constructor(board: VirtualGpioBoard, pinId: string) {
    this.#board = board;
    this.#pinId = pinId;
  }

  readU16(): number {
    return this.#board.readAnalog(this.#pinId);
  }
}
