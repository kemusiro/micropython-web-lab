export const SHARED_DEVICE_INPUT_FORMAT_VERSION = 1 as const;
export const MAX_SHARED_INPUT_QUEUE_BYTES = 4_096;

export const BUTTON_PRESSED_INPUT_ID = "button-gp15.pressed" as const;
export const ANALOG_VALUE_INPUT_ID = "analog-gp26.value" as const;
export const UART_RECEIVE_INPUT_ID = "uart-echo-0.receive" as const;
export const GT_502MGG_LATITUDE_E7_INPUT_ID = "gt-502mgg-n.latitude-e7" as const;
export const GT_502MGG_LONGITUDE_E7_INPUT_ID = "gt-502mgg-n.longitude-e7" as const;
export const GT_502MGG_ALTITUDE_CM_INPUT_ID = "gt-502mgg-n.altitude-cm" as const;
export const GT_502MGG_GENERATE_INPUT_ID = "gt-502mgg-n.generate" as const;
export const BME280_TEMPERATURE_INPUT_ID = "ae-bme280.temperature-c" as const;
export const BME280_HUMIDITY_INPUT_ID = "ae-bme280.humidity-percent" as const;
export const BME280_PRESSURE_INPUT_ID = "ae-bme280.pressure-hpa" as const;

export const MAX_ANALOG_INPUT_VALUE = 65_535;
export const DEFAULT_ANALOG_INPUT_VALUE = 32_768;

export interface SharedScalarInputDefinition {
  readonly id: string;
  readonly initialValue: number;
  readonly minimum: number;
  readonly maximum: number;
}

export interface SharedQueueInputDefinition {
  readonly id: string;
  readonly capacity: number;
}

export interface SharedDeviceInputLayout {
  readonly version: 1;
  readonly scalarInputs: readonly SharedScalarInputDefinition[];
  readonly queueInputs: readonly SharedQueueInputDefinition[];
}

export interface SharedScalarInputSnapshot {
  readonly value: number;
  readonly version: number;
}

export interface SharedQueueInputRead {
  readonly data: Uint8Array;
  readonly startSequence: number;
  readonly endSequence: number;
}

export interface SharedQueueInputWrite {
  readonly byteCount: number;
  readonly startSequence: number;
  readonly endSequence: number;
}

export interface SharedDeviceInputTransfer {
  readonly buffer: SharedArrayBuffer;
  readonly layout: SharedDeviceInputLayout;
}

export const WEB_LAB_DEVICE_INPUT_LAYOUT: SharedDeviceInputLayout = Object.freeze({
  version: 1,
  scalarInputs: Object.freeze([
    Object.freeze({ id: BUTTON_PRESSED_INPUT_ID, initialValue: 0, minimum: 0, maximum: 1 }),
    Object.freeze({
      id: ANALOG_VALUE_INPUT_ID,
      initialValue: DEFAULT_ANALOG_INPUT_VALUE,
      minimum: 0,
      maximum: MAX_ANALOG_INPUT_VALUE,
    }),
    Object.freeze({
      id: BME280_TEMPERATURE_INPUT_ID,
      initialValue: 25,
      minimum: -40,
      maximum: 85,
    }),
    Object.freeze({
      id: BME280_HUMIDITY_INPUT_ID,
      initialValue: 50,
      minimum: 0,
      maximum: 100,
    }),
    Object.freeze({
      id: BME280_PRESSURE_INPUT_ID,
      initialValue: 1_013,
      minimum: 300,
      maximum: 1_100,
    }),
    Object.freeze({
      id: GT_502MGG_LATITUDE_E7_INPUT_ID,
      initialValue: 356_812_360,
      minimum: -900_000_000,
      maximum: 900_000_000,
    }),
    Object.freeze({
      id: GT_502MGG_LONGITUDE_E7_INPUT_ID,
      initialValue: 1_397_671_250,
      minimum: -1_800_000_000,
      maximum: 1_800_000_000,
    }),
    Object.freeze({
      id: GT_502MGG_ALTITUDE_CM_INPUT_ID,
      initialValue: 4_000,
      minimum: -100_000,
      maximum: 2_000_000,
    }),
    Object.freeze({
      id: GT_502MGG_GENERATE_INPUT_ID,
      initialValue: 0,
      minimum: 0,
      maximum: 1,
    }),
  ]),
  queueInputs: Object.freeze([
    Object.freeze({ id: UART_RECEIVE_INPUT_ID, capacity: MAX_SHARED_INPUT_QUEUE_BYTES }),
  ]),
});

const FORMAT_MAGIC = 0x4d574c49;
const HEADER_SLOT_COUNT = 6;
const MAGIC_SLOT = 0;
const FORMAT_VERSION_SLOT = 1;
const LAYOUT_VERSION_SLOT = 2;
const LAYOUT_FINGERPRINT_SLOT = 3;
const SCALAR_COUNT_SLOT = 4;
const QUEUE_COUNT_SLOT = 5;
const SCALAR_CONTROL_SLOT_COUNT = 2;
const QUEUE_CONTROL_SLOT_COUNT = 2;
const MAX_STABLE_READ_ATTEMPTS = 1_000;

interface ScalarBinding extends SharedScalarInputDefinition {
  readonly revisionSlot: number;
  readonly valueSlot: number;
}

interface QueueBinding extends SharedQueueInputDefinition {
  readonly headSlot: number;
  readonly tailSlot: number;
  readonly dataOffset: number;
}

interface PreparedLayout {
  readonly layout: SharedDeviceInputLayout;
  readonly scalarBindings: ReadonlyMap<string, ScalarBinding>;
  readonly queueBindings: ReadonlyMap<string, QueueBinding>;
  readonly controlSlotCount: number;
  readonly byteLength: number;
  readonly fingerprint: number;
}

export class SharedInputQueueOverflowError extends RangeError {
  constructor(queueId: string, requested: number, available: number) {
    super(
      `Shared input queue ${queueId} cannot accept ${requested} bytes; ${available} bytes remain.`,
    );
    this.name = "SharedInputQueueOverflowError";
  }
}

export class SharedDeviceInputs {
  readonly #buffer: SharedArrayBuffer;
  readonly #controls: Int32Array;
  readonly #bytes: Uint8Array;
  readonly #prepared: PreparedLayout;

  private constructor(buffer: SharedArrayBuffer, prepared: PreparedLayout) {
    this.#buffer = buffer;
    this.#prepared = prepared;
    this.#controls = new Int32Array(
      buffer,
      0,
      prepared.controlSlotCount,
    );
    this.#bytes = new Uint8Array(buffer);
  }

  static create(layout: SharedDeviceInputLayout): SharedDeviceInputs | null {
    if (typeof SharedArrayBuffer === "undefined") {
      return null;
    }
    const prepared = prepareLayout(layout);
    const inputs = new SharedDeviceInputs(
      new SharedArrayBuffer(prepared.byteLength),
      prepared,
    );
    inputs.#initialize();
    return inputs;
  }

  static attach(
    buffer: SharedArrayBuffer,
    layout: SharedDeviceInputLayout,
  ): SharedDeviceInputs {
    const prepared = prepareLayout(layout);
    if (!(buffer instanceof SharedArrayBuffer)) {
      throw new TypeError("Device input buffer must be a SharedArrayBuffer.");
    }
    if (buffer.byteLength !== prepared.byteLength) {
      throw new RangeError(
        `Device input buffer must be ${prepared.byteLength} bytes, received ${buffer.byteLength}.`,
      );
    }
    const inputs = new SharedDeviceInputs(buffer, prepared);
    inputs.#validateHeader();
    return inputs;
  }

  get buffer(): SharedArrayBuffer {
    return this.#buffer;
  }

  get layout(): SharedDeviceInputLayout {
    return this.#prepared.layout;
  }

  toTransfer(): SharedDeviceInputTransfer {
    return { buffer: this.#buffer, layout: this.#prepared.layout };
  }

  setScalar(inputId: string, value: number): number {
    const binding = this.#requiredScalar(inputId);
    assertIntegerInRange(value, binding.minimum, binding.maximum, `Shared input ${inputId}`);
    const revision = Atomics.load(this.#controls, binding.revisionSlot);
    if ((revision & 1) !== 0) {
      throw new Error(`Shared input ${inputId} is already being written.`);
    }
    Atomics.store(this.#controls, binding.revisionSlot, revision + 1);
    Atomics.store(this.#controls, binding.valueSlot, value);
    const nextRevision = revision + 2;
    Atomics.store(this.#controls, binding.revisionSlot, nextRevision);
    return unsigned(nextRevision) >>> 1;
  }

  readScalar(inputId: string): SharedScalarInputSnapshot {
    const binding = this.#requiredScalar(inputId);
    for (let attempt = 0; attempt < MAX_STABLE_READ_ATTEMPTS; attempt += 1) {
      const before = Atomics.load(this.#controls, binding.revisionSlot);
      if ((before & 1) !== 0) {
        continue;
      }
      const value = Atomics.load(this.#controls, binding.valueSlot);
      const after = Atomics.load(this.#controls, binding.revisionSlot);
      if (before === after) {
        if (value < binding.minimum || value > binding.maximum) {
          throw new RangeError(`Shared input ${inputId} contains an invalid value.`);
        }
        return { value, version: unsigned(after) >>> 1 };
      }
    }
    throw new Error(`Shared input ${inputId} did not stabilize.`);
  }

  enqueue(inputId: string, data: Uint8Array): SharedQueueInputWrite {
    const binding = this.#requiredQueue(inputId);
    if (!(data instanceof Uint8Array)) {
      throw new TypeError(`Shared input queue ${inputId} accepts only Uint8Array data.`);
    }
    const head = unsigned(Atomics.load(this.#controls, binding.headSlot));
    const tail = unsigned(Atomics.load(this.#controls, binding.tailSlot));
    const used = sequenceDistance(head, tail);
    if (used > binding.capacity) {
      throw new Error(`Shared input queue ${inputId} has corrupt sequence counters.`);
    }
    const available = binding.capacity - used;
    if (data.length > available) {
      throw new SharedInputQueueOverflowError(inputId, data.length, available);
    }
    for (let index = 0; index < data.length; index += 1) {
      const queueOffset = (tail + index) % binding.capacity;
      this.#bytes[binding.dataOffset + queueOffset] = data[index]!;
    }
    const endSequence = addSequence(tail, data.length);
    Atomics.store(this.#controls, binding.tailSlot, signed(endSequence));
    return {
      byteCount: data.length,
      startSequence: tail,
      endSequence,
    };
  }

  dequeue(inputId: string, maxBytes: number): SharedQueueInputRead {
    const binding = this.#requiredQueue(inputId);
    assertIntegerInRange(maxBytes, 0, binding.capacity, `Shared input queue ${inputId} read size`);
    const head = unsigned(Atomics.load(this.#controls, binding.headSlot));
    const tail = unsigned(Atomics.load(this.#controls, binding.tailSlot));
    const used = sequenceDistance(head, tail);
    if (used > binding.capacity) {
      throw new Error(`Shared input queue ${inputId} has corrupt sequence counters.`);
    }
    const byteCount = Math.min(maxBytes, used);
    const data = new Uint8Array(byteCount);
    for (let index = 0; index < byteCount; index += 1) {
      const queueOffset = (head + index) % binding.capacity;
      data[index] = this.#bytes[binding.dataOffset + queueOffset]!;
    }
    const endSequence = addSequence(head, byteCount);
    Atomics.store(this.#controls, binding.headSlot, signed(endSequence));
    return { data, startSequence: head, endSequence };
  }

  available(inputId: string): number {
    const binding = this.#requiredQueue(inputId);
    const head = unsigned(Atomics.load(this.#controls, binding.headSlot));
    const tail = unsigned(Atomics.load(this.#controls, binding.tailSlot));
    const used = sequenceDistance(head, tail);
    if (used > binding.capacity) {
      throw new Error(`Shared input queue ${inputId} has corrupt sequence counters.`);
    }
    return used;
  }

  #initialize(): void {
    Atomics.store(this.#controls, MAGIC_SLOT, FORMAT_MAGIC);
    Atomics.store(this.#controls, FORMAT_VERSION_SLOT, SHARED_DEVICE_INPUT_FORMAT_VERSION);
    Atomics.store(this.#controls, LAYOUT_VERSION_SLOT, this.#prepared.layout.version);
    Atomics.store(this.#controls, LAYOUT_FINGERPRINT_SLOT, this.#prepared.fingerprint);
    Atomics.store(
      this.#controls,
      SCALAR_COUNT_SLOT,
      this.#prepared.layout.scalarInputs.length,
    );
    Atomics.store(this.#controls, QUEUE_COUNT_SLOT, this.#prepared.layout.queueInputs.length);
    for (const binding of this.#prepared.scalarBindings.values()) {
      Atomics.store(this.#controls, binding.valueSlot, binding.initialValue);
      Atomics.store(this.#controls, binding.revisionSlot, 2);
    }
    for (const binding of this.#prepared.queueBindings.values()) {
      Atomics.store(this.#controls, binding.headSlot, 0);
      Atomics.store(this.#controls, binding.tailSlot, 0);
    }
  }

  #validateHeader(): void {
    if (Atomics.load(this.#controls, MAGIC_SLOT) !== FORMAT_MAGIC) {
      throw new RangeError("Device input buffer has an invalid format marker.");
    }
    const formatVersion = Atomics.load(this.#controls, FORMAT_VERSION_SLOT);
    if (formatVersion !== SHARED_DEVICE_INPUT_FORMAT_VERSION) {
      throw new RangeError(`Unsupported shared device input format version: ${formatVersion}.`);
    }
    if (Atomics.load(this.#controls, LAYOUT_VERSION_SLOT) !== this.#prepared.layout.version) {
      throw new RangeError("Device input layout version does not match the buffer.");
    }
    if (Atomics.load(this.#controls, LAYOUT_FINGERPRINT_SLOT) !== this.#prepared.fingerprint) {
      throw new RangeError("Device input layout does not match the buffer.");
    }
    if (
      Atomics.load(this.#controls, SCALAR_COUNT_SLOT) !==
        this.#prepared.layout.scalarInputs.length ||
      Atomics.load(this.#controls, QUEUE_COUNT_SLOT) !== this.#prepared.layout.queueInputs.length
    ) {
      throw new RangeError("Device input channel counts do not match the buffer.");
    }
  }

  #requiredScalar(inputId: string): ScalarBinding {
    const binding = this.#prepared.scalarBindings.get(inputId);
    if (binding === undefined) {
      throw new RangeError(`Unknown shared scalar input: ${inputId}`);
    }
    return binding;
  }

  #requiredQueue(inputId: string): QueueBinding {
    const binding = this.#prepared.queueBindings.get(inputId);
    if (binding === undefined) {
      throw new RangeError(`Unknown shared queue input: ${inputId}`);
    }
    return binding;
  }
}

function prepareLayout(source: SharedDeviceInputLayout): PreparedLayout {
  if (typeof source !== "object" || source === null || source.version !== 1) {
    throw new RangeError("Only shared device input layout v1 is supported.");
  }
  if (!Array.isArray(source.scalarInputs) || !Array.isArray(source.queueInputs)) {
    throw new TypeError("Shared device input channels must be arrays.");
  }
  const ids = new Set<string>();
  const scalarInputs = source.scalarInputs.map((input) => {
    if (typeof input !== "object" || input === null) {
      throw new TypeError("Shared scalar input definition must be an object.");
    }
    assertChannelId(input.id, ids);
    assertInt32(input.minimum, `Shared input ${input.id} minimum`);
    assertInt32(input.maximum, `Shared input ${input.id} maximum`);
    if (input.minimum > input.maximum) {
      throw new RangeError(`Shared input ${input.id} minimum exceeds its maximum.`);
    }
    assertIntegerInRange(
      input.initialValue,
      input.minimum,
      input.maximum,
      `Shared input ${input.id} initial value`,
    );
    return Object.freeze({
      id: input.id,
      initialValue: input.initialValue,
      minimum: input.minimum,
      maximum: input.maximum,
    });
  });
  const queueInputs = source.queueInputs.map((input) => {
    if (typeof input !== "object" || input === null) {
      throw new TypeError("Shared queue input definition must be an object.");
    }
    assertChannelId(input.id, ids);
    assertIntegerInRange(
      input.capacity,
      1,
      MAX_SHARED_INPUT_QUEUE_BYTES,
      `Shared input queue ${input.id} capacity`,
    );
    return Object.freeze({ id: input.id, capacity: input.capacity });
  });
  const layout: SharedDeviceInputLayout = Object.freeze({
    version: 1,
    scalarInputs: Object.freeze(scalarInputs),
    queueInputs: Object.freeze(queueInputs),
  });
  const controlSlotCount =
    HEADER_SLOT_COUNT +
    scalarInputs.length * SCALAR_CONTROL_SLOT_COUNT +
    queueInputs.length * QUEUE_CONTROL_SLOT_COUNT;
  const scalarBindings = new Map<string, ScalarBinding>();
  scalarInputs.forEach((input, index) => {
    const revisionSlot = HEADER_SLOT_COUNT + index * SCALAR_CONTROL_SLOT_COUNT;
    scalarBindings.set(input.id, {
      ...input,
      revisionSlot,
      valueSlot: revisionSlot + 1,
    });
  });
  const queueBindings = new Map<string, QueueBinding>();
  let dataOffset = controlSlotCount * Int32Array.BYTES_PER_ELEMENT;
  queueInputs.forEach((input, index) => {
    const headSlot =
      HEADER_SLOT_COUNT +
      scalarInputs.length * SCALAR_CONTROL_SLOT_COUNT +
      index * QUEUE_CONTROL_SLOT_COUNT;
    queueBindings.set(input.id, {
      ...input,
      headSlot,
      tailSlot: headSlot + 1,
      dataOffset,
    });
    dataOffset += input.capacity;
  });
  return {
    layout,
    scalarBindings,
    queueBindings,
    controlSlotCount,
    byteLength: dataOffset,
    fingerprint: layoutFingerprint(layout),
  };
}

function assertChannelId(inputId: unknown, ids: Set<string>): asserts inputId is string {
  if (typeof inputId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(inputId)) {
    throw new TypeError(`Invalid shared device input id: ${String(inputId)}`);
  }
  if (ids.has(inputId)) {
    throw new Error(`Duplicate shared device input id: ${inputId}`);
  }
  ids.add(inputId);
}

function assertInt32(value: unknown, label: string): void {
  assertIntegerInRange(value, -2_147_483_648, 2_147_483_647, label);
}

function assertIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
}

function layoutFingerprint(layout: SharedDeviceInputLayout): number {
  const description = JSON.stringify({
    version: layout.version,
    scalarInputs: layout.scalarInputs,
    queueInputs: layout.queueInputs,
  });
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(description)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return signed(hash);
}

function sequenceDistance(start: number, end: number): number {
  return unsigned(end - start);
}

function addSequence(sequence: number, increment: number): number {
  return unsigned(sequence + increment);
}

function signed(value: number): number {
  return value | 0;
}

function unsigned(value: number): number {
  return value >>> 0;
}
