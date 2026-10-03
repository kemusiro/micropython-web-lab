import type { DeviceAction, DeviceState, DeviceStateValue } from "../device-api/types";
import { t } from "../i18n/i18n";

export const DEVICE_UI_VERSION = 1 as const;
export const MAX_DEVICE_UI_COMPONENTS = 32;
export const MAX_DEVICE_UI_TEXT_INPUT_LENGTH = 256;
export const MAX_DEVICE_UI_PIXEL_COUNT = 16_384;

export type DeviceUiComponent =
  | DeviceUiStateText
  | DeviceUiDigitalIndicator
  | DeviceUiPixelDisplay
  | DeviceUiMomentaryButton
  | DeviceUiNumberSlider
  | DeviceUiTextInput;

export interface DeviceUiDefinition {
  readonly version: 1;
  readonly title: string;
  readonly description?: string;
  readonly components: readonly DeviceUiComponent[];
}

interface DeviceUiComponentBase {
  readonly id: string;
  readonly label: string;
}

export interface DeviceUiStateText extends DeviceUiComponentBase {
  readonly kind: "state-text";
  readonly stateKey: string;
  readonly format?: "text" | "integer" | "boolean" | "hex";
}

export interface DeviceUiDigitalIndicator extends DeviceUiComponentBase {
  readonly kind: "digital-indicator";
  readonly stateKey: string;
  readonly onLabel: string;
  readonly offLabel: string;
}

export interface DeviceUiPixelDisplay extends DeviceUiComponentBase {
  readonly kind: "pixel-display";
  readonly stateKey: string;
  readonly width: number;
  readonly height: number;
  readonly encoding: "rgb332-base64";
}

export interface DeviceUiMomentaryButton extends DeviceUiComponentBase {
  readonly kind: "momentary-button";
  readonly controlId: string;
}

export interface DeviceUiNumberSlider extends DeviceUiComponentBase {
  readonly kind: "number-slider";
  readonly controlId: string;
  readonly stateKey: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
}

export interface DeviceUiTextInput extends DeviceUiComponentBase {
  readonly kind: "text-input";
  readonly controlId: string;
  readonly maximumLength: number;
  readonly submitLabel: string;
}

export interface DeviceUiStateView {
  readonly componentId: string;
  readonly kind: "state-text" | "digital-indicator" | "pixel-display" | "number-slider";
  readonly value: DeviceStateValue;
  readonly displayValue: string;
  readonly active?: boolean;
  readonly error?: string;
}

export function validateDeviceUiDefinition(value: unknown): DeviceUiDefinition {
  const definition = requiredRecord(value, "Device UI definition");
  rejectUnknownKeys(
    definition,
    ["version", "title", "description", "components"],
    "Device UI definition",
  );
  if (definition.version !== DEVICE_UI_VERSION) {
    throw new RangeError(`Unsupported Device UI version: ${String(definition.version)}`);
  }
  const title = requiredShortString(definition.title, "Device UI title");
  const description =
    definition.description === undefined
      ? undefined
      : requiredShortString(definition.description, "Device UI description", 512);
  if (!Array.isArray(definition.components)) {
    throw new TypeError("Device UI components must be an array.");
  }
  if (definition.components.length > MAX_DEVICE_UI_COMPONENTS) {
    throw new RangeError(`Device UI supports at most ${MAX_DEVICE_UI_COMPONENTS} components.`);
  }
  const ids = new Set<string>();
  const components = definition.components.map((component) =>
    validateComponent(component, ids),
  );
  return Object.freeze({
    version: DEVICE_UI_VERSION,
    title,
    ...(description === undefined ? {} : { description }),
    components: Object.freeze(components),
  });
}

export function createDeviceAction(
  definition: DeviceUiDefinition,
  componentId: string,
  value: unknown,
): DeviceAction {
  const component = definition.components.find((candidate) => candidate.id === componentId);
  if (component === undefined) {
    throw new RangeError(`Unknown Device UI component: ${componentId}`);
  }
  switch (component.kind) {
    case "momentary-button":
      if (typeof value !== "boolean") {
        throw new TypeError(`Device UI control ${componentId} expects a boolean value.`);
      }
      return { controlId: component.controlId, value };
    case "number-slider": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`Device UI control ${componentId} expects a finite number.`);
      }
      if (value < component.minimum || value > component.maximum) {
        throw new RangeError(
          `Device UI control ${componentId} must be from ${component.minimum} to ${component.maximum}.`,
        );
      }
      const steps = (value - component.minimum) / component.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        throw new RangeError(`Device UI control ${componentId} does not align to its step.`);
      }
      return { controlId: component.controlId, value };
    }
    case "text-input":
      if (typeof value !== "string") {
        throw new TypeError(`Device UI control ${componentId} expects a string value.`);
      }
      if (value.length > component.maximumLength) {
        throw new RangeError(
          `Device UI control ${componentId} accepts at most ${component.maximumLength} characters.`,
        );
      }
      return { controlId: component.controlId, value };
    case "state-text":
    case "digital-indicator":
    case "pixel-display":
      throw new TypeError(`Device UI component ${componentId} is not interactive.`);
  }
}

export function createDeviceUiStateViews(
  definition: DeviceUiDefinition,
  state: DeviceState,
): readonly DeviceUiStateView[] {
  const views: DeviceUiStateView[] = [];
  for (const component of definition.components) {
    if (component.kind === "momentary-button" || component.kind === "text-input") {
      continue;
    }
    const value = state[component.stateKey];
    if (value === undefined) {
      views.push({
        componentId: component.id,
        kind: component.kind,
        value: null,
        displayValue: "表示できません",
        error: `状態キー ${component.stateKey} がありません。`,
      });
      continue;
    }
    try {
      switch (component.kind) {
        case "state-text":
          views.push({
            componentId: component.id,
            kind: component.kind,
            value,
            displayValue: formatStateValue(value, component.format ?? "text"),
          });
          break;
        case "digital-indicator": {
          const active = normalizeDigitalState(value, component.id);
          views.push({
            componentId: component.id,
            kind: component.kind,
            value,
            active,
            displayValue: active ? component.onLabel : component.offLabel,
          });
          break;
        }
        case "pixel-display": {
          if (typeof value !== "string") {
            throw new TypeError("ピクセル表示の状態値は文字列ではありません。");
          }
          const expectedLength = Math.ceil((component.width * component.height) / 3) * 4;
          if (
            value.length !== expectedLength ||
            !isBase64(value) ||
            base64DecodedLength(value) !== component.width * component.height
          ) {
            throw new RangeError(
              `ピクセル表示の状態値は${component.width}×${component.height} RGB332ではありません。`,
            );
          }
          views.push({
            componentId: component.id,
            kind: component.kind,
            value,
            displayValue: `${component.width}×${component.height}`,
          });
          break;
        }
        case "number-slider":
          if (
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            value < component.minimum ||
            value > component.maximum
          ) {
            throw new RangeError(`状態値は${component.minimum}〜${component.maximum}の数値ではありません。`);
          }
          views.push({
            componentId: component.id,
            kind: component.kind,
            value,
            displayValue: String(value),
          });
          break;
      }
    } catch (error) {
      views.push({
        componentId: component.id,
        kind: component.kind,
        value,
        displayValue: "表示できません",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return Object.freeze(views);
}

function validateComponent(value: unknown, ids: Set<string>): DeviceUiComponent {
  const component = requiredRecord(value, "Device UI component");
  const id = requiredIdentifier(component.id, "Device UI component id");
  if (ids.has(id)) {
    throw new Error(`Duplicate Device UI component id: ${id}`);
  }
  ids.add(id);
  const label = requiredShortString(component.label, `Device UI component ${id} label`);
  switch (component.kind) {
    case "state-text": {
      rejectUnknownKeys(component, ["id", "kind", "label", "stateKey", "format"], id);
      const format = component.format ?? "text";
      if (!["text", "integer", "boolean", "hex"].includes(String(format))) {
        throw new RangeError(`Unsupported state text format: ${String(format)}`);
      }
      return Object.freeze({
        id,
        kind: component.kind,
        label,
        stateKey: requiredIdentifier(component.stateKey, `${id} stateKey`),
        format: format as DeviceUiStateText["format"],
      });
    }
    case "digital-indicator":
      rejectUnknownKeys(
        component,
        ["id", "kind", "label", "stateKey", "onLabel", "offLabel"],
        id,
      );
      return Object.freeze({
        id,
        kind: component.kind,
        label,
        stateKey: requiredIdentifier(component.stateKey, `${id} stateKey`),
        onLabel: requiredShortString(component.onLabel, `${id} onLabel`),
        offLabel: requiredShortString(component.offLabel, `${id} offLabel`),
      });
    case "pixel-display": {
      rejectUnknownKeys(
        component,
        ["id", "kind", "label", "stateKey", "width", "height", "encoding"],
        id,
      );
      const width = requiredPositiveInteger(component.width, `${id} width`);
      const height = requiredPositiveInteger(component.height, `${id} height`);
      if (width * height > MAX_DEVICE_UI_PIXEL_COUNT) {
        throw new RangeError(
          `Device UI pixel display ${id} supports at most ${MAX_DEVICE_UI_PIXEL_COUNT} pixels.`,
        );
      }
      if (component.encoding !== "rgb332-base64") {
        throw new RangeError(`Unsupported Device UI pixel encoding: ${String(component.encoding)}`);
      }
      return Object.freeze({
        id,
        kind: component.kind,
        label,
        stateKey: requiredIdentifier(component.stateKey, `${id} stateKey`),
        width,
        height,
        encoding: component.encoding,
      });
    }
    case "momentary-button":
      rejectUnknownKeys(component, ["id", "kind", "label", "controlId"], id);
      return Object.freeze({
        id,
        kind: component.kind,
        label,
        controlId: requiredIdentifier(component.controlId, `${id} controlId`),
      });
    case "number-slider": {
      rejectUnknownKeys(
        component,
        ["id", "kind", "label", "controlId", "stateKey", "minimum", "maximum", "step"],
        id,
      );
      const minimum = requiredFiniteNumber(component.minimum, `${id} minimum`);
      const maximum = requiredFiniteNumber(component.maximum, `${id} maximum`);
      const step = requiredFiniteNumber(component.step, `${id} step`);
      if (minimum >= maximum || step <= 0 || step > maximum - minimum) {
        throw new RangeError(`Device UI slider ${id} has an invalid range or step.`);
      }
      return Object.freeze({
        id,
        kind: component.kind,
        label,
        controlId: requiredIdentifier(component.controlId, `${id} controlId`),
        stateKey: requiredIdentifier(component.stateKey, `${id} stateKey`),
        minimum,
        maximum,
        step,
      });
    }
    case "text-input": {
      rejectUnknownKeys(
        component,
        ["id", "kind", "label", "controlId", "maximumLength", "submitLabel"],
        id,
      );
      const maximumLength = component.maximumLength;
      if (
        typeof maximumLength !== "number" ||
        !Number.isSafeInteger(maximumLength) ||
        maximumLength < 1 ||
        maximumLength > MAX_DEVICE_UI_TEXT_INPUT_LENGTH
      ) {
        throw new RangeError(
          `Device UI text input ${id} maximumLength must be from 1 to ${MAX_DEVICE_UI_TEXT_INPUT_LENGTH}.`,
        );
      }
      return Object.freeze({
        id,
        kind: component.kind,
        label,
        controlId: requiredIdentifier(component.controlId, `${id} controlId`),
        maximumLength,
        submitLabel: requiredShortString(component.submitLabel, `${id} submitLabel`),
      });
    }
    default:
      throw new RangeError(`Unsupported Device UI component kind: ${String(component.kind)}`);
  }
}

function formatStateValue(value: DeviceStateValue, format: NonNullable<DeviceUiStateText["format"]>): string {
  switch (format) {
    case "text":
      return value === null ? "—" : String(value);
    case "integer":
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new TypeError("状態値は整数ではありません。");
      }
      return value.toLocaleString("ja-JP");
    case "boolean":
      if (typeof value !== "boolean") {
        throw new TypeError("状態値は真偽値ではありません。");
      }
      return value ? t("common.yes") : t("common.no");
    case "hex":
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError("状態値は非負整数ではありません。");
      }
      return `0x${value.toString(16).toUpperCase()}`;
  }
}

function normalizeDigitalState(value: DeviceStateValue, componentId: string): boolean {
  if (value === 0 || value === false) {
    return false;
  }
  if (value === 1 || value === true) {
    return true;
  }
  throw new TypeError(`Device UI indicator ${componentId} requires 0, 1, or a boolean.`);
}

function isBase64(value: string): boolean {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function base64DecodedLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${label} contains unsupported field ${key}.`);
    }
  }
}

function requiredIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new TypeError(`${label} must be a valid identifier.`);
  }
  return value;
}

function requiredShortString(value: unknown, label: string, maximum = 128): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new TypeError(`${label} must contain from 1 to ${maximum} characters.`);
  }
  return value;
}

function requiredFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}
