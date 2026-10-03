import {
  MAX_VIRTUAL_ADC_VALUE,
  type VirtualDeviceState,
} from "../simulation/virtual-gpio";
import {
  MAX_VIRTUAL_I2C_TRANSFER_BYTES,
  type VirtualI2cOperation,
  type VirtualI2cTransactionState,
} from "../simulation/virtual-i2c";
import type { SharedDeviceInputTransfer } from "../simulation/shared-device-inputs";
import type { DebuggerChannelTransfer } from "./debugger-channel";
import type { ConnectionGraphV1 } from "../connections/connection-model";
import {
  DEFAULT_DEVICE_LIMITS,
  type DeviceState,
  type DeviceStateEvent,
} from "../device-api/types";

export const RUNTIME_PROTOCOL_VERSION = 12 as const;
export const MAX_SCRIPT_CHARACTERS = 200_000;
export const MAX_DEBUGGER_GLOBALS = 100;
export const MAX_DEBUGGER_VARIABLE_NAME_CHARACTERS = 128;
export const MAX_DEBUGGER_VARIABLE_TYPE_CHARACTERS = 64;
export const MAX_DEBUGGER_VARIABLE_VALUE_CHARACTERS = 256;

export interface DebuggerVariable {
  name: string;
  typeName: string;
  value: string;
}

export type RuntimeDeviceState = VirtualDeviceState | VirtualI2cTransactionState;

export type RuntimeStatus =
  | "starting"
  | "ready"
  | "executing"
  | "debugging"
  | "stopped"
  | "error";

export type ScriptExecutionMode = "run" | "debug";

export type MainToWorkerMessage =
  | {
      version: typeof RUNTIME_PROTOCOL_VERSION;
      type: "start";
      deviceInputs?: SharedDeviceInputTransfer;
      debuggerChannel?: DebuggerChannelTransfer;
      connectionGraph?: ConnectionGraphV1;
    }
  | { version: typeof RUNTIME_PROTOCOL_VERSION; type: "input"; data: string }
  | {
      version: typeof RUNTIME_PROTOCOL_VERSION;
      type: "execute";
      requestId: string;
      source: string;
      mode: ScriptExecutionMode;
    };

export type WorkerToMainMessage =
  | {
      version: typeof RUNTIME_PROTOCOL_VERSION;
      type: "ready";
      micropythonVersion: string;
      runtimeBuild: {
        sourceVersion: string;
        sourceCommit: string;
        variant: string;
      };
    }
  | {
      version: typeof RUNTIME_PROTOCOL_VERSION;
      type: "stdout" | "stderr";
      data: string;
    }
  | {
      version: typeof RUNTIME_PROTOCOL_VERSION;
      type: "error";
      message: string;
    }
  | {
      version: typeof RUNTIME_PROTOCOL_VERSION;
      type: "execution-result";
      requestId: string;
      ok: boolean;
      error?: string;
    }
  | {
      version: typeof RUNTIME_PROTOCOL_VERSION;
      type: "debugger-paused";
      requestId: string;
      filename: string;
      line: number;
      functionName: string;
      globals: readonly DebuggerVariable[];
    }
  | {
      version: typeof RUNTIME_PROTOCOL_VERSION;
      type: "debugger-resumed";
      requestId: string;
    }
  | {
      version: typeof RUNTIME_PROTOCOL_VERSION;
      type: "device-state";
      state: RuntimeDeviceState;
    }
  | {
      version: typeof RUNTIME_PROTOCOL_VERSION;
      type: "device-model-state";
      event: DeviceStateEvent;
    };

export function isWorkerToMainMessage(value: unknown): value is WorkerToMainMessage {
  if (!isRecord(value) || value.version !== RUNTIME_PROTOCOL_VERSION || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "ready":
      return (
        typeof value.micropythonVersion === "string" &&
        isRecord(value.runtimeBuild) &&
        isNonEmptyString(value.runtimeBuild.sourceVersion) &&
        isCommitHash(value.runtimeBuild.sourceCommit) &&
        isNonEmptyString(value.runtimeBuild.variant)
      );
    case "stdout":
    case "stderr":
      return typeof value.data === "string";
    case "error":
      return typeof value.message === "string";
    case "execution-result":
      return (
        typeof value.requestId === "string" &&
        typeof value.ok === "boolean" &&
        (value.error === undefined || typeof value.error === "string") &&
        (value.ok || typeof value.error === "string")
      );
    case "debugger-paused":
      return (
        isNonEmptyString(value.requestId) &&
        isNonEmptyString(value.filename) &&
        typeof value.line === "number" &&
        Number.isSafeInteger(value.line) &&
        value.line > 0 &&
        isNonEmptyString(value.functionName) &&
        isDebuggerVariables(value.globals)
      );
    case "debugger-resumed":
      return isNonEmptyString(value.requestId);
    case "device-state":
      return isVirtualDeviceState(value.state);
    case "device-model-state":
      return isDeviceStateEvent(value.event);
    default:
      return false;
  }
}

function isDebuggerVariables(value: unknown): value is readonly DebuggerVariable[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_DEBUGGER_GLOBALS &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        isBoundedString(entry.name, MAX_DEBUGGER_VARIABLE_NAME_CHARACTERS, false) &&
        isBoundedString(entry.typeName, MAX_DEBUGGER_VARIABLE_TYPE_CHARACTERS, false) &&
        isBoundedString(entry.value, MAX_DEBUGGER_VARIABLE_VALUE_CHARACTERS, true),
    )
  );
}

function isBoundedString(value: unknown, maximum: number, allowEmpty: boolean): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    Array.from(value).length <= maximum
  );
}

function isDeviceStateEvent(value: unknown): value is DeviceStateEvent {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.instanceId) ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence <= 0 ||
    !isDeviceState(value.state)
  ) {
    return false;
  }
  return encodedByteLength(value.state) <= DEFAULT_DEVICE_LIMITS.maxStateBytes;
}

function isDeviceState(value: unknown): value is DeviceState {
  if (!isRecord(value) || Array.isArray(value)) {
    return false;
  }
  for (const stateValue of Object.values(value)) {
    if (
      stateValue !== null &&
      typeof stateValue !== "string" &&
      typeof stateValue !== "number" &&
      typeof stateValue !== "boolean"
    ) {
      return false;
    }
    if (typeof stateValue === "number" && !Number.isFinite(stateValue)) {
      return false;
    }
  }
  return true;
}

function encodedByteLength(value: DeviceState): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCommitHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function isVirtualDeviceState(value: unknown): value is RuntimeDeviceState {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === "i2c-transaction") {
    return isVirtualI2cTransactionState(value);
  }
  const commonStateIsValid =
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence > 0 &&
    typeof value.pinId === "string" &&
    value.pinId.length > 0;
  if (!commonStateIsValid) {
    return false;
  }
  if (value.kind === "gpio-pin") {
    return (
      (value.mode === "input" || value.mode === "output") &&
      (value.value === 0 || value.value === 1)
    );
  }
  return (
    value.kind === "adc-channel" &&
    typeof value.value === "number" &&
    Number.isInteger(value.value) &&
    value.value >= 0 &&
    value.value <= MAX_VIRTUAL_ADC_VALUE
  );
}

function isVirtualI2cTransactionState(
  value: Record<string, unknown>,
): value is Record<string, unknown> & VirtualI2cTransactionState {
  const operations: readonly VirtualI2cOperation[] = [
    "scan",
    "read",
    "write",
    "read-memory",
    "write-memory",
  ];
  const addressIsValid =
    value.address === undefined ||
    (typeof value.address === "number" &&
      Number.isSafeInteger(value.address) &&
      value.address >= 0x08 &&
      value.address <= 0x77);
  const memoryAddressIsValid =
    value.memoryAddress === undefined ||
    (typeof value.memoryAddress === "number" &&
      Number.isSafeInteger(value.memoryAddress) &&
      value.memoryAddress >= 0 &&
      value.memoryAddress <= 0xff);
  return (
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence > 0 &&
    typeof value.busId === "number" &&
    Number.isSafeInteger(value.busId) &&
    value.busId >= 0 &&
    typeof value.operation === "string" &&
    operations.includes(value.operation as VirtualI2cOperation) &&
    typeof value.byteCount === "number" &&
    Number.isSafeInteger(value.byteCount) &&
    value.byteCount >= 0 &&
    value.byteCount <= MAX_VIRTUAL_I2C_TRANSFER_BYTES &&
    addressIsValid &&
    memoryAddressIsValid &&
    (value.operation === "scan" ? value.address === undefined : value.address !== undefined) &&
    ((value.operation === "read-memory" || value.operation === "write-memory")
      ? value.memoryAddress !== undefined
      : value.memoryAddress === undefined)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
