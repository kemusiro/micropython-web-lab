import { validateDeviceUiDefinition, type DeviceUiDefinition } from "./device-ui";
import type { SupportedLocale } from "../i18n/i18n";
import type { ConnectionGraphV1 } from "../connections/connection-model";

export interface ReferenceDeviceUi {
  readonly instanceId: string;
  readonly definition: DeviceUiDefinition;
}

export const REFERENCE_DEVICE_UIS: readonly ReferenceDeviceUi[] = Object.freeze([
  define("built-in-led", {
    version: 1,
    title: "内蔵LED",
    description: "Pico 2 Wの内蔵LED出力を表示します。",
    components: [
      {
        id: "output",
        kind: "digital-indicator",
        label: "出力",
        stateKey: "enabled",
        onLabel: "点灯",
        offLabel: "消灯",
      },
    ],
  }),
  define("button-gp15", {
    version: 1,
    title: "押しボタン",
    description: "GPIO 15へ接続したアクティブLowのモーメンタリスイッチです。",
    components: [
      { id: "press", kind: "momentary-button", label: "GPIO 15", controlId: "pressed" },
      {
        id: "level",
        kind: "digital-indicator",
        label: "入力レベル",
        stateKey: "value",
        onLabel: "HIGH",
        offLabel: "LOW",
      },
    ],
  }),
  define("analog-gp26", {
    version: 1,
    title: "アナログ入力",
    description: "GPIO 26／ADC0へ入力する16-bit値です。",
    components: [
      {
        id: "value",
        kind: "number-slider",
        label: "ADC値",
        controlId: "value",
        stateKey: "value",
        minimum: 0,
        maximum: 65_535,
        step: 1,
      },
    ],
  }),
  define("i2c-register-0x50", {
    version: 1,
    title: "I2Cレジスタ",
    description: "I2C0へ接続した8-bitレジスタデバイスです。",
    components: [
      { id: "address", kind: "state-text", label: "アドレス", stateKey: "address", format: "hex" },
      { id: "pointer", kind: "state-text", label: "ポインタ", stateKey: "pointer", format: "hex" },
      {
        id: "transactions",
        kind: "state-text",
        label: "トランザクション数",
        stateKey: "transactionCount",
        format: "integer",
      },
    ],
  }),
  define("ae-bme280-0x76", {
    version: 1,
    title: "BME280環境センサー",
    description: "秋月電子 AE-BME280（販売コード109421）をI2Cアドレス0x76で再現します。",
    components: [
      {
        id: "temperature",
        kind: "number-slider",
        label: "温度 (°C)",
        controlId: "temperatureC",
        stateKey: "temperatureC",
        minimum: -40,
        maximum: 85,
        step: 1,
      },
      {
        id: "humidity",
        kind: "number-slider",
        label: "湿度 (%RH)",
        controlId: "humidityPercent",
        stateKey: "humidityPercent",
        minimum: 0,
        maximum: 100,
        step: 1,
      },
      {
        id: "pressure",
        kind: "number-slider",
        label: "気圧 (hPa)",
        controlId: "pressureHpa",
        stateKey: "pressureHpa",
        minimum: 300,
        maximum: 1_100,
        step: 1,
      },
      {
        id: "address",
        kind: "state-text",
        label: "アドレス",
        stateKey: "address",
        format: "hex",
      },
      {
        id: "chip-id",
        kind: "state-text",
        label: "チップID",
        stateKey: "chipId",
        format: "hex",
      },
      {
        id: "transactions",
        kind: "state-text",
        label: "トランザクション数",
        stateKey: "transactionCount",
        format: "integer",
      },
    ],
  }),
  define("spi-register-0", {
    version: 1,
    title: "SPIレジスタ",
    description: "SPI0へ接続した全二重レジスタデバイスです。",
    components: [
      { id: "mode", kind: "state-text", label: "モード", stateKey: "mode", format: "integer" },
      {
        id: "baudrate",
        kind: "state-text",
        label: "ボーレート",
        stateKey: "baudrate",
        format: "integer",
      },
      {
        id: "transfers",
        kind: "state-text",
        label: "転送回数",
        stateKey: "transferCount",
        format: "integer",
      },
    ],
  }),
  define("qt095b-ssd1331", {
    version: 1,
    title: "SSD1331 RGB OLED",
    description:
      "秋月電子 QT095B（販売コード114435、96×64）をSPI0へ接続します。CS=GP5、D/C=GP2、RESET=GP3です。",
    components: [
      {
        id: "display",
        kind: "pixel-display",
        label: "96×64 RGB OLED",
        stateKey: "framebuffer",
        width: 96,
        height: 64,
        encoding: "rgb332-base64",
      },
      {
        id: "display-on",
        kind: "digital-indicator",
        label: "表示",
        stateKey: "displayOn",
        onLabel: "表示中",
        offLabel: "消灯",
      },
      {
        id: "baudrate",
        kind: "state-text",
        label: "ボーレート",
        stateKey: "baudrate",
        format: "integer",
      },
      {
        id: "transfers",
        kind: "state-text",
        label: "転送回数",
        stateKey: "transferCount",
        format: "integer",
      },
    ],
  }),
  define("gt-502mgg-n", {
    version: 1,
    title: "GT-502MGG-N GPS受信機",
    description:
      "秋月電子117980のUART GPS受信機です。起動後3秒で衛星捕捉し、1 HzのNMEA 0183とGP14のPPSを生成します。",
    components: [
      {
        id: "position",
        kind: "text-input",
        label: "測位位置（例: 35.681236,139.767125,40）",
        controlId: "positionText",
        maximumLength: 96,
        submitLabel: "NMEAを生成",
      },
      {
        id: "raw-receive",
        kind: "text-input",
        label: "互換UART受信文字列",
        controlId: "rawReceiveText",
        maximumLength: 256,
        submitLabel: "UARTへ送信",
      },
      {
        id: "acquisition",
        kind: "state-text",
        label: "衛星捕捉状態",
        stateKey: "acquisitionState",
      },
      {
        id: "fix",
        kind: "digital-indicator",
        label: "測位",
        stateKey: "fix",
        onLabel: "有効",
        offLabel: "無効",
      },
      {
        id: "pps",
        kind: "digital-indicator",
        label: "PPS (GP14)",
        stateKey: "pps",
        onLabel: "HIGH",
        offLabel: "LOW",
      },
      {
        id: "nmea-rate",
        kind: "state-text",
        label: "NMEA更新 (Hz)",
        stateKey: "nmeaRateHz",
        format: "integer",
      },
      {
        id: "latitude",
        kind: "state-text",
        label: "緯度",
        stateKey: "latitude",
      },
      {
        id: "longitude",
        kind: "state-text",
        label: "経度",
        stateKey: "longitude",
      },
      {
        id: "altitude",
        kind: "state-text",
        label: "高度 (m)",
        stateKey: "altitudeMeters",
      },
      {
        id: "satellites",
        kind: "state-text",
        label: "使用衛星数",
        stateKey: "satellites",
        format: "integer",
      },
      {
        id: "buffered",
        kind: "state-text",
        label: "モデル内待機バイト",
        stateKey: "bufferedBytes",
        format: "integer",
      },
      {
        id: "sentences",
        kind: "state-text",
        label: "生成NMEA文",
        stateKey: "sentenceCount",
        format: "integer",
      },
      {
        id: "skipped",
        kind: "state-text",
        label: "省略スナップショット",
        stateKey: "skippedSnapshots",
        format: "integer",
      },
      {
        id: "baudrate",
        kind: "state-text",
        label: "ボーレート",
        stateKey: "baudrate",
        format: "integer",
      },
    ],
  }),
  define("ostamc5a31a-vv", {
    version: 1,
    title: "OSTAMC5A31A-VV RGB LED",
    description:
      "秋月電子117578の抵抗内蔵・カソードコモンRGB LEDです。赤=GP18、緑=GP20、青=GP22のPWMで調光します。",
    components: [
      {
        id: "color",
        kind: "pixel-display",
        label: "PWM合成色",
        stateKey: "framebuffer",
        width: 1,
        height: 1,
        encoding: "rgb332-base64",
      },
      {
        id: "active",
        kind: "digital-indicator",
        label: "発光",
        stateKey: "active",
        onLabel: "点灯",
        offLabel: "消灯",
      },
      {
        id: "hex-color",
        kind: "state-text",
        label: "RGB色",
        stateKey: "colorHex",
      },
      {
        id: "red-duty",
        kind: "state-text",
        label: "赤 GP18 duty_u16",
        stateKey: "redDutyU16",
        format: "integer",
      },
      {
        id: "green-duty",
        kind: "state-text",
        label: "緑 GP20 duty_u16",
        stateKey: "greenDutyU16",
        format: "integer",
      },
      {
        id: "blue-duty",
        kind: "state-text",
        label: "青 GP22 duty_u16",
        stateKey: "blueDutyU16",
        format: "integer",
      },
      {
        id: "updates",
        kind: "state-text",
        label: "PWM更新回数",
        stateKey: "updateCount",
        format: "integer",
      },
    ],
  }),
  define("pwm-indicator-gp16", {
    version: 1,
    title: "PWMインジケーター",
    description: "GPIO 16のPWM信号を正規化して表示します。",
    components: [
      {
        id: "enabled",
        kind: "digital-indicator",
        label: "PWM出力",
        stateKey: "enabled",
        onLabel: "有効",
        offLabel: "無効",
      },
      {
        id: "frequency",
        kind: "state-text",
        label: "周波数 (Hz)",
        stateKey: "frequencyHz",
        format: "integer",
      },
      {
        id: "duty",
        kind: "state-text",
        label: "duty_u16",
        stateKey: "dutyU16",
        format: "integer",
      },
      {
        id: "inverted",
        kind: "state-text",
        label: "反転",
        stateKey: "inverted",
        format: "boolean",
      },
    ],
  }),
]);

const ENGLISH_REFERENCE_TEXT: Readonly<Record<string, string>> = {
  "内蔵LED": "Built-in LED",
  "Pico 2 Wの内蔵LED出力を表示します。": "Shows the Pico 2 W built-in LED output.",
  "出力": "Output", "点灯": "On", "消灯": "Off",
  "押しボタン": "Push button",
  "GPIO 15へ接続したアクティブLowのモーメンタリスイッチです。":
    "An active-low momentary switch connected to GPIO 15.",
  "入力レベル": "Input level",
  "アナログ入力": "Analog input", "GPIO 26／ADC0へ入力する16-bit値です。": "A 16-bit value supplied to GPIO 26 / ADC0.",
  "ADC値": "ADC value",
  "I2Cレジスタ": "I2C register", "I2C0へ接続した8-bitレジスタデバイスです。": "An 8-bit register device connected to I2C0.",
  "アドレス": "Address", "ポインタ": "Pointer", "トランザクション数": "Transactions",
  "BME280環境センサー": "BME280 environmental sensor",
  "秋月電子 AE-BME280（販売コード109421）をI2Cアドレス0x76で再現します。":
    "Models the Akizuki AE-BME280 (product 109421) at I2C address 0x76.",
  "温度 (°C)": "Temperature (°C)", "湿度 (%RH)": "Humidity (%RH)", "気圧 (hPa)": "Pressure (hPa)",
  "チップID": "Chip ID",
  "SPIレジスタ": "SPI register", "SPI0へ接続した全二重レジスタデバイスです。": "A full-duplex register device connected to SPI0.",
  "モード": "Mode", "ボーレート": "Baud rate", "転送回数": "Transfers",
  "秋月電子 QT095B（販売コード114435、96×64）をSPI0へ接続します。CS=GP5、D/C=GP2、RESET=GP3です。":
    "Connects the Akizuki QT095B (product 114435, 96×64) to SPI0 with CS=GP5, D/C=GP2, and RESET=GP3.",
  "表示": "Display", "表示中": "On",
  "GT-502MGG-N GPS受信機": "GT-502MGG-N GPS receiver",
  "秋月電子117980のUART GPS受信機です。起動後3秒で衛星捕捉し、1 HzのNMEA 0183とGP14のPPSを生成します。":
    "A UART GPS receiver based on Akizuki 117980. It acquires a fix after 3 seconds and generates 1 Hz NMEA 0183 plus PPS on GP14.",
  "測位位置（例: 35.681236,139.767125,40）": "Position (example: 35.681236,139.767125,40)",
  "NMEAを生成": "Generate NMEA", "互換UART受信文字列": "Compatible UART receive text", "UARTへ送信": "Send to UART",
  "衛星捕捉状態": "Acquisition state", "測位": "Fix", "有効": "Enabled", "無効": "Disabled",
  "NMEA更新 (Hz)": "NMEA rate (Hz)", "緯度": "Latitude", "経度": "Longitude", "高度 (m)": "Altitude (m)",
  "使用衛星数": "Satellites used", "モデル内待機バイト": "Buffered model bytes", "生成NMEA文": "Generated NMEA sentences",
  "省略スナップショット": "Skipped snapshots",
  "秋月電子117578の抵抗内蔵・カソードコモンRGB LEDです。赤=GP18、緑=GP20、青=GP22のPWMで調光します。":
    "An Akizuki 117578 common-cathode RGB LED with built-in resistors, dimmed by PWM on red=GP18, green=GP20, and blue=GP22.",
  "PWM合成色": "PWM mixed color", "発光": "Light output", "RGB色": "RGB color",
  "赤 GP18 duty_u16": "Red GP18 duty_u16", "緑 GP20 duty_u16": "Green GP20 duty_u16", "青 GP22 duty_u16": "Blue GP22 duty_u16",
  "PWM更新回数": "PWM updates", "PWMインジケーター": "PWM indicator",
  "GPIO 16のPWM信号を正規化して表示します。": "Shows the normalized PWM signal on GPIO 16.",
  "PWM出力": "PWM output", "周波数 (Hz)": "Frequency (Hz)", "反転": "Inverted",
};

export function referenceDeviceUisForLocale(locale: SupportedLocale): readonly ReferenceDeviceUi[] {
  if (locale === "ja") {
    return REFERENCE_DEVICE_UIS;
  }
  return REFERENCE_DEVICE_UIS.map((entry) =>
    define(entry.instanceId, {
      ...entry.definition,
      title: englishReferenceText(entry.definition.title),
      ...(entry.definition.description === undefined
        ? {}
        : { description: englishReferenceText(entry.definition.description) }),
      components: entry.definition.components.map((component) => ({
        ...component,
        label: englishReferenceText(component.label),
        ...("onLabel" in component ? { onLabel: englishReferenceText(component.onLabel) } : {}),
        ...("offLabel" in component ? { offLabel: englishReferenceText(component.offLabel) } : {}),
        ...("submitLabel" in component
          ? { submitLabel: englishReferenceText(component.submitLabel) }
          : {}),
      })),
    }),
  );
}

export function referenceDeviceUisForConnectionGraph(
  graph: ConnectionGraphV1,
  locale: SupportedLocale,
): readonly ReferenceDeviceUi[] {
  const connectedDevices = new Map(graph.devices.map((device) => [device.instanceId, device]));
  return referenceDeviceUisForLocale(locale).flatMap((entry) => {
    const connected = connectedDevices.get(entry.instanceId);
    if (connected === undefined) {
      return [];
    }
    if (entry.instanceId !== "button-gp15") {
      return [entry];
    }
    const input = connected.ports.find((port) => port.portId === "input")?.endpoint;
    if (input?.kind !== "gpio") {
      return [entry];
    }
    const pin = input.pin;
    return [{
      ...entry,
      definition: {
        ...entry.definition,
        description:
          locale === "ja"
            ? `${pin}へ接続したアクティブLowのモーメンタリスイッチです。`
            : `An active-low momentary switch connected to ${pin}.`,
        components: entry.definition.components.map((component) =>
          component.id === "press" ? { ...component, label: pin } : component,
        ),
      },
    }];
  });
}

export function findReferenceDeviceUi(instanceId: string): ReferenceDeviceUi | undefined {
  return REFERENCE_DEVICE_UIS.find((entry) => entry.instanceId === instanceId);
}

function define(instanceId: string, source: unknown): ReferenceDeviceUi {
  return Object.freeze({ instanceId, definition: validateDeviceUiDefinition(source) });
}

function englishReferenceText(value: string): string {
  return ENGLISH_REFERENCE_TEXT[value] ?? value;
}
