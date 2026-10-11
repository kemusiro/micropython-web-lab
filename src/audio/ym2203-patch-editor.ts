import "./ym2203-patch-editor.css";
import { defaultYmPatch, FM_ALGORITHMS, OP_FIELDS, patchPreviewPython, patchHeldPython, patchPython, validateYmPatch, type YmPatch } from "./ym2203-patch";
import { YmContinuousAudition } from "./ym2203-continuous";
import type { SupportedLocale } from "../i18n/i18n";
import type { YmPanelState } from "./ym2203-panel";
import type { AudioMeter } from "./ym2203-audio";

interface PatchHooks {
  toggleMute(): Promise<void>; preview(source: string): void; export(source: string): void;
  restart(): void;
  stop(): void; readWave(output: Float32Array<ArrayBuffer>): void;
}
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
  const node = document.createElement(tag); node.textContent = text; return node;
};
export class YmPatchEditor {
  readonly #dialog = element("dialog");
  readonly #inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  readonly #fm = element("section");
  readonly #ssg = element("section");
  readonly #graph = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  readonly #scope = element("canvas");
  readonly #wave = new Float32Array(512);
  readonly #code = element("textarea");
  readonly #status = element("p");
  readonly #playing = element("span", "STANDBY");
  readonly #preview = element("button");
  readonly #export = element("button");
  readonly #restart = element("button");
  readonly #mute = element("button");
  readonly #speaker = element("p");
  readonly #mode = element("select");
  readonly #live: YmContinuousAudition;
  #patch = defaultYmPatch();
  #valid = true;
  #available = false;
  #availabilityReason = "";
  #notice = "";
  #audition: "idle" | "waiting" | "playing" = "idle";
  #frame: number | null = null;
  constructor(readonly locale: SupportedLocale, readonly hooks: PatchHooks) {
    this.#live = new YmContinuousAudition({
      write: (patch, renew) => {
        this.hooks.preview(patchHeldPython(patch, renew));
        this.#audition = "idle";
        this.message(this.text("連続試聴中。設定の変更に追従します。停止するまで継続します。", "Continuous audition. Settings apply automatically until stopped."));
        this.liveState();
      },
      stop: () => this.hooks.stop(),
      error: error => { this.message(String(error)); this.liveState(); },
    });
    const dialog = this.#dialog;
    dialog.className = "ym-patch-dialog";
    dialog.dataset.ymPatchEditor = "true";
    dialog.setAttribute("aria-labelledby", "ym-patch-title");
    const header = element("header");
    const heading = element("div");
    heading.append(element("small", "YM2203 / PATCH LAB"));
    const title = element("h2", this.text("音色をデザイン", "Design a sound")); title.id = "ym-patch-title";
    heading.append(title);
    const close = this.button(this.text("閉じる", "Close"), () => this.close()); close.dataset.ymPatchClose = "true";
    header.append(heading, close);
    const content = element("div"); content.className = "ym-patch-content";
    const intro = element("p", this.text("接続を変え、音を聴き比べる。設定はPythonへ。", "Change the connections, compare sounds, and take your settings to Python."));
    const common = element("div"); common.className = "ym-patch-common";
    common.append(this.select("source", this.text("音源", "Source"), [["fm", "FM"], ["ssg", "SSG"]]),
      this.number("channel", this.text("チャンネル", "Channel"), 0, 2),
      this.number("note", this.text("MIDI音符", "MIDI note"), 0, 127),
      this.number("volume", this.text("内蔵アンプ %", "Module amp %"), 0, 100));
    const visual = element("div"); visual.className = "ym-patch-visual";
    this.#graph.setAttribute("viewBox", "0 0 440 215"); this.#graph.setAttribute("role", "img");
    const monitor = element("div"); monitor.className = "ym-patch-monitor";
    monitor.append(element("small", "OUTPUT"), this.#playing);
    this.#scope.width = 512; this.#scope.height = 100; this.#scope.dataset.ymPatchScope = "true";
    this.#scope.setAttribute("role", "img"); this.#scope.setAttribute("aria-label", this.text("試聴音声の波形", "Audition waveform"));
    monitor.append(this.#scope, element("p", this.text("短い試聴は1.5秒。連続試聴は停止するまで継続し、変更時に再発音します。エンベロープの減衰はそのままです。", "Short auditions last 1.5 seconds. Continuous audition holds the key, restarting on edits; envelope decay still applies.")));
    visual.append(this.#graph, monitor);
    const fmControls = element("div"); fmControls.className = "ym-patch-common";
    fmControls.append(this.select("algorithm", this.text("アルゴリズム", "Algorithm"), Array.from({ length: 8 }, (_, i) => [String(i), String(i)])),
      this.number("feedback", this.text("フィードバック", "Feedback"), 0, 7));
    const operators = element("div"); operators.className = "ym-patch-operators";
    for (let i = 0; i < 4; i++) {
      const fieldset = element("fieldset"); fieldset.dataset.operator = String(i + 1);
      const legend = element("legend", `OP${i + 1}`); fieldset.append(legend);
      for (const field of OP_FIELDS) {
        const label = this.number(`op${i}.${field.key}`, field.label, 0, field.max);
        const input = label.querySelector("input")!;
        input.setAttribute("aria-label", `OP${i + 1} ${field.label}`);
        label.title = this.text(field.ja, field.en); fieldset.append(label);
      }
      operators.append(fieldset);
    }
    this.#fm.append(fmControls, element("p", this.text("緑のOPは音の出力、矢印は変調。TLは小さいほど大きな音。各値はチップのレジスタ単位です。", "Green operators feed the output; arrows show modulation. Lower TL is louder. Values use chip register units.")), operators);
    const ssgOptions = element("div"); ssgOptions.className = "ym-patch-common";
    ssgOptions.append(this.checkbox("tone", this.text("トーン", "Tone")), this.checkbox("noise", this.text("ノイズ", "Noise")), this.checkbox("envelope", this.text("エンベロープ", "Envelope")));
    const ssgControls = element("div"); ssgControls.className = "ym-patch-common";
    ssgControls.append(this.number("ssgVolume", this.text("固定音量", "Fixed volume"), 0, 15),
      this.number("noisePeriod", this.text("ノイズ周期", "Noise period"), 1, 31),
      this.number("envelopePeriod", this.text("エンベロープ周期", "Envelope period"), 1, 65535),
      this.select("shape", this.text("形状", "Shape"), Array.from({ length: 16 }, (_, i) => [String(i), `${i}${i === 10 ? this.text(" · 下降・上昇", " · down/up") : i === 12 ? this.text(" · 上昇の繰り返し", " · rising saw") : ""}`])));
    this.#ssg.append(element("h3", "SSG"), ssgOptions, ssgControls, element("p", this.text("ノイズとエンベロープは3chで共有。エンベロープを選ぶと固定音量は使いません。", "Noise and envelope generators are shared by all three channels. Envelope mode replaces fixed volume.")));
    const details = element("details"); details.append(element("summary", this.text("Pythonコードを見る", "View Python code")));
    this.#code.readOnly = true; this.#code.spellcheck = false;
    this.#code.setAttribute("aria-label", this.text("生成したPythonコード", "Generated Python code")); details.append(this.#code);
    const modeLabel = element("label", this.text("試聴モード", "Audition mode"));
    modeLabel.className = "ym-patch-mode";
    this.#mode.dataset.ymPatchMode = "true";
    for (const [value, label] of [["short", this.text("短い試聴（1.5秒）", "Short (1.5 seconds)")], ["continuous", this.text("連続試聴（設定を自動反映）", "Continuous (apply edits automatically)")]]) {
      const option = element("option", label); option.value = value!; this.#mode.append(option);
    }
    modeLabel.append(this.#mode); common.append(modeLabel);
    this.#mode.addEventListener("change", () => { this.stopAudition(); this.message(this.text("「試聴する」で選択したモードを開始します。", "Press Audition to start the selected mode.")); });
    content.append(intro, common, visual, this.#fm, this.#ssg, details);
    const footer = element("footer");
    const buttons = element("div"); buttons.className = "ym-patch-buttons";
    this.#mute.type = "button"; this.#mute.textContent = this.text("ミュート", "Mute");
    this.#mute.dataset.ymPatchMute = "true";
    this.#mute.addEventListener("click", () => { void this.hooks.toggleMute().catch(error => this.message(String(error))); });
    this.#speaker.dataset.ymPatchSpeaker = "true";
    this.#preview.textContent = this.text("試聴する", "Audition"); this.#preview.type = "button"; this.#preview.dataset.ymPatchPreview = "true";
    this.#preview.addEventListener("click", () => this.action(() => {
      if (this.#mode.value === "continuous") { this.#live.start(this.#patch); this.liveState(); }
      else {
        this.hooks.preview(patchPreviewPython(this.#patch)); this.#audition = "waiting";
        this.message(this.text("試聴中。変更後はもう一度「試聴する」を押してください。", "Auditioning. Press Audition again after changing settings."));
      }
    }));
    const stop = this.button(this.text("試聴を停止", "Stop audition"), () => { this.stopAudition(); this.message(this.text("試聴を停止しました。", "Audition stopped.")); }); stop.dataset.ymPatchStop = "true";
    this.#export.type = "button"; this.#export.textContent = this.text("Pythonタブに追加", "Add Python tab"); this.#export.dataset.ymPatchExport = "true";
    this.#export.addEventListener("click", () => this.action(() => { this.hooks.export(patchPython(this.#patch)); this.close(); }));
    this.#restart.type = "button"; this.#restart.textContent = this.text("実行環境を再起動", "Restart runtime");
    this.#restart.dataset.ymPatchRestart = "true"; this.#restart.hidden = true;
    this.#restart.addEventListener("click", () => { try { this.hooks.restart(); } catch (error) { this.message(String(error)); } });
    buttons.append(this.#mute, this.#preview, stop, this.#export,
      this.button(this.text("初期値に戻す", "Reset settings"), () => { if (!this.#live.active) this.hooks.stop(); this.#patch = defaultYmPatch(); this.fill(); this.update(); }), this.#restart);
    this.#status.setAttribute("role", "status"); this.#status.dataset.ymPatchStatus = "true";
    footer.append(buttons, this.#speaker, this.#status, element("small", this.text("試聴は現在の演奏を置き換えます。連続試聴でもミュートと音量設定は維持します。", "Audition replaces current playback. Continuous audition preserves speaker mute and volume.")));
    dialog.append(header, content, footer); document.body.append(dialog);
    dialog.addEventListener("input", event => { if (event.target === this.#mode) return; if (!this.#live.active) this.hooks.stop(); this.update(); });
    dialog.addEventListener("cancel", event => { event.preventDefault(); this.close(); });
    dialog.addEventListener("close", () => { this.stopAudition(); if (this.#frame !== null) cancelAnimationFrame(this.#frame); this.#frame = null; });
    this.fill(); this.update();
  }
  private text(ja: string, en: string): string { return this.locale === "ja" ? ja : en; }
  private button(text: string, action: () => void): HTMLButtonElement {
    const button = element("button", text); button.type = "button"; button.addEventListener("click", action); return button;
  }
  private number(key: string, text: string, min: number, max: number): HTMLLabelElement {
    const label = element("label", text), input = element("input"); input.type = "number"; input.min = String(min); input.max = String(max); input.step = "1";
    input.dataset.patchField = key; this.#inputs.set(key, input); label.append(input); return label;
  }
  private select(key: string, text: string, choices: string[][]): HTMLLabelElement {
    const label = element("label", text), select = element("select"); select.dataset.patchField = key;
    for (const [value, name] of choices) { const option = element("option", name); option.value = value!; select.append(option); }
    this.#inputs.set(key, select); label.append(select); return label;
  }
  private checkbox(key: string, text: string): HTMLLabelElement {
    const label = element("label", text), input = element("input"); input.type = "checkbox"; input.dataset.patchField = key;
    this.#inputs.set(key, input); label.prepend(input); return label;
  }
  private fill(): void {
    for (const [key, input] of this.#inputs) {
      const [op, field] = key.split(".");
      const value = field ? this.#patch.operators[Number(op!.slice(2))]![field as keyof YmPatch["operators"][number]] : this.#patch[key as keyof YmPatch];
      if (input instanceof HTMLInputElement && input.type === "checkbox") input.checked = Boolean(value);
      else input.value = String(value);
    }
  }
  private update(): void {
    this.#audition = "idle";
    const candidate = { ...this.#patch, operators: this.#patch.operators.map(op => ({ ...op })) };
    candidate.source = this.#inputs.get("source")!.value as YmPatch["source"];
    this.#fm.hidden = candidate.source !== "fm"; this.#ssg.hidden = candidate.source !== "ssg"; this.#graph.toggleAttribute("hidden", candidate.source !== "fm");
    this.#graph.parentElement?.classList.toggle("ym-patch-ssg", candidate.source === "ssg");
    for (const [key, input] of this.#inputs) {
      if (key === "source") continue;
      const [op, field] = key.split(".");
      if (field) {
        if (candidate.source === "fm") candidate.operators[Number(op!.slice(2))]![field as keyof YmPatch["operators"][number]] = Number(input.value === "" ? NaN : input.value);
      } else if (["channel", "note", "volume"].includes(key) || (candidate.source === "fm" ? ["algorithm", "feedback"].includes(key) : ["tone", "noise", "envelope", "ssgVolume", "noisePeriod", "envelopePeriod", "shape"].includes(key))) {
        const value = input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : Number(input.value === "" ? NaN : input.value);
        Object.assign(candidate, { [key]: value });
      }
    }
    const note = this.#inputs.get("note") as HTMLInputElement;
    note.min = String(candidate.source === "ssg" && candidate.tone ? 23 : 0);
    note.max = String(candidate.source === "fm" ? 116 : 127);
    try {
      validateYmPatch(candidate); this.#patch = candidate; this.#valid = true;
      this.#code.value = patchPython(candidate); this.graph();
      if (this.#live.active) {
        this.#live.update(candidate);
        this.message(this.text("連続試聴中。変更した設定を反映します。", "Continuous audition. Applying edited settings."));
      } else this.message(this.text("設定を変えて、音を聴き比べてください。", "Change settings and compare the sound."));
    } catch (error) { this.#valid = false; this.#code.value = ""; this.#live.pause(); this.message(String(error)); }
    this.controls();
  }
  private controls(): void { this.#preview.disabled = this.#export.disabled = !this.#valid || !this.#available; }
  private message(text: string): void {
    this.#notice = text;
    this.#status.textContent = [text, this.#available ? "" : this.#availabilityReason].filter(Boolean).join(" ");
  }
  private action(callback: () => void): void { try { if (this.#valid && this.#available) callback(); } catch (error) { this.message(String(error)); } }
  setAvailable(available: boolean, reason = "", restartable = false, ownPreviewBusy = false): void {
    this.#available = available; this.#availabilityReason = reason;
    this.#restart.hidden = !restartable;
    this.#live.setReady(available);
    if (!available && !ownPreviewBusy && this.#live.active) {
      this.#live.stop(); this.liveState();
      this.message(this.text("連続試聴を停止しました。", "Continuous audition stopped."));
    }
    this.controls(); this.message(this.#notice);
  }
  private liveState(): void { this.#dialog.dataset.continuous = String(this.#live.active); }
  private stopAudition(): void {
    this.#audition = "idle";
    if (this.#live.active) this.#live.stop(); else this.hooks.stop();
    this.liveState();
  }
  setAudioState(state: YmPanelState): void {
    if ((!state.ready || !state.connected) && this.#live.active) this.stopAudition();
    this.#mute.setAttribute("aria-pressed", String(state.muted));
    this.#mute.disabled = !state.connected;
    this.#mute.title = state.muted ? this.text("ミュートを解除", "Unmute") : this.text("ミュートにする", "Mute speaker");
    this.#speaker.textContent = (state.muted ? this.text("スピーカー: ミュート中", "Speaker: muted") : this.text("スピーカー: ミュート解除", "Speaker: unmuted")) +
      (state.ready ? this.text(" · オーディオ有効", " · Audio ready") : this.text(" · 音声処理の準備・開始を待っています", " · Waiting for audio preparation or activation"));
  }
  open(): void { if (this.#dialog.open) return; this.#dialog.showModal(); this.draw(); }
  close(): void { if (this.#dialog.open) this.#dialog.close(); }
  meter(meter: AudioMeter): void {
    this.#playing.textContent = meter.active ? "PLAYING" : "STANDBY";
    if (this.#live.active) return;
    if (meter.active && this.#audition === "waiting") this.#audition = "playing";
    else if (!meter.active && this.#audition === "playing") {
      this.#audition = "idle";
      this.message(this.text("試聴が終わりました。設定を変えて聴き比べられます。", "Audition finished. Change settings to compare sounds."));
    }
  }
  private graph(): void {
    const algorithm = FM_ALGORITHMS[this.#patch.algorithm]!;
    const ns = "http://www.w3.org/2000/svg";
    const svg = this.#graph; svg.replaceChildren();
    svg.setAttribute("aria-label", `FM algorithm ${this.#patch.algorithm}, feedback ${this.#patch.feedback}, output ${algorithm.carriers.map(index => `OP${index + 1}`).join(", ")}`);
    const node = (tag: string, attributes: Record<string, string>, text = "") => {
      const n = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attributes)) n.setAttribute(key, value); n.textContent = text; return n;
    };
    const defs = node("defs", {}), marker = node("marker", { id: "ym-patch-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse" });
    marker.append(node("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#85d2a4" })); defs.append(marker); svg.append(defs);
    const line = (x1: number, y1: number, x2: number, y2: number) => svg.append(node("line", { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2), stroke: "#85d2a4", "stroke-width": "2", "marker-end": "url(#ym-patch-arrow)" }));
    for (const [from, to] of algorithm.edges) { const a = algorithm.positions[from]!, b = algorithm.positions[to]!; line(a[0] + 30, a[1], b[0] - 32, b[1]); }
    for (const index of algorithm.carriers) { const [x, y] = algorithm.positions[index]!; line(x + 30, y, 405, 100); }
    if (this.#patch.feedback) {
      const [x, y] = algorithm.positions[0];
      svg.append(node("path", { d: `M ${x - 15} ${y - 16} C ${x - 40} ${y - 48}, ${x + 40} ${y - 48}, ${x + 15} ${y - 16}`, stroke: "#e5ba7a", fill: "none", "stroke-width": "2", "marker-end": "url(#ym-patch-arrow)" }));
    }
    for (const [i, [x, y]] of algorithm.positions.entries()) {
      const carrier = (algorithm.carriers as readonly number[]).includes(i);
      svg.append(node("rect", { x: String(x - 28), y: String(y - 16), width: "56", height: "32", rx: "8", fill: carrier ? "#245d42" : "#18352d", stroke: carrier ? "#8bf2bf" : "#456b59" }),
        node("text", { x: String(x), y: String(y + 5), "text-anchor": "middle", fill: "#e2f6e9", "font-size": "13" }, `OP${i + 1}`));
    }
    svg.append(node("text", { x: "410", y: "105", fill: "#8bf2bf", "font-size": "11" }, "OUT"));
  }
  private draw(): void {
    if (!this.#dialog.open) return;
    this.hooks.readWave(this.#wave);
    const context = this.#scope.getContext("2d");
    if (context) {
      context.fillStyle = "#071c18"; context.fillRect(0, 0, 512, 100);
      context.strokeStyle = "#1e493e"; context.beginPath(); context.moveTo(0, 50); context.lineTo(512, 50); context.stroke();
      const scale = 40 / Math.max(0.01, ...this.#wave.map(value => Math.abs(value)));
      context.strokeStyle = "#8bf2bf"; context.lineWidth = 1.5; context.beginPath();
      for (let i = 0; i < 512; i++) { const y = 50 - this.#wave[i]! * scale; if (i === 0) context.moveTo(i, y); else context.lineTo(i, y); }
      context.stroke();
    }
    this.#frame = requestAnimationFrame(() => this.draw());
  }
}
