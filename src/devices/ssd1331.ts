import type {
  DeviceContext,
  DeviceDefinition,
  DeviceModel,
  SpiConfiguration,
} from "../device-api/types.ts";

export const SSD1331_WIDTH = 96;
export const SSD1331_HEIGHT = 64;
const DISPLAY_OFF = 0xae;
const DISPLAY_ON = 0xaf;
const SET_COLUMN = 0x15;
const SET_ROW = 0x75;
const SET_REMAP = 0xa0;
const DRAW_LINE = 0x21;
const DRAW_RECTANGLE = 0x22;
const CLEAR_WINDOW = 0x25;
const SET_FILL = 0x26;

const COMMAND_PARAMETER_COUNTS = new Map<number, number>([
  [0x15, 2],
  [0x21, 7],
  [0x22, 10],
  [0x23, 6],
  [0x24, 4],
  [0x25, 4],
  [0x26, 1],
  [0x27, 5],
  [0x2e, 0],
  [0x2f, 0],
  [0x75, 2],
  [0x81, 1],
  [0x82, 1],
  [0x83, 1],
  [0x87, 1],
  [0x8a, 1],
  [0x8b, 1],
  [0x8c, 1],
  [0xa0, 1],
  [0xa1, 1],
  [0xa2, 1],
  [0xa4, 0],
  [0xa5, 0],
  [0xa6, 0],
  [0xa7, 0],
  [0xa8, 1],
  [0xad, 1],
  [0xae, 0],
  [0xaf, 0],
  [0xb0, 1],
  [0xb1, 1],
  [0xb3, 1],
  [0xb9, 0],
  [0xbb, 1],
  [0xbe, 1],
]);

export function createSsd1331Definition(): DeviceDefinition {
  return {
    manifest: {
      schemaVersion: 1,
      id: "org.micropython-web-lab.qt095b-ssd1331",
      version: "0.1.0",
      deviceApiVersion: 1,
      name: "QT095B SSD1331 RGB OLED",
      description: "Akizuki QT095B 96x64 RGB OLED display using the SSD1331 controller",
      license: "MIT",
      entrypoint: "./dist/device.js",
      requires: { boardCapabilities: ["spi-controller-v1", "digital-gpio-v1"] },
      ports: [
        { id: "spi", kind: "spi-target" },
        { id: "cs", kind: "gpio-observer" },
        { id: "dc", kind: "gpio-observer" },
        { id: "reset", kind: "gpio-observer" },
      ],
    },
    create: createSsd1331Model,
  };
}

function createSsd1331Model(context: DeviceContext): DeviceModel {
  const framebuffer = new Uint16Array(SSD1331_WIDTH * SSD1331_HEIGHT);
  let chipSelected = false;
  let dataMode = false;
  let resetHigh = true;
  let displayOn = false;
  let remap = 0x72;
  let fillEnabled = false;
  let columnStart = 0;
  let columnEnd = SSD1331_WIDTH - 1;
  let rowStart = 0;
  let rowEnd = SSD1331_HEIGHT - 1;
  let column = columnStart;
  let row = rowStart;
  let pendingPixelHighByte: number | null = null;
  let pendingCommand: number | null = null;
  let pendingParameterCount = 0;
  let commandParameters: number[] = [];
  let transferCount = 0;
  let commandCount = 0;
  let dataBytes = 0;
  let stateDirty = false;
  let configuration: SpiConfiguration = {
    baudrate: 1_000_000,
    polarity: 0,
    phase: 0,
    firstBit: "msb",
    bits: 8,
  };

  const resetController = (): void => {
    framebuffer.fill(0);
    displayOn = false;
    remap = 0x72;
    fillEnabled = false;
    columnStart = 0;
    columnEnd = SSD1331_WIDTH - 1;
    rowStart = 0;
    rowEnd = SSD1331_HEIGHT - 1;
    column = columnStart;
    row = rowStart;
    pendingPixelHighByte = null;
    pendingCommand = null;
    pendingParameterCount = 0;
    commandParameters = [];
    stateDirty = true;
  };
  const emit = (): void => {
    context.emitState({
      width: SSD1331_WIDTH,
      height: SSD1331_HEIGHT,
      displayOn,
      transferCount,
      commandCount,
      dataBytes,
      baudrate: configuration.baudrate,
      mode: configuration.polarity * 2 + configuration.phase,
      framebuffer: encodeFramebufferRgb332(framebuffer, displayOn),
    });
    stateDirty = false;
  };
  const markChanged = (): void => {
    stateDirty = true;
  };
  const emitIfTransactionComplete = (): void => {
    if (stateDirty && !chipSelected) {
      emit();
    }
  };
  const setPixel = (x: number, y: number, color: number): void => {
    if (x < 0 || x >= SSD1331_WIDTH || y < 0 || y >= SSD1331_HEIGHT) {
      return;
    }
    framebuffer[y * SSD1331_WIDTH + x] = color;
  };
  const advanceAddress = (): void => {
    const verticalIncrement = (remap & 0x01) !== 0;
    if (verticalIncrement) {
      row += 1;
      if (row > rowEnd) {
        row = rowStart;
        column = column >= columnEnd ? columnStart : column + 1;
      }
      return;
    }
    column += 1;
    if (column > columnEnd) {
      column = columnStart;
      row = row >= rowEnd ? rowStart : row + 1;
    }
  };
  const executeCommand = (command: number, parameters: readonly number[]): void => {
    commandCount += 1;
    switch (command) {
      case SET_COLUMN:
        columnStart = clamp(parameters[0] ?? 0, 0, SSD1331_WIDTH - 1);
        columnEnd = clamp(parameters[1] ?? SSD1331_WIDTH - 1, columnStart, SSD1331_WIDTH - 1);
        column = columnStart;
        break;
      case SET_ROW:
        rowStart = clamp(parameters[0] ?? 0, 0, SSD1331_HEIGHT - 1);
        rowEnd = clamp(parameters[1] ?? SSD1331_HEIGHT - 1, rowStart, SSD1331_HEIGHT - 1);
        row = rowStart;
        break;
      case SET_REMAP:
        remap = parameters[0] ?? remap;
        break;
      case DISPLAY_OFF:
        displayOn = false;
        markChanged();
        break;
      case DISPLAY_ON:
        displayOn = true;
        markChanged();
        break;
      case SET_FILL:
        fillEnabled = ((parameters[0] ?? 0) & 0x01) !== 0;
        break;
      case CLEAR_WINDOW:
        clearWindow(framebuffer, parameters);
        markChanged();
        break;
      case DRAW_LINE:
        drawLine(framebuffer, parameters);
        markChanged();
        break;
      case DRAW_RECTANGLE:
        drawRectangle(framebuffer, parameters, fillEnabled);
        markChanged();
        break;
    }
    markChanged();
  };
  const processCommandByte = (byte: number): void => {
    if (pendingCommand === null) {
      pendingCommand = byte;
      pendingParameterCount = COMMAND_PARAMETER_COUNTS.get(byte) ?? 0;
      commandParameters = [];
      if (pendingParameterCount === 0) {
        executeCommand(pendingCommand, commandParameters);
        pendingCommand = null;
      }
      return;
    }
    commandParameters.push(byte);
    if (commandParameters.length === pendingParameterCount) {
      executeCommand(pendingCommand, commandParameters);
      pendingCommand = null;
      pendingParameterCount = 0;
      commandParameters = [];
    }
  };
  const processDataByte = (byte: number): void => {
    dataBytes += 1;
    if (pendingPixelHighByte === null) {
      pendingPixelHighByte = byte;
      return;
    }
    const color = (pendingPixelHighByte << 8) | byte;
    pendingPixelHighByte = null;
    setPixel(column, row, color);
    advanceAddress();
    markChanged();
  };

  resetController();
  emit();
  return {
    ports: {
      spi: {
        kind: "spi-target",
        configure(nextConfiguration): void {
          configuration = { ...nextConfiguration };
          markChanged();
          emitIfTransactionComplete();
        },
        transfer(writeData): Uint8Array {
          const response = new Uint8Array(writeData.length);
          if (!chipSelected || !resetHigh) {
            return response;
          }
          transferCount += 1;
          for (const byte of writeData) {
            if (dataMode) {
              processDataByte(byte);
            } else {
              pendingPixelHighByte = null;
              processCommandByte(byte);
            }
          }
          markChanged();
          return response;
        },
      },
      cs: {
        kind: "gpio-observer",
        write(value): void {
          const nextSelected = value === 0;
          if (nextSelected === chipSelected) {
            return;
          }
          chipSelected = nextSelected;
          if (!chipSelected) {
            pendingPixelHighByte = null;
          }
          markChanged();
          emitIfTransactionComplete();
        },
      },
      dc: {
        kind: "gpio-observer",
        write(value): void {
          dataMode = value === 1;
          if (!dataMode) {
            pendingPixelHighByte = null;
          }
        },
      },
      reset: {
        kind: "gpio-observer",
        write(value): void {
          const nextResetHigh = value === 1;
          if (nextResetHigh === resetHigh) {
            return;
          }
          resetHigh = nextResetHigh;
          if (!resetHigh) {
            resetController();
          }
          markChanged();
          emitIfTransactionComplete();
        },
      },
    },
    reset(): void {
      chipSelected = false;
      dataMode = false;
      resetHigh = true;
      transferCount = 0;
      commandCount = 0;
      dataBytes = 0;
      resetController();
      emit();
    },
  };
}

function clearWindow(framebuffer: Uint16Array, parameters: readonly number[]): void {
  const x0 = clamp(parameters[0] ?? 0, 0, SSD1331_WIDTH - 1);
  const y0 = clamp(parameters[1] ?? 0, 0, SSD1331_HEIGHT - 1);
  const x1 = clamp(parameters[2] ?? x0, x0, SSD1331_WIDTH - 1);
  const y1 = clamp(parameters[3] ?? y0, y0, SSD1331_HEIGHT - 1);
  for (let y = y0; y <= y1; y += 1) {
    framebuffer.fill(0, y * SSD1331_WIDTH + x0, y * SSD1331_WIDTH + x1 + 1);
  }
}

function drawLine(framebuffer: Uint16Array, parameters: readonly number[]): void {
  let x0 = clamp(parameters[0] ?? 0, 0, SSD1331_WIDTH - 1);
  let y0 = clamp(parameters[1] ?? 0, 0, SSD1331_HEIGHT - 1);
  const x1 = clamp(parameters[2] ?? x0, 0, SSD1331_WIDTH - 1);
  const y1 = clamp(parameters[3] ?? y0, 0, SSD1331_HEIGHT - 1);
  const color = rgb6To565(parameters[4] ?? 0, parameters[5] ?? 0, parameters[6] ?? 0);
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    framebuffer[y0 * SSD1331_WIDTH + x0] = color;
    if (x0 === x1 && y0 === y1) {
      break;
    }
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x0 += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y0 += sy;
    }
  }
}

function drawRectangle(
  framebuffer: Uint16Array,
  parameters: readonly number[],
  fillEnabled: boolean,
): void {
  const x0 = clamp(parameters[0] ?? 0, 0, SSD1331_WIDTH - 1);
  const y0 = clamp(parameters[1] ?? 0, 0, SSD1331_HEIGHT - 1);
  const x1 = clamp(parameters[2] ?? x0, x0, SSD1331_WIDTH - 1);
  const y1 = clamp(parameters[3] ?? y0, y0, SSD1331_HEIGHT - 1);
  const outline = rgb6To565(parameters[4] ?? 0, parameters[5] ?? 0, parameters[6] ?? 0);
  const fill = rgb6To565(parameters[7] ?? 0, parameters[8] ?? 0, parameters[9] ?? 0);
  if (fillEnabled) {
    for (let y = y0; y <= y1; y += 1) {
      framebuffer.fill(fill, y * SSD1331_WIDTH + x0, y * SSD1331_WIDTH + x1 + 1);
    }
  }
  for (let x = x0; x <= x1; x += 1) {
    framebuffer[y0 * SSD1331_WIDTH + x] = outline;
    framebuffer[y1 * SSD1331_WIDTH + x] = outline;
  }
  for (let y = y0; y <= y1; y += 1) {
    framebuffer[y * SSD1331_WIDTH + x0] = outline;
    framebuffer[y * SSD1331_WIDTH + x1] = outline;
  }
}

function rgb6To565(red: number, green: number, blue: number): number {
  return ((red & 0x3e) << 10) | ((green & 0x3f) << 5) | ((blue & 0x3e) >> 1);
}

function encodeFramebufferRgb332(framebuffer: Uint16Array, visible: boolean): string {
  const encoded = new Uint8Array(framebuffer.length);
  if (visible) {
    for (let index = 0; index < framebuffer.length; index += 1) {
      const color = framebuffer[index]!;
      encoded[index] =
        (((color >> 13) & 0x07) << 5) |
        (((color >> 8) & 0x07) << 2) |
        ((color >> 3) & 0x03);
    }
  }
  return encodeBase64(encoded);
}

function encodeBase64(data: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";
  for (let index = 0; index < data.length; index += 3) {
    const first = data[index]!;
    const second = data[index + 1];
    const third = data[index + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += alphabet[(combined >> 18) & 0x3f];
    encoded += alphabet[(combined >> 12) & 0x3f];
    encoded += second === undefined ? "=" : alphabet[(combined >> 6) & 0x3f];
    encoded += third === undefined ? "=" : alphabet[combined & 0x3f];
  }
  return encoded;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
