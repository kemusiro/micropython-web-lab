import "./fm-prototype.css";
import { RuntimeClient } from "./runtime/client";
import type { RuntimeStatus, WorkerToMainMessage } from "./runtime/protocol";
import { validateConnectionGraph } from "./connections/connection-model";
import { YM_PROTOTYPE_GRAPH } from "./devices/ym2203-prototype";
import { YM_INSTANCE } from "./audio/ym2203-protocol";
import { YmAudio } from "./audio/ym2203-audio";
import { YM2203_REGISTER_EXAMPLE_SOURCE as YM2203_EXAMPLE_SOURCE } from "./examples/ym2203-example";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element ${id}`);
  return found as T;
}
const source = element<HTMLTextAreaElement>("source");
const run = element<HTMLButtonElement>("run");
const enable = element<HTMLButtonElement>("enable-audio");
const mute = element<HTMLButtonElement>("mute-audio");
const volume = element<HTMLInputElement>("volume");
const output = element<HTMLPreElement>("output");
const canvas = element<HTMLCanvasElement>("scope");
const context2d = canvas.getContext("2d");
const wave = new Float32Array(512);
let status: RuntimeStatus = "starting";
let muted = false;
const audio = new YmAudio(message => {
  if (status === "starting" || status === "stopped" || status === "error") return;
  element<HTMLMeterElement>("fm-meter").value = message.fmRms;
  element<HTMLMeterElement>("ssg-meter").value = message.ssgRms;
  element("playing").textContent = message.active ? "PLAYING" : "STANDBY";
  element("progress").textContent = `${message.applied} applied / ${message.pending} pending`;
  // Bounded diagnostic scalars allow browser verification without exposing the core.
  canvas.dataset.fmRms = String(message.fmRms);
  canvas.dataset.ssgRms = String(message.ssgRms);
  canvas.dataset.rms = String(message.rms);
  canvas.dataset.peak = String(message.peak);
  canvas.dataset.frame = String(message.frame);
  canvas.dataset.applied = String(message.applied);
  canvas.dataset.pending = String(message.pending);
  canvas.dataset.active = String(message.active);
}, text => { element("audio-status").textContent = text; updateControls(); });
const runtime = new RuntimeClient({
  onMessage: handleMessage,
  onStatus(next) {
    status = next;
    element("runtime-status").textContent = ({ starting: "起動中", ready: "実行可能", executing: "Python実行中", debugging: "デバッグ中", stopped: "停止中", error: "エラー" })[next];
    if (next === "starting" || next === "stopped" || next === "error") silence();
    updateControls();
  },
}, undefined, { connectionGraph: validateConnectionGraph(YM_PROTOTYPE_GRAPH) });
function updateControls(): void { run.disabled = status !== "ready" || !audio.ready; mute.disabled = !audio.ready; }
function log(text: string): void { output.textContent = (output.textContent + text).slice(-12000); output.scrollTop = output.scrollHeight; }
function silence(): void {
  audio.stop();
  element("playing").textContent = "STANDBY";
  element("progress").textContent = `${canvas.dataset.applied ?? 0} applied / 0 pending`;
  canvas.dataset.active = "false";
  canvas.dataset.pending = "0";
  element<HTMLMeterElement>("fm-meter").value = 0;
  element<HTMLMeterElement>("ssg-meter").value = 0;
}
function handleMessage(message: WorkerToMainMessage): void {
  switch (message.type) {
    case "prototype-audio":
      try { audio.send(message.command); }
      catch (error) { log(`${String(error)}\n`); runtime.stop(); }
      break;
    case "stdout": case "stderr": log(message.data); break;
    case "error": silence(); log(`${message.message}\n`); break;
    case "execution-result":
      log(message.ok ? "[Python実行完了]\n" : `[実行エラー] ${message.error}\n`);
      if (!message.ok) silence();
      break;
    case "device-model-state":
      if (message.event.instanceId === YM_INSTANCE) {
        const state = message.event.state;
        element("module-status").textContent = `I2C 0x44 · ${state.transactions} transactions · ${state.queuedEvents} queued · ${state.plays} plays`;
      }
      break;
  }
}
source.value = YM2203_EXAMPLE_SOURCE;
enable.addEventListener("click", async () => {
  enable.disabled = true;
  try { await audio.enable(); audio.volume(muted ? 0 : Number(volume.value)); }
  catch (error) { element("audio-status").textContent = String(error); }
  finally { enable.disabled = false; updateControls(); }
});
run.addEventListener("click", () => {
  audio.volume(muted ? 0 : Number(volume.value));
  output.textContent = "";
  runtime.executeScript(source.value);
});
element("stop").addEventListener("click", () => runtime.stop());
element("restart").addEventListener("click", () => runtime.restart());
element("restore").addEventListener("click", () => { source.value = YM2203_EXAMPLE_SOURCE; });
volume.addEventListener("input", () => audio.volume(muted ? 0 : Number(volume.value)));
mute.addEventListener("click", () => { muted = !muted; audio.volume(muted ? 0 : Number(volume.value)); mute.textContent = muted ? "消音を解除" : "消音"; });
window.addEventListener("pagehide", () => { runtime.stop(); void audio.close(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { runtime.stop(); element("audio-status").textContent = "バックグラウンド移行で停止しました。再起動して実行してください。"; }
});
function draw(): void {
  if (context2d) {
    audio.analyser?.getFloatTimeDomainData(wave);
    if (!audio.analyser) wave.fill(0);
    canvas.dataset.outputRms = String(Math.sqrt(wave.reduce((sum, value) => sum + value * value, 0) / wave.length));
    context2d.fillStyle = "#081d17"; context2d.fillRect(0, 0, canvas.width, canvas.height);
    context2d.strokeStyle = "#234638"; context2d.lineWidth = 1;
    context2d.beginPath(); context2d.moveTo(0, 90); context2d.lineTo(640, 90); context2d.stroke();
    const maximum = wave.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
    const displayScale = maximum > 0.000001 ? canvas.height * 0.4 / maximum : 1;
    context2d.strokeStyle = "#a3f3c3"; context2d.lineWidth = 2; context2d.beginPath();
    for (let i = 0; i < wave.length; i++) {
      const x = i * canvas.width / wave.length, y = canvas.height / 2 - wave[i]! * displayScale;
      if (i === 0) context2d.moveTo(x, y); else context2d.lineTo(x, y);
    }
    context2d.stroke();
  }
  requestAnimationFrame(draw);
}
runtime.start();
requestAnimationFrame(draw);
