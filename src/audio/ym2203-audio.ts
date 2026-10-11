import workletUrl from "./ym2203.worklet.ts?worker&url";
import wasmUrl from "../vendor/ymfm-build/ym2203.wasm?url";
import { isYmCommand, type YmCommand } from "./ym2203-protocol";
import { isAudioMeter, isYmReceipt, YmDeliveryTracker, type AudioMeter, type YmDeliveryState } from "./ym2203-delivery";
export type { AudioMeter } from "./ym2203-delivery";

export class YmAudio {
  #context: AudioContext | null = null;
  #node: AudioWorkletNode | null = null;
  #gain: GainNode | null = null;
  #analyser: AnalyserNode | null = null;
  #generation = 0;
  readonly #delivery = new YmDeliveryTracker();
  #ready = false;
  #preparing: Promise<void> | null = null;
  #abort: AbortController | null = null;
  #cancelInitialization: (() => void) | null = null;
  constructor(readonly report: (message: AudioMeter) => void, readonly status: (text: string) => void,
    readonly delivery: (state: YmDeliveryState) => void = () => {}) {}
  get ready(): boolean { return this.#ready && this.#context?.state === "running"; }
  get prepared(): boolean { return this.#ready; }
  get analyser(): AnalyserNode | null { return this.#analyser; }
  async enable(): Promise<void> {
    const preparing = this.prepare();
    const resuming = this.resume(); // Keep activation inside the original click.
    await preparing;
    await resuming;
  }
  prepare(): Promise<void> {
    if (this.#ready) return Promise.resolve();
    if (this.#preparing) return this.#preparing;
    const task = this.initialize();
    this.#preparing = task;
    void task.finally(() => { if (this.#preparing === task) this.#preparing = null; }).catch(() => {});
    return task;
  }
  async resume(): Promise<void> {
    const context = this.#context;
    if (!context || context.state === "running") return;
    await context.resume();
  }
  private audioStatus(context: AudioContext): void {
    this.status(context.state === "running"
      ? `音声有効 · ${context.sampleRate} Hz · 出力遅延目安 ${Math.round(context.baseLatency * 1000)} ms`
      : "音声処理はクリック待ちです。ミュートの切り替えなどの操作で開始します。");
  }
  private async initialize(): Promise<void> {
    if (!window.AudioContext || !window.isSecureContext) throw new Error("AudioWorklet requires HTTPS or localhost and a supported browser.");
    const generation = ++this.#generation;
    const context = new AudioContext({ latencyHint: "interactive" });
    this.#context = context;
    const abort = new AbortController(); this.#abort = abort;
    context.onstatechange = () => {
      if (generation !== this.#generation || context !== this.#context || !this.#ready) return;
      if (context.state !== "running") {
        this.stop(); this.audioStatus(context);
      } else this.audioStatus(context);
    };
    // Start from the click handler before awaiting any loading.
    // A restored connection may prepare while browser autoplay keeps it suspended.
    void context.resume().catch(() => { if (generation === this.#generation) this.audioStatus(context); });
    try {
      if (!context.audioWorklet) throw new Error("AudioWorklet is unavailable.");
      const response = await fetch(wasmUrl, { signal: abort.signal });
      if (!response.ok) throw new Error("Failed to load YM2203 audio core.");
      const module = await WebAssembly.compile(await response.arrayBuffer());
      await context.audioWorklet.addModule(workletUrl);
      if (generation !== this.#generation) { await context.close(); return; }
      const node = new AudioWorkletNode(context, "ym2203-prototype", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { module } });
      const gain = context.createGain(); gain.gain.value = 0;
      const analyser = context.createAnalyser(); analyser.fftSize = 512;
      node.connect(gain).connect(analyser).connect(context.destination);
      this.#node = node; this.#gain = gain; this.#analyser = analyser;
      // The first envelope of every new worklet resets it in the current epoch.
      this.stop();
      node.onprocessorerror = () => { if (generation !== this.#generation || node !== this.#node) return; this.stop(); this.#ready = false; this.status("音源処理エラー：ミュートを切り替えるか、再接続して再試行してください。"); void this.close(); };
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { this.#cancelInitialization = null; reject(new Error("AudioWorklet initialization timed out.")); }, 5000);
        this.#cancelInitialization = () => { clearTimeout(timer); reject(new Error("Audio initialization cancelled.")); };
        node.port.onmessage = ({ data }) => {
          if (generation !== this.#generation || node !== this.#node) return;
          if (data?.type === "ready") { clearTimeout(timer); this.#cancelInitialization = null; resolve(); }
          else if (isYmReceipt(data)) {
            if (this.#delivery.accept(data)) this.delivery(this.#delivery.state);
          } else if (isAudioMeter(data)) {
            const current = this.#delivery.render(data);
            this.delivery(this.#delivery.state);
            if (current) this.report(data);
          } else if (data?.type === "fault") {
            this.stop(); this.#ready = false; this.status(String(data.message)); void this.close();
          }
        };
      });
      if (generation !== this.#generation) { node.disconnect(); return; }
      this.#ready = true;
      this.audioStatus(context);
    } catch (error) {
      if (generation === this.#generation) await this.close();
      else if (context.state !== "closed") await context.close();
      throw error;
    }
  }
  send(command: YmCommand): void {
    if (!isYmCommand(command)) throw new TypeError("Invalid host audio command.");
    if (!this.#ready || !this.#node || this.#context?.state !== "running") throw new Error("音声処理の準備を待ってから実行してください。");
    if (this.#delivery.pendingAcceptance >= 256) { this.stop(); throw new Error("音声命令が過多です。停止して再起動してください。"); }
    this.#node.port.postMessage(this.#delivery.submit(command));
    this.delivery(this.#delivery.state);
  }
  volume(percent: number): void {
    if (this.#gain && this.#context) this.#gain.gain.setTargetAtTime(Math.max(0, Math.min(100, percent)) / 100, this.#context.currentTime, 0.015);
  }
  stop(): void {
    this.#delivery.reset();
    this.#node?.port.postMessage(this.#delivery.submit({ version: 1, action: "stop" }));
    this.delivery(this.#delivery.state);
    // Host controls the output even if the source Worker or worklet fails.
    if (this.#gain && this.#context) this.#gain.gain.setValueAtTime(0, this.#context.currentTime);
  }
  async close(): Promise<void> {
    this.#generation++;
    this.#abort?.abort(); this.#abort = null;
    this.#cancelInitialization?.(); this.#cancelInitialization = null;
    this.#preparing = null;
    this.stop();
    this.#ready = false;
    this.#node?.disconnect();
    this.#node = null; this.#gain = null; this.#analyser = null;
    const context = this.#context; this.#context = null;
    if (context && context.state !== "closed") await context.close();
  }
}
