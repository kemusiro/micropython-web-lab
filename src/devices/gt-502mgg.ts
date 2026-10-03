import type {
  DeviceContext,
  DeviceDefinition,
  DeviceModel,
  UartConfiguration,
} from "../device-api/types.ts";

export const GT_502MGG_DEFAULT_BAUDRATE = 9_600;
export const GT_502MGG_DEFAULT_LATITUDE = 35.681236;
export const GT_502MGG_DEFAULT_LONGITUDE = 139.767125;
export const GT_502MGG_DEFAULT_ALTITUDE_METERS = 40;
export const GT_502MGG_ACQUISITION_MILLISECONDS = 3_000;
export const GT_502MGG_NMEA_INTERVAL_MILLISECONDS = 1_000;
export const GT_502MGG_PPS_PULSE_MILLISECONDS = 100;

const LEGACY_ECHO_BAUDRATE = 115_200;
const FIXED_UTC_EPOCH_MILLISECONDS = Date.UTC(2026, 7, 30, 3, 4, 5);

export function createGt502MggDefinition(): DeviceDefinition {
  return {
    manifest: {
      schemaVersion: 1,
      id: "org.micropython-web-lab.gt-502mgg-n",
      version: "0.2.0",
      deviceApiVersion: 1,
      name: "GT-502MGG-N GNSS Receiver",
      description:
        "Akizuki 117980 / YIC GT-502MGG-N UART GNSS receiver with NMEA 0183 and polled PPS output",
      license: "MIT",
      entrypoint: "./dist/device.js",
      requires: { boardCapabilities: ["uart-controller-v1", "digital-gpio-v1"] },
      ports: [
        { id: "uart", kind: "uart-peer" },
        { id: "pps", kind: "gpio-driver" },
      ],
    },
    create: createGt502MggModel,
  };
}

export function createGt502MggNmeaSnapshot(
  latitude = GT_502MGG_DEFAULT_LATITUDE,
  longitude = GT_502MGG_DEFAULT_LONGITUDE,
  altitudeMeters = GT_502MGG_DEFAULT_ALTITUDE_METERS,
  elapsedSeconds = 0,
  hasFix = true,
): readonly string[] {
  assertFiniteRange(latitude, -90, 90, "GT-502MGG-N latitude");
  assertFiniteRange(longitude, -180, 180, "GT-502MGG-N longitude");
  assertFiniteRange(altitudeMeters, -1_000, 20_000, "GT-502MGG-N altitude");
  if (!Number.isSafeInteger(elapsedSeconds) || elapsedSeconds < 0) {
    throw new RangeError("GT-502MGG-N elapsed seconds must be a non-negative safe integer.");
  }
  const latitudeField = coordinateField(latitude, 2, "N", "S");
  const longitudeField = coordinateField(longitude, 3, "E", "W");
  const timestamp = nmeaTimestamp(elapsedSeconds);
  const quality = hasFix ? "1" : "0";
  const satellites = hasFix ? "08" : "00";
  const status = hasFix ? "A" : "V";
  const mode = hasFix ? "A" : "N";
  return Object.freeze([
    nmeaSentence(
      `GNGGA,${timestamp.time},${latitudeField.value},${latitudeField.hemisphere},${longitudeField.value},${longitudeField.hemisphere},${quality},${satellites},${hasFix ? "0.9" : "99.9"},${altitudeMeters.toFixed(1)},M,39.0,M,,`,
    ),
    nmeaSentence(
      `GNRMC,${timestamp.time},${status},${latitudeField.value},${latitudeField.hemisphere},${longitudeField.value},${longitudeField.hemisphere},0.00,0.00,${timestamp.date},,,${mode}`,
    ),
  ]);
}

function createGt502MggModel(context: DeviceContext): DeviceModel {
  const receiveQueue: number[] = [];
  const monotonicMilliseconds =
    context.clock?.monotonicMilliseconds.bind(context.clock) ?? (() => 0);
  let configuration: UartConfiguration = defaultConfiguration();
  let latitude = GT_502MGG_DEFAULT_LATITUDE;
  let longitude = GT_502MGG_DEFAULT_LONGITUDE;
  let altitudeMeters = GT_502MGG_DEFAULT_ALTITUDE_METERS;
  let sentenceCount = 0;
  let commandBytes = 0;
  let configured = false;
  let lastSentence = "";
  let startedAtMilliseconds = monotonicMilliseconds();
  let currentMilliseconds = startedAtMilliseconds;
  let lastGeneratedSecond = -1;
  let skippedSnapshots = 0;
  let replacedSnapshots = 0;
  let lastEmittedState = "";

  const elapsedMilliseconds = (): number =>
    Math.max(0, currentMilliseconds - startedAtMilliseconds);
  const hasFix = (): boolean => elapsedMilliseconds() >= GT_502MGG_ACQUISITION_MILLISECONDS;
  const ppsValue = (): 0 | 1 =>
    hasFix() &&
    elapsedMilliseconds() % GT_502MGG_NMEA_INTERVAL_MILLISECONDS <
      GT_502MGG_PPS_PULSE_MILLISECONDS
      ? 1
      : 0;
  const emit = (): void => {
    const state = {
      fix: hasFix(),
      acquisitionState: hasFix() ? "fixed" : "acquiring",
      acquisitionElapsedMs: Math.floor(elapsedMilliseconds()),
      latitude,
      longitude,
      altitudeMeters,
      satellites: hasFix() ? 8 : 0,
      pps: ppsValue() === 1,
      ppsPin: 14,
      nmeaRateHz: 1,
      bufferedBytes: receiveQueue.length,
      sentenceCount,
      skippedSnapshots,
      replacedSnapshots,
      commandBytes,
      baudrate: configuration.baudrate,
      lastSentence,
    } as const;
    const serialized = JSON.stringify(state);
    if (serialized === lastEmittedState) {
      return;
    }
    lastEmittedState = serialized;
    context.emitState(state);
  };
  const enqueueSnapshot = (replacePending: boolean, elapsedSecond: number): void => {
    const sentences = createGt502MggNmeaSnapshot(
      latitude,
      longitude,
      altitudeMeters,
      elapsedSecond,
      hasFix(),
    );
    const encoded = new TextEncoder().encode(`${sentences.join("\r\n")}\r\n`);
    const nextLength = (replacePending ? 0 : receiveQueue.length) + encoded.length;
    if (nextLength > context.limits.maxUartBufferedBytes) {
      throw new RangeError("GT-502MGG-N NMEA queue would exceed its byte limit.");
    }
    if (replacePending && receiveQueue.length > 0) {
      receiveQueue.length = 0;
      replacedSnapshots += 1;
    }
    receiveQueue.push(...encoded);
    sentenceCount += sentences.length;
    lastSentence = sentences.at(-1)!;
  };
  const synchronizeTime = (generateNmea: boolean): void => {
    currentMilliseconds = monotonicMilliseconds();
    if (generateNmea && configured && configuration.baudrate === GT_502MGG_DEFAULT_BAUDRATE) {
      const elapsedSecond = Math.floor(
        elapsedMilliseconds() / GT_502MGG_NMEA_INTERVAL_MILLISECONDS,
      );
      if (elapsedSecond > lastGeneratedSecond) {
        if (lastGeneratedSecond >= 0) {
          skippedSnapshots += Math.max(0, elapsedSecond - lastGeneratedSecond - 1);
        }
        enqueueSnapshot(true, elapsedSecond);
        lastGeneratedSecond = elapsedSecond;
      }
    }
    emit();
  };
  const resetState = (): void => {
    receiveQueue.length = 0;
    configuration = defaultConfiguration();
    latitude = GT_502MGG_DEFAULT_LATITUDE;
    longitude = GT_502MGG_DEFAULT_LONGITUDE;
    altitudeMeters = GT_502MGG_DEFAULT_ALTITUDE_METERS;
    sentenceCount = 0;
    commandBytes = 0;
    configured = false;
    lastSentence = "";
    startedAtMilliseconds = monotonicMilliseconds();
    currentMilliseconds = startedAtMilliseconds;
    lastGeneratedSecond = -1;
    skippedSnapshots = 0;
    replacedSnapshots = 0;
    lastEmittedState = "";
  };

  emit();
  return {
    ports: {
      uart: {
        kind: "uart-peer",
        configure(nextConfiguration): void {
          configuration = { ...nextConfiguration };
          configured = true;
          synchronizeTime(true);
        },
        writeFromBoard(data): number {
          synchronizeTime(configuration.baudrate === GT_502MGG_DEFAULT_BAUDRATE);
          commandBytes += data.length;
          if (configuration.baudrate === LEGACY_ECHO_BAUDRATE) {
            if (receiveQueue.length + data.length > context.limits.maxUartBufferedBytes) {
              throw new RangeError("GT-502MGG-N legacy echo queue would exceed its byte limit.");
            }
            receiveQueue.push(...data);
          }
          emit();
          return data.length;
        },
        availableToBoard(): number {
          synchronizeTime(true);
          return receiveQueue.length;
        },
        readForBoard(maxBytes): Uint8Array {
          synchronizeTime(true);
          const byteCount = Math.min(maxBytes, receiveQueue.length);
          const result = Uint8Array.from(receiveQueue.splice(0, byteCount));
          emit();
          return result;
        },
      },
      pps: {
        kind: "gpio-driver",
        read(): 0 | 1 {
          synchronizeTime(false);
          return ppsValue();
        },
      },
    },
    handleAction(action): void {
      if (action.controlId !== "position" || typeof action.value !== "string") {
        throw new TypeError("GT-502MGG-N expects a position action string.");
      }
      synchronizeTime(false);
      const position = parsePosition(action.value);
      latitude = position.latitude;
      longitude = position.longitude;
      altitudeMeters = position.altitudeMeters;
      if (configured && configuration.baudrate === GT_502MGG_DEFAULT_BAUDRATE) {
        const elapsedSecond = Math.floor(
          elapsedMilliseconds() / GT_502MGG_NMEA_INTERVAL_MILLISECONDS,
        );
        enqueueSnapshot(true, elapsedSecond);
        lastGeneratedSecond = elapsedSecond;
      }
      emit();
    },
    reset(): void {
      resetState();
      emit();
    },
  };
}

function parsePosition(value: string): {
  latitude: number;
  longitude: number;
  altitudeMeters: number;
} {
  const fields = value.split(",").map((field) => field.trim());
  if (fields.length !== 3 || fields.some((field) => field.length === 0)) {
    throw new TypeError("GT-502MGG-N position must be latitude,longitude,altitude.");
  }
  const [latitude, longitude, altitudeMeters] = fields.map(Number) as [number, number, number];
  assertFiniteRange(latitude, -90, 90, "GT-502MGG-N latitude");
  assertFiniteRange(longitude, -180, 180, "GT-502MGG-N longitude");
  assertFiniteRange(altitudeMeters, -1_000, 20_000, "GT-502MGG-N altitude");
  return { latitude, longitude, altitudeMeters };
}

function coordinateField(
  coordinate: number,
  degreeDigits: number,
  positiveHemisphere: string,
  negativeHemisphere: string,
): { value: string; hemisphere: string } {
  const absolute = Math.abs(coordinate);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  return {
    value: `${String(degrees).padStart(degreeDigits, "0")}${minutes
      .toFixed(5)
      .padStart(8, "0")}`,
    hemisphere: coordinate < 0 ? negativeHemisphere : positiveHemisphere,
  };
}

function nmeaTimestamp(elapsedSeconds: number): { time: string; date: string } {
  const timestamp = new Date(FIXED_UTC_EPOCH_MILLISECONDS + elapsedSeconds * 1_000);
  const hours = String(timestamp.getUTCHours()).padStart(2, "0");
  const minutes = String(timestamp.getUTCMinutes()).padStart(2, "0");
  const seconds = String(timestamp.getUTCSeconds()).padStart(2, "0");
  const day = String(timestamp.getUTCDate()).padStart(2, "0");
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, "0");
  const year = String(timestamp.getUTCFullYear() % 100).padStart(2, "0");
  return { time: `${hours}${minutes}${seconds}.000`, date: `${day}${month}${year}` };
}

function nmeaSentence(body: string): string {
  let checksum = 0;
  for (const character of body) {
    checksum ^= character.charCodeAt(0);
  }
  return `$${body}*${checksum.toString(16).toUpperCase().padStart(2, "0")}`;
}

function assertFiniteRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be from ${minimum} to ${maximum}.`);
  }
}

function defaultConfiguration(): UartConfiguration {
  return {
    baudrate: GT_502MGG_DEFAULT_BAUDRATE,
    bits: 8,
    parity: "none",
    stop: 1,
  };
}
