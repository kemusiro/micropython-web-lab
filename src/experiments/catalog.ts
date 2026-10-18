import artifacts from "../../runtime/micropython/artifacts.sha256?raw";
import versions from "../../runtime/micropython/versions.env?raw";
import { MANAGED_CONNECTION_GRAPH, MANAGED_DEVICE_CATALOG_GRAPH } from "../connections/managed-connection-graph";
import { FIRST_EXPERIMENT_SOURCE } from "../examples/first-experiment";
import { deviceExampleSource } from "../examples/device-examples";
import { YM2203_SCORE_EXAMPLE_SOURCE } from "../examples/ym2203-example";
import { prepareYm2203Library } from "../examples/ym2203-library";
import { ProjectFiles } from "../project/filesystem";
import { createExperiment, type ExperimentSet, type RuntimeReference } from "./record";
import type { SupportedLocale } from "../i18n/i18n";

const version = /^MICROPYTHON_VERSION=(.+)$/m.exec(versions)?.[1];
const buildHash = /^([a-f0-9]{64}) +src\/vendor\/micropython-build\/micropython.wasm$/m.exec(artifacts)?.[1];
if (!version || !buildHash) throw new Error("Missing pinned runtime metadata");
export const MANAGED_EXPERIMENT_RUNTIME: RuntimeReference = Object.freeze({ id: "web-lab-restricted", version, buildHash });
export type TemplateId = "led-blink" | "button-input" | "button-led" | "device-lab" | "ym2203";
export type CategoryId = "devices" | "physical" | "sound" | "learn" | "books";
type Copy = readonly [string, string];
export const categoryDefinitions: readonly { id: CategoryId; title: Copy; description: Copy }[] = [
  { id: "devices", title: ["デバイスを試す", "Explore devices"], description: ["LEDやセンサーを動かす", "Try LEDs and sensors"] },
  { id: "physical", title: ["ロボットと制御", "Robots and control"], description: ["一軸アームの物理実験は準備中", "Arm physics experiments are in preparation"] },
  { id: "sound", title: ["音と音楽をつくる", "Create sound and music"], description: ["YM2203で音色や合奏を試す", "Explore YM2203 tones and ensembles"] },
  { id: "learn", title: ["プログラミングを学ぶ", "Learn programming"], description: ["入力・処理・出力の関係を見る", "Observe input, processing and output"] },
  { id: "books", title: ["書籍から学ぶ", "Learn with books"], description: ["書籍連動の教材は準備中", "Book companion material is in preparation"] },
];
export const templateDefinitions: readonly { id: TemplateId; categories: readonly CategoryId[]; title: Copy; description: Copy; lesson: Copy }[] = [
  { id: "led-blink", categories: ["devices", "learn"], title: ["LEDを点滅させる", "Blink an LED"],
    description: ["内蔵LEDとmain.pyを用意。間隔を変えて観察します。", "Includes the built-in LED and main.py. Change the blink interval."],
    lesson: ["interval_msを変えて実行すると、点滅の間隔が変わります。開くだけではコードを実行しません。", "Change interval_ms and run again. Opening a set does not run its code."] },
  { id: "button-input", categories: ["devices", "learn"], title: ["ボタンの入力を読む", "Read a button"],
    description: ["GP15のボタンとmain.pyを用意。8秒間の押下・解放を出力します。", "Includes a GP15 button and main.py. Reports presses and releases for eight seconds."],
    lesson: ["実行してからボタンを押す・離す操作を試します。プルアップ入力は解放時1、押下時0です。", "Run, then press and release the button. A pulled-up input is 1 when released and 0 when pressed."] },
  { id: "button-led", categories: ["devices", "learn"], title: ["ボタンでLEDを点ける", "Control an LED with a button"],
    description: ["LED、GP15のボタン、main.pyを用意。6秒間、入力と点灯を見比べます。", "Includes an LED, GP15 button and main.py. Compare input and output for six seconds."],
    lesson: ["実行中にボタンを押すとLEDが点きます。led.value(1 - button.value())が入力を反転します。通常終了時はfinallyで消灯します。強制停止では実行環境を初期化します。", "Press the button during execution to light the LED. led.value(1 - button.value()) inverts the input. finally turns it off on normal completion; a forced stop resets the runtime."] },
  { id: "device-lab", categories: ["devices"], title: ["自由なデバイス実験", "Device workspace"],
    description: ["既定のデバイス一式とLEDサンプルを用意。配線や各デバイスの作例を試せます。", "Includes the default devices and LED sample. Explore wiring and device examples."],
    lesson: ["構成・配線から接続を編集できます。各カードのサンプルは、このセット内の無題タブとして開きます。", "Edit connections under Devices and wiring. Card examples open as untitled tabs inside this set."] },
  { id: "ym2203", categories: ["sound", "devices"], title: ["YM2203の合奏", "YM2203 ensemble"],
    description: ["音源、合奏コード、必要なライブラリを用意。ミュートを解除して実行します。", "Includes the sound module, ensemble code and libraries. Unmute, then run."],
    lesson: ["スピーカーは最初ミュートです。ミュートを解除して実行します。波形と音色編集は既存の音源カードから使えます。セット切替では予約音声を破棄します。", "The speaker starts muted. Unmute and run. Use the sound card for the waveform and patch editor. Switching sets discards scheduled audio."] },
];
export function localized(copy: Copy, locale: SupportedLocale): string { return copy[locale === "ja" ? 0 : 1]; }

export async function createTemplateCopy(id: TemplateId, locale: SupportedLocale): Promise<ExperimentSet> {
  const definition = templateDefinitions.find(entry => entry.id === id);
  if (!definition) throw new Error("Unknown bundled template");
  const source = id === "button-led" ? BUTTON_LED_SOURCE : id === "button-input" ? deviceExampleSource("button-gp15")!
    : id === "ym2203" ? YM2203_SCORE_EXAMPLE_SOURCE : FIRST_EXPERIMENT_SOURCE;
  const files = new ProjectFiles();
  files.write("main.py", new TextEncoder().encode(source));
  const tabs = [{ id: "main", title: id === "button-input" ? (locale === "ja" ? "ボタンの実験" : "Button experiment") : "main.py", path: "main.py", source }];
  const filesystem = id === "ym2203" ? prepareYm2203Library(files, tabs, true, true) : files.snapshot();
  const instanceIds = id === "device-lab" ? null : id === "ym2203" ? ["ym2203-prototype"]
    : id === "led-blink" ? ["built-in-led"] : id === "button-input" ? ["button-gp15"] : ["built-in-led", "button-gp15"];
  const connectionGraph = instanceIds === null ? MANAGED_CONNECTION_GRAPH : { ...MANAGED_DEVICE_CATALOG_GRAPH,
    devices: MANAGED_DEVICE_CATALOG_GRAPH.devices.filter(device => instanceIds.includes(device.instanceId)) };
  // Hash only bundled, locale-independent experiment contents; user copies never update in place.
  const payload = JSON.stringify({ id, version: "1.0.0", filesystem, source, connectionGraph, runtimeRef: MANAGED_EXPERIMENT_RUNTIME });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  return createExperiment({ version: 1, filesystem, tabs, activeTabId: "main" }, { kind: "board", connectionGraph }, {
    title: localized(definition.title, locale), origin: { kind: "template", id, version: "1.0.0", hash }, runtimeRef: MANAGED_EXPERIMENT_RUNTIME,
  });
}

export const BUTTON_LED_SOURCE = `from machine import Pin
from time import sleep_ms, ticks_diff, ticks_ms

led = Pin("LED", Pin.OUT)
button = Pin(15, Pin.IN, Pin.PULL_UP)
started = ticks_ms()

try:
    while ticks_diff(ticks_ms(), started) < 6000:
        led.value(1 - button.value())
        sleep_ms(20)
finally:
    led.off()
`;
