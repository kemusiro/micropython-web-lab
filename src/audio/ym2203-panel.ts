import "./ym2203-panel.css";
import { YmAudio, type AudioMeter } from "./ym2203-audio";
import type { YmCommand } from "./ym2203-protocol";
import type { SupportedLocale } from "../i18n/i18n";
import { YM_INSTANCE } from "./ym2203-protocol";
import type { YmDeliveryState } from "./ym2203-delivery";

export interface YmPanelState {
  connected: boolean; ready: boolean; loading: boolean; muted: boolean; volume: number;
}
/** Host-owned controls. Neither the Device SDK nor Python receives this audio graph. */
export class YmAudioPanel {
  readonly #audio: YmAudio;
  readonly #wave = new Float32Array(512);
  #root: HTMLElement | null = null;
  #scope: HTMLCanvasElement | null = null;
  #frame: number | null = null;
  #acceptMeters = false;
  #volume = 60;
  #muted = true;
  #moduleGain = 50;
  #loading = false;
  #message: string;
  #revision = 0;
  #preparing: Promise<void> | null = null;
  onState: ((state: YmPanelState) => void) | null = null;
  readonly #gesture = () => {
    if (this.connected && !this.#audio.ready && (this.#loading || this.#audio.prepared)) {
      void this.#audio.resume().catch(error => { this.#message = String(error); this.status(); });
    }
  };
  #deliveryState: YmDeliveryState = { epoch: 0, sent: 0, accepted: 0, rendered: 0 };
  onMeter: ((meter: AudioMeter) => void) | null = null;
  constructor(readonly locale: SupportedLocale, readonly openScore?: () => void, readonly openTone?: () => void, readonly openEditor?: () => void, readonly openSong?: () => void, readonly openMml?: () => void, readonly openBin?: () => void) {
    this.#message = this.text("結線に合わせて音源を準備します。", "The connection controls the audio engine.");
    this.#audio = new YmAudio(meter => this.meter(meter), message => {
      if (!this.#audio.ready) this.stop();
      this.#message = this.locale === "en"
        ? message.startsWith("音声有効") ? "Audio ready" : message.startsWith("音声処理は") ? "Waiting for a click. Toggle Mute to start audio processing." : message
        : message;
      this.status();
    }, state => { this.#deliveryState = state; this.delivery(); });
  }
  get connected(): boolean { return this.#root !== null; }
  get state(): YmPanelState { return { connected: this.connected, ready: this.#audio.ready, loading: this.#loading, muted: this.#muted, volume: this.#volume }; }
  get audioReady(): boolean { return this.#audio.ready; }
  readWave(output: Float32Array<ArrayBuffer>): void { if (this.#audio.ready && this.#audio.analyser) this.#audio.analyser.getFloatTimeDomainData(output); else output.fill(0); }
  mount(card: HTMLElement | null): void {
    const wasConnected = this.connected;
    this.#revision++; this.#preparing = null; this.#loading = false;
    this.stop();
    document.removeEventListener("pointerdown", this.#gesture, true);
    document.removeEventListener("keydown", this.#gesture, true);
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#scope = null;
    this.#root = null;
    if (card === null) {
      this.#muted = true;
      void this.#audio.close(); this.status(); return;
    }
    if (!wasConnected) this.#muted = true;
    card.classList.add("ym-sound-card");
    const root = document.createElement("section");
    root.className = "ym-audio-panel";
    root.setAttribute("aria-label", this.text("音源の再生操作", "Sound playback controls"));
    const scope = document.createElement("canvas");
    scope.width = 512; scope.height = 80;
    scope.setAttribute("role", "img");
    scope.setAttribute("aria-label", this.text("出力音声の波形", "Output audio waveform"));
    scope.dataset.ymScope = "true";
    this.#scope = scope;
    const meters = document.createElement("div");
    meters.className = "ym-audio-meters";
    for (const voice of ["FM", "SSG"]) {
      const label = document.createElement("label");
      label.append(voice);
      const meter = document.createElement("meter");
      meter.min = 0; meter.max = 0.5; meter.value = 0;
      meter.dataset.voice = voice; label.append(meter); meters.append(label);
    }
    const playing = document.createElement("span");
    playing.dataset.ymPlaying = "true"; playing.textContent = "STANDBY";
    meters.append(playing);
    const actions = document.createElement("div"); actions.className = "ym-audio-actions";
    const mute = document.createElement("button"); mute.type = "button";
    mute.dataset.ymMute = "true";
    mute.textContent = this.text("ミュート", "Mute");
    mute.addEventListener("click", () => { void this.toggleMute(); });
    actions.append(mute);
    const samples = document.createElement("div"); samples.className = "ym-audio-actions";
    for (const [kind, ja, en, callback] of [
      ["mml", "簡易MML", "Simple MML", this.openMml],
      ["bin", "BINプレイヤー", "BIN player", this.openBin],
    ] as const) {
      if (!callback) continue;
      const button = document.createElement("button"); button.type = "button";
      button.dataset[kind === "mml" ? "ymMmlExample" : "ymBinExample"] = "true";
      button.dataset.deviceExample = YM_INSTANCE; button.textContent = this.text(ja, en);
      button.addEventListener("click", callback); samples.append(button);
    }
    const more = document.createElement("section");
    const summary = document.createElement("p"); summary.textContent = this.text("追加サンプル", "More samples"); more.append(summary);
    const extra = document.createElement("div"); extra.className = "ym-audio-actions"; more.append(extra);
    if (this.openScore) {
      const score = document.createElement("button"); score.type = "button";
      score.dataset.ymScoreExample = "true";
      score.dataset.deviceExample = YM_INSTANCE;
      score.textContent = this.text("合奏サンプル", "Ensemble sample");
      score.setAttribute("aria-label", this.text("FM＋SSG合奏サンプルを新しいエディタタブで開く", "Open the FM + SSG ensemble sample in a new editor tab"));
      score.addEventListener("click", () => this.openScore?.());
      extra.append(score);
    }
    if (this.openTone) {
      const tone = document.createElement("button"); tone.type = "button";
      tone.dataset.ymToneExample = "true";
      tone.dataset.deviceExample = YM_INSTANCE;
      tone.textContent = this.text("音色設定サンプル", "Patch sample");
      tone.setAttribute("aria-label", this.text("FM音色・SSGノイズとエンベロープのサンプルを新しいエディタタブで開く", "Open the FM patch and SSG noise/envelope sample in a new editor tab"));
      tone.addEventListener("click", () => this.openTone?.());
      extra.append(tone);
    }
    if (this.openSong) {
      const song = document.createElement("button"); song.type = "button";
      song.textContent = this.text("Pocket Signal", "Pocket Signal");
      song.dataset.ymSongExample = "true"; song.dataset.deviceExample = YM_INSTANCE;
      song.setAttribute("aria-label", this.text("Pocket Signalの全曲を新しいエディタタブで開く", "Open the complete Pocket Signal in a new editor tab"));
      song.addEventListener("click", () => this.openSong?.()); extra.append(song);
    }
    if (this.openEditor) {
      const editor = document.createElement("button"); editor.type = "button";
      editor.textContent = this.text("音色エディター", "Patch editor");
      editor.dataset.ymPatchOpen = "true"; editor.dataset.deviceExample = YM_INSTANCE;
      editor.addEventListener("click", () => this.openEditor?.()); actions.append(editor);
    }
    const volumeLabel = document.createElement("label"); volumeLabel.className = "ym-audio-volume";
    volumeLabel.append(this.text("スピーカー音量", "Speaker volume"));
    const volume = document.createElement("input"); volume.type = "range";
    volume.min = "0"; volume.max = "100"; volume.value = String(this.#volume);
    volume.addEventListener("input", () => { this.#volume = Number(volume.value); this.#audio.volume(this.#muted ? 0 : this.#volume); this.status(); });
    volumeLabel.append(volume);
    const speaker = document.createElement("p"); speaker.dataset.ymSpeaker = "true";
    const status = document.createElement("p"); status.dataset.ymStatus = "true"; status.setAttribute("aria-live", "polite");
    const playback = document.createElement("p"); playback.dataset.ymPlayback = "true";
    const delivery = document.createElement("p"); delivery.dataset.ymDelivery = "true";
    const guide = document.createElement("a"); guide.href = "https://asamomiji.jp/articles/micropython-web-lab-guide/#ym2203";
    guide.target = "_blank"; guide.rel = "noopener";
    guide.textContent = this.text("使い方ガイド", "Usage guide"); samples.append(guide);
    root.append(scope, meters, playback, delivery, actions, samples, more, volumeLabel, speaker, status);
    // Keep the host audio controls within the card's collapsible body.
    const components = card.querySelector(".device-ui-components");
    if (components === null) throw new Error("Sound card components were not found");
    components.prepend(root);
    this.#root = root; this.status(); this.clearMeters(); this.delivery(); this.draw();
    document.addEventListener("pointerdown", this.#gesture, true);
    document.addEventListener("keydown", this.#gesture, true);
    void this.prepare();
  }
  private prepare(): Promise<void> {
    if (!this.connected || this.#audio.prepared) return Promise.resolve();
    if (this.#preparing) return this.#preparing;
    const revision = this.#revision;
    this.#loading = true;
    this.#message = this.text("音源を準備中", "Preparing engine");
    this.status();
    const task = this.#audio.prepare().then(() => {
      if (revision !== this.#revision || !this.connected) return;
      if (this.#audio.ready) this.#audio.send({ version: 1, action: "gain", percent: this.#moduleGain });
    }).catch(error => {
      if (revision === this.#revision) this.#message = String(error);
    }).finally(() => {
      if (revision !== this.#revision) return;
      this.#preparing = null; this.#loading = false; this.status();
    });
    this.#preparing = task;
    return task;
  }
  async toggleMute(): Promise<void> {
    if (!this.connected) return;
    this.#muted = !this.#muted;
    this.#audio.volume(this.#muted ? 0 : this.#volume); this.status();
    if (this.#muted) return;
    const revision = this.#revision;
    const preparing = this.prepare();
    const resuming = this.#audio.resume(); // Start/resume from the toggle's click.
    try {
      await preparing; await resuming;
      if (revision !== this.#revision || !this.connected) return;
      if (!this.#audio.ready) throw new Error(this.text("音声処理を開始できませんでした。", "Could not start audio processing."));
      this.#audio.volume(this.#muted ? 0 : this.#volume);
    } catch (error) { if (revision === this.#revision) this.#message = String(error); }
    finally { if (revision === this.#revision) this.status(); }
  }
  command(command: YmCommand): void {
    if (!this.connected) return;
    if (command.action === "stop") { this.stop(); return; }
    if (command.action === "gain") {
      this.#moduleGain = command.percent;
      if (this.#audio.ready) this.#audio.send(command);
      return;
    }
    if (!this.#audio.ready) throw new Error(this.text("音声処理の準備を待ってから実行してください。", "Wait for the audio engine before running the sound sample."));
    this.#audio.volume(this.#muted ? 0 : this.#volume);
    this.#acceptMeters = true;
    this.#audio.send(command);
  }
  stop(): void {
    this.#acceptMeters = false;
    this.#audio.stop(); this.clearMeters();
  }
  async close(): Promise<void> {
    this.#revision++; this.#preparing = null; this.#loading = false; this.#muted = true;
    this.stop(); await this.#audio.close();
  }
  private text(ja: string, en: string): string { return this.locale === "ja" ? ja : en; }
  private status(): void {
    const root = this.#root;
    if (root) {
      const state = this.state;
      root.dataset.audioState = state.ready ? "ready" : state.loading ? "preparing" : this.#audio.prepared ? "waiting" : "error";
      root.dataset.muted = String(state.muted);
      root.querySelector<HTMLElement>("[data-ym-status]")!.textContent = this.text("オーディオ: 有効 · ", "Audio: enabled · ") + this.#message;
      root.querySelector<HTMLElement>("[data-ym-speaker]")!.textContent = this.#muted
        ? this.text("スピーカー: ミュート中", "Speaker: muted") : this.text("スピーカー: ミュート解除", "Speaker: unmuted");
      const mute = root.querySelector<HTMLButtonElement>("[data-ym-mute]")!;
      mute.setAttribute("aria-pressed", String(this.#muted));
      mute.title = this.#muted ? this.text("ミュートを解除", "Unmute") : this.text("ミュートにする", "Mute speaker");
    }
    this.onState?.(this.state);
  }
  private clearMeters(): void {
    this.onMeter?.({ version: 1, type: "meter", epoch: this.#deliveryState.epoch, sequence: 0,
      state: "stopped", mode: "idle", elapsedMs: 0, durationMs: 0, total: 0,
      active: false, frame: 0, pending: 0, applied: 0, fmRms: 0, ssgRms: 0, rms: 0, peak: 0 });
    for (const meter of this.#root?.querySelectorAll<HTMLMeterElement>("meter") ?? []) meter.value = 0;
    if (this.#root) {
      this.#root.querySelector<HTMLElement>("[data-ym-playing]")!.textContent = "STANDBY";
      this.#root.querySelector<HTMLElement>("[data-ym-playback]")!.textContent = this.text("停止済み · 予約なし", "Stopped · no reservation");
    }
    if (this.#scope) Object.assign(this.#scope.dataset, { active: "false", fmRms: "0", ssgRms: "0", pending: "0", applied: "0", playbackState: "stopped", mode: "idle", elapsedMs: "0", durationMs: "0", total: "0" });
  }
  private delivery(): void {
    if (!this.#root) return;
    const state = this.#deliveryState;
    const waiting = state.sent > state.rendered;
    this.#root.querySelector<HTMLElement>("[data-ym-delivery]")!.textContent = this.text(
      `${waiting ? "命令を配送中" : "音源へ反映済み"} · 送信 ${state.sent} / 音源受付 ${state.accepted} / 音声処理 ${state.rendered}`,
      `${waiting ? "Delivering commands" : "Commands applied"} · sent ${state.sent} / accepted ${state.accepted} / rendered ${state.rendered}`);
    if (this.#scope) Object.assign(this.#scope.dataset, { epoch: String(state.epoch), sent: String(state.sent), accepted: String(state.accepted), rendered: String(state.rendered) });
  }
  private meter(meter: AudioMeter): void {
    if (!this.#root || !this.#scope || !this.#acceptMeters) return;
    this.onMeter?.(meter);
    this.#root.querySelector<HTMLMeterElement>('[data-voice="FM"]')!.value = meter.fmRms;
    this.#root.querySelector<HTMLMeterElement>('[data-voice="SSG"]')!.value = meter.ssgRms;
    this.#root.querySelector<HTMLElement>("[data-ym-playing]")!.textContent = meter.active ? "PLAYING" : "STANDBY";
    const label = meter.state === "completed" ? this.text("演奏完了", "Completed") : meter.state === "playing"
      ? (meter.mode === "scheduled" ? this.text("予約演奏中", "Scheduled playback") : this.text("即時制御中", "Immediate playback"))
      : this.text("停止済み", "Stopped");
    const time = (ms: number): string => {
      const seconds = Math.floor(ms / 1000);
      return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    };
    const timing = meter.durationMs >= 60_000 ? `${time(meter.elapsedMs)} / ${time(meter.durationMs)}` : `${Math.round(meter.elapsedMs)} / ${meter.durationMs} ms`;
    this.#root.querySelector<HTMLElement>("[data-ym-playback]")!.textContent = `${label} · ${timing}` +
      (meter.mode === "scheduled" ? this.text(` · イベント ${meter.applied} / ${meter.total}（残り ${meter.pending}）`, ` · events ${meter.applied} / ${meter.total} (${meter.pending} remaining)`) : "");
    Object.assign(this.#scope.dataset, { active: String(meter.active), fmRms: String(meter.fmRms), ssgRms: String(meter.ssgRms), applied: String(meter.applied), pending: String(meter.pending),
      playbackState: meter.state, mode: meter.mode, elapsedMs: String(meter.elapsedMs), durationMs: String(meter.durationMs), total: String(meter.total) });
  }
  private draw(): void {
    const scope = this.#scope;
    if (!scope) return;
    this.readWave(this.#wave);
    scope.dataset.outputRms = String(Math.sqrt(this.#wave.reduce((sum, value) => sum + value * value, 0) / this.#wave.length));
    const context = scope.getContext("2d");
    if (context) {
      context.fillStyle = "#071c18"; context.fillRect(0, 0, 512, 80);
      context.strokeStyle = "#1e493e"; context.lineWidth = 1;
      context.beginPath(); context.moveTo(0, 40); context.lineTo(512, 40); context.stroke();
      const scale = 32 / Math.max(0.01, ...this.#wave.map(value => Math.abs(value)));
      context.strokeStyle = "#8bf2bf"; context.lineWidth = 1.5; context.beginPath();
      for (let i = 0; i < this.#wave.length; i++) {
        const y = 40 - this.#wave[i]! * scale;
        if (i === 0) context.moveTo(i, y); else context.lineTo(i, y);
      }
      context.stroke();
    }
    this.#frame = requestAnimationFrame(() => this.draw());
  }
}
