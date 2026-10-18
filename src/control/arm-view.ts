import "./arm-view.css";
import { DEFAULT_ARM_CONTROL, snapshotArmControlConditions, type ArmControlConditions } from "../physics/arm-control";
import { ArmRecording, armMetrics, armPlotPath, ARM_EXTRA_SERIES, DEFAULT_ARM_SERIES, snapshotArmSeries, type ArmExtraSeries, type ArmSample } from "./presentation";
import type { ArmTelemetry } from "./channel";
import type { ArmRunResult } from "./session";
import type { ProjectSnapshot } from "../project/filesystem";
import type { RuntimeStatus } from "../runtime/protocol";
import type { SupportedLocale } from "../i18n/i18n";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
const degrees = (value: number) => value * 180 / Math.PI;
const radians = (value: number) => value * Math.PI / 180;
const signature = (project: ProjectSnapshot) => JSON.stringify(project.entries.map(entry => entry.kind === "directory"
  ? { path: entry.path, kind: entry.kind } : { path: entry.path, kind: entry.kind, data: Array.from(entry.data) }));
const seriesNames = { speed: ["角速度", "Angular speed"], acceleration: ["角加速度", "Angular acceleration"], torque: ["要求・適用トルク", "Requested / applied torque"], gravity: ["重力トルク", "Gravity torque"] } as const;

/** Fixed, bounded presentation. There are no step calls or mutable model objects here. */
export class ArmExperimentView {
  #conditions: ArmControlConditions = { ...DEFAULT_ARM_CONTROL };
  #runConditions: ArmControlConditions | undefined;
  #series = [...DEFAULT_ARM_SERIES];
  #recording = new ArmRecording();
  #result: ArmRunResult | undefined;
  #source: string | undefined;
  #projectSignature = "";
  #contextSource = "";
  #contextProject = "";
  #follow = true;
  #selectedTick = 0;
  #lag = 0;
  #locked = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastDraw = 0;
  readonly #motion = matchMedia("(prefers-reduced-motion: reduce)");
  readonly #experience = element("section");
  readonly #configuration = element("section");
  readonly #explanation = element("section");
  readonly #status = element("p");
  readonly #availability = element("p");
  readonly #stale = element("p");
  readonly #time = element("p");
  readonly #pose = svg("svg", { viewBox: "0 0 320 210", role: "img" });
  readonly #values = element("p");
  readonly #metrics = element("p");
  readonly #charts = element("div");
  readonly #slider = element("input");
  readonly #latest: HTMLButtonElement;
  readonly #fields = element("fieldset");
  readonly #formError = element("p");
  readonly #metadata = element("pre");
  readonly #inputs = new Map<keyof ArmControlConditions, { input: HTMLInputElement; scale: number }>();
  readonly #seriesInputs = new Map<ArmExtraSeries, HTMLInputElement>();
  constructor(readonly root: HTMLElement, readonly locale: SupportedLocale,
    readonly changed: (conditions: ArmControlConditions, series: readonly ArmExtraSeries[]) => void) {
    root.className = "arm-workbench"; root.hidden = true;
    this.#status.id = "arm-run-status"; this.#status.setAttribute("role", "status");
    this.#availability.id = "arm-availability";
    this.#stale.id = "arm-stale-result";
    this.#time.id = "arm-time"; this.#values.id = "arm-values"; this.#metrics.id = "arm-metrics";
    this.#pose.id = "arm-pose"; this.#charts.id = "arm-charts";
    this.#slider.type = "range"; this.#slider.id = "arm-record-time"; this.#slider.min = "0"; this.#slider.max = "0"; this.#slider.step = "1";
    const timeLabel = element("label", this.text("記録の時刻を選ぶ（s）", "Select a recorded time (s)")); timeLabel.htmlFor = this.#slider.id;
    this.#slider.addEventListener("input", () => { this.selectTick(Number(this.#slider.value)); });
    this.#latest = this.button(this.text("最新の観測へ", "Follow latest"), () => { this.#follow = true; this.draw(); }); this.#latest.id = "arm-follow-latest";
    this.#experience.append(this.#pose, this.#time, this.#values, this.#charts, timeLabel, this.#slider, this.#latest, this.#metrics);
    const choices = element("fieldset"); choices.className = "arm-series"; choices.append(element("legend", this.text("角度と一緒に見る", "Plot with the angle")));
    for (const id of ARM_EXTRA_SERIES) {
      const label = element("label"); const input = element("input"); input.type = "checkbox"; input.dataset.armSeries = id;
      input.addEventListener("change", () => {
        this.#series = ARM_EXTRA_SERIES.filter(key => this.#seriesInputs.get(key)!.checked);
        this.changed(this.conditions, this.series); this.draw();
      });
      label.append(input, this.text(seriesNames[id][0], seriesNames[id][1])); choices.append(label); this.#seriesInputs.set(id, input);
    }
    this.#experience.append(choices);
    const legend = element("p", this.text("実線: 観測 · 破線: 目標／要求。グラフを押すか時刻スライダーで記録を確認できます。", "Solid: observed · dashed: target / requested. Select a plot time or use the time slider."));
    this.#experience.append(legend);
    this.makeConditions();
    this.#explanation.append(element("h3", this.text("コードと物理のつながり", "From code to motion")),
      element("p", this.text("read()で角度と角速度を読み、set_torque()で次の要求を指定、step()で10 ms進めます。Kpは位置偏差への応答、Kdは速度への減衰です。条件を変えてもコードは書き換えません。", "read() observes angle and speed; set_torque() sets the next command; step() advances 10 ms. Kp responds to position error, Kd damps speed. Changing conditions does not rewrite code.")),
      element("p", "J = ML²/3 + mL²\nJθ″ = clamp(τ, −1.20, +1.20) − g(ML/2 + mL)cosθ − bθ′"),
      element("p", this.text("0°は右向き水平、正方向は反時計回り。長さ0.20 m、アーム150 g、重力9.81 m/s²、粘性摩擦0.012 N·m·s/rad、可動域0〜150°。重りなしでも棒の慣性と重力は残ります。", "0° points right, positive is counterclockwise. Length 0.20 m, arm 150 g, gravity 9.81 m/s², viscous friction 0.012 N·m·s/rad, stops 0–150°. The rod has inertia and weight even without a load.")),
      element("p", this.text("理想的な関節トルクモデルです。モーターの電気特性、ギアや衝撃力、実機の安全性は再現しません。重力補償は既知の理想モデルを使います。有限時間の最後の偏差を、定常偏差とは断定しません。", "This ideal joint-torque model omits motor electronics, gears, impact forces and real-world safety. Gravity compensation assumes known ideal parameters. Final error over a finite run is not necessarily steady-state error.")),
      element("p", this.text("停止・非表示では計算も停止します。記録時刻の選択は閲覧だけで、Pythonの途中再開ではありません。系列はこのページ内だけに残り、セット切替・再読込で消えます。", "Stopping or hiding the page stops computation. Time selection only inspects records; it does not resume Python. Traces remain on this page and disappear on set switching or reload.")));
    const metadata = element("details"); metadata.append(element("summary", this.text("この実行の再現条件", "Reproduction metadata")), this.#metadata);
    root.append(this.#status, this.#availability, this.#stale, this.#experience, this.#configuration, this.#explanation, metadata);
    this.load(DEFAULT_ARM_CONTROL, DEFAULT_ARM_SERIES, true);
  }
  text(ja: string, en: string): string { return this.locale === "ja" ? ja : en; }
  get conditions(): ArmControlConditions { return { ...this.#conditions }; }
  get series(): ArmExtraSeries[] { return [...this.#series]; }
  clear(): void { this.load(DEFAULT_ARM_CONTROL, DEFAULT_ARM_SERIES, true); }
  validateConditions(): void {
    for (const { input } of this.#inputs.values()) {
      if (!input.validity.valid || input.getAttribute("aria-invalid") === "true") {
        input.focus();
        throw new Error(this.text("アーム条件の入力を修正してから実行してください。", "Correct the arm conditions before running."));
      }
    }
  }
  load(conditions: ArmControlConditions, series: readonly ArmExtraSeries[], reset: boolean): void {
    this.#conditions = snapshotArmControlConditions(conditions); this.#series = snapshotArmSeries(series);
    if (reset) {
      clearTimeout(this.#timer); this.#timer = undefined;
      this.#recording = new ArmRecording(); this.#result = undefined; this.#runConditions = undefined; this.#source = undefined;
      this.#projectSignature = ""; this.#contextSource = ""; this.#contextProject = "";
      this.#follow = true; this.#selectedTick = 0; this.#lag = 0; this.#status.textContent = this.text("未実行 · コードを実行すると開始します。", "Not run · press Run to begin.");
      this.#metadata.textContent = "";
      delete this.root.dataset.runId;
      this.root.dataset.result = "idle";
    }
    this.updateInputs(); this.draw();
  }
  section(section: "experience" | "configuration" | "explanation", visible: boolean): void {
    this.root.hidden = !visible;
    this.#experience.hidden = section !== "experience"; this.#configuration.hidden = section !== "configuration"; this.#explanation.hidden = section !== "explanation";
    if (visible) this.draw();
  }
  context(source: string, project: ProjectSnapshot): void {
    this.#contextSource = source; this.#contextProject = signature(project); this.updateStale();
  }
  begin(source: string, project: ProjectSnapshot): void {
    this.#recording = new ArmRecording(); this.#result = undefined; this.#runConditions = this.conditions;
    this.#source = source; this.#projectSignature = signature(project); this.#follow = true; this.#selectedTick = 0; this.#lag = 0;
    this.#metadata.textContent = ""; this.#status.textContent = this.text("実行環境を準備中…", "Preparing execution…");
    this.root.dataset.result = "running"; this.draw();
  }
  frame(frame: ArmTelemetry, lagMs: number): void {
    this.#recording.accept(frame); this.#lag = lagMs;
    this.queueDraw();
  }
  complete(result: ArmRunResult): void {
    this.#result = result; this.#runConditions = { ...result.metadata.conditions };
    if (result.telemetry) this.#recording.accept(result.telemetry);
    this.#projectSignature = signature(result.project); this.#contextProject = this.#projectSignature;
    this.#status.textContent = this.text(
      result.status === "completed" ? "実験完了" : result.status === "stopped" ? "途中停止 · 確定済みの記録" : "実行失敗 · 回収した記録",
      result.status === "completed" ? "Experiment completed" : result.status === "stopped" ? "Stopped · committed observations" : "Failed · recovered observations") + (result.reason ? ` · ${result.reason}` : "");
    this.#metadata.textContent = JSON.stringify(result.metadata, null, 2);
    this.root.dataset.runId = result.metadata.identity.runId; this.root.dataset.result = result.status;
    this.draw();
  }
  runtime(status: RuntimeStatus, writeLocked = false): void {
    this.#locked = writeLocked || status === "starting" || status === "executing";
    this.#fields.disabled = this.#locked;
    for (const input of this.#seriesInputs.values()) input.disabled = writeLocked;
    if (status === "executing") this.#status.textContent = this.text("実験中 · 条件は実行開始時に固定しています。", "Running · conditions are fixed for this run.");
    if (status === "stopped" && !this.#result && this.#source !== undefined) {
      this.#status.textContent = this.text("停止済み · 再起動して再実行できます。", "Stopped · restart to run again."); this.root.dataset.result = "stopped";
    }
  }
  failure(message: string): void {
    if (this.#result) return;
    this.#status.textContent = this.text("実行できません: ", "Execution unavailable: ") + message;
    this.root.dataset.result = "failed";
  }
  unavailable(reason: string): void { this.#availability.textContent = reason; }
  private makeConditions(): void {
    this.#configuration.append(element("h3", this.text("次の実験の条件", "Conditions for the next run")),
      element("p", this.text("変更は次の実行から反映します。実行中は固定です。", "Changes apply to the next run. Conditions are locked while running.")));
    this.#fields.append(element("legend", this.text("一軸アーム", "One-axis arm")));
    const fields = [
      ["targetAngleRad", "目標角度（°）", "Target angle (°)", 10, 100, 1, 180 / Math.PI],
      ["payloadMassKg", "先端のおもり（g）", "Payload (g)", 0, 600, 25, 1000],
      ["initialAngleRad", "初期角度（°）", "Initial angle (°)", 0, 100, 1, 180 / Math.PI],
      ["kpNmPerRad", "Kp（N·m/rad）", "Kp (N·m/rad)", 0.5, 3, 0.1, 1],
      ["kdNmSPerRad", "Kd（N·m·s/rad）", "Kd (N·m·s/rad)", 0, 0.15, 0.005, 1],
      ["durationMs", "実験時間（s）", "Duration (s)", 1, 10, 0.01, 0.001],
    ] as const;
    for (const [key, ja, en, min, max, step, scale] of fields) {
      const input = element("input"); input.type = "number"; input.id = `arm-${key}`; input.min = String(min); input.max = String(max); input.step = String(step); input.required = true;
      const label = element("label", this.text(ja, en)); label.htmlFor = input.id; label.append(input); this.#fields.append(label); this.#inputs.set(key, { input, scale });
      input.addEventListener("change", () => {
        if (this.#locked) return;
        try {
          if (!input.validity.valid || !input.value.trim()) throw new Error(this.text("入力範囲と刻みを確認してください。", "Check the range and step."));
          const value = key === "initialAngleRad" || key === "targetAngleRad" ? radians(input.valueAsNumber) : input.valueAsNumber / scale;
          this.applyConditions(snapshotArmControlConditions({ ...this.#conditions, [key]: key === "durationMs" ? Math.round(value) : value }));
        } catch (error) { this.#formError.textContent = String(error); input.setAttribute("aria-invalid", "true"); }
      });
    }
    const compensation = element("input"); compensation.id = "arm-gravityCompensation"; compensation.type = "checkbox";
    compensation.addEventListener("change", () => { if (!this.#locked) this.applyConditions({ ...this.#conditions, gravityCompensation: compensation.checked }); });
    const label = element("label", this.text("理想的な重力補償", "Ideal gravity compensation")); label.append(compensation); this.#fields.append(label);
    this.#inputs.set("gravityCompensation", { input: compensation, scale: 1 });
    const presets = element("div"); presets.className = "arm-presets";
    for (const [id, ja, en, changes] of [
      ["standard", "標準", "Standard", {}], ["compensated", "重力補償あり", "Compensated", { gravityCompensation: true }],
      ["low-damping", "減衰を小さく", "Low damping", { kdNmSPerRad: 0.005 }], ["heavy", "重いおもり", "Heavy load", { payloadMassKg: 0.6 }],
    ] as const) {
      const button = this.button(this.text(ja, en), () => { if (!this.#locked) this.applyConditions({ ...DEFAULT_ARM_CONTROL, ...changes }); }); button.dataset.armPreset = id; presets.append(button);
    }
    this.#formError.id = "arm-conditions-error"; this.#formError.setAttribute("role", "alert");
    this.#fields.append(presets); this.#configuration.append(this.#fields, this.#formError,
      element("p", this.text("トルク上限 ±1.20 N·m · 制御10 ms · 積分1 ms（RK4）。", "Torque limit ±1.20 N·m · control 10 ms · integration 1 ms (RK4).")));
  }
  private applyConditions(conditions: ArmControlConditions): void {
    this.#conditions = snapshotArmControlConditions(conditions); this.#formError.textContent = "";
    this.changed(this.conditions, this.series); this.updateInputs(); this.draw();
  }
  private updateInputs(): void {
    for (const [key, { input, scale }] of this.#inputs) {
      if (key === "gravityCompensation") input.checked = this.#conditions.gravityCompensation;
      else input.value = String(Number((Number(this.#conditions[key]) * scale).toFixed(8)));
      input.removeAttribute("aria-invalid");
    }
    for (const [id, input] of this.#seriesInputs) input.checked = this.#series.includes(id);
  }
  private updateStale(): void {
    const stale = this.#source !== undefined && (this.#source !== this.#contextSource || this.#projectSignature !== this.#contextProject || JSON.stringify(this.#runConditions) !== JSON.stringify(this.#conditions));
    this.#stale.textContent = stale ? this.text("変更前の実行結果です。現在のコード・条件で再実行すると更新します。", "Results precede your changes. Run the current code and conditions to update them.") : "";
  }
  private queueDraw(): void {
    if (this.#timer !== undefined || this.root.hidden) return;
    const delay = Math.max(0, (this.#motion.matches ? 250 : 50) - (performance.now() - this.#lastDraw));
    this.#timer = setTimeout(() => { this.#timer = undefined; this.draw(); }, delay);
  }
  private selectTick(tick: number): void { this.#follow = false; this.#selectedTick = tick; this.draw(); }
  private draw(): void {
    this.#lastDraw = performance.now(); this.updateStale();
    const samples = this.#recording.samples(), conditions = this.#runConditions ?? this.#conditions;
    const last = samples.at(-1);
    const sample = this.#follow ? last : samples.reduce<ArmSample | undefined>((best, point) => !best || Math.abs(point.tick - this.#selectedTick) < Math.abs(best.tick - this.#selectedTick) ? point : best, undefined);
    this.#selectedTick = sample?.tick ?? 0;
    this.root.dataset.lastTick = String(last?.tick ?? 0); this.root.dataset.viewTick = String(this.#selectedTick);
    this.#slider.max = String(last?.tick ?? 0); this.#slider.value = String(this.#selectedTick); this.#slider.disabled = !samples.length;
    this.#slider.setAttribute("aria-valuetext", `${(this.#selectedTick / 100).toFixed(2)} s`);
    this.#latest.disabled = this.#follow || !samples.length;
    this.#time.textContent = `${this.text("計算", "Computed")}: ${((last?.tick ?? 0) / 100).toFixed(2)} s · ${this.text(this.#follow ? "最新の観測" : "記録を見る", this.#follow ? "Latest observation" : "Inspecting record")}: ${(this.#selectedTick / 100).toFixed(2)} s` + (this.#lag >= 20 ? ` · ${this.text("再生の遅れ", "Playback lag")}: ${Math.round(this.#lag)} ms` : "");
    this.#values.textContent = sample ? `${degrees(sample.angle).toFixed(2)}° · ${degrees(sample.speed).toFixed(2)} °/s · ${sample.acceleration === null ? this.text("接触時の加速度は無効", "Acceleration invalid at impact") : degrees(sample.acceleration).toFixed(2) + " °/s²"}` : this.text("まだ観測はありません。", "No observations yet.");
    const angle = sample?.angle ?? conditions.initialAngleRad;
    this.#pose.setAttribute("aria-label", this.text(`記録時刻${(this.#selectedTick / 100).toFixed(2)}秒、アーム${degrees(angle).toFixed(2)}度、目標${degrees(conditions.targetAngleRad).toFixed(0)}度`, `Recorded time ${(this.#selectedTick / 100).toFixed(2)} seconds, arm ${degrees(angle).toFixed(2)} degrees, target ${degrees(conditions.targetAngleRad).toFixed(0)} degrees`));
    this.#pose.replaceChildren(svg("line", { x1: 20, x2: 300, y1: 170, y2: 170, class: "arm-axis" }),
      svg("line", { x1: 140, x2: 285, y1: 150, y2: 150, class: "arm-axis" }),
      svg("line", { x1: 140, y1: 150, x2: 140 + 125 * Math.cos(conditions.targetAngleRad), y2: 150 - 125 * Math.sin(conditions.targetAngleRad), class: "arm-target" }),
      svg("line", { x1: 140, y1: 150, x2: 140 + 125 * Math.cos(angle), y2: 150 - 125 * Math.sin(angle), class: "arm-link" }),
      svg("circle", { cx: 140, cy: 150, r: 8, class: "arm-joint" }),
      svg("circle", { cx: 140 + 125 * Math.cos(angle), cy: 150 - 125 * Math.sin(angle), r: 5 + 9 * Math.sqrt(conditions.payloadMassKg / 0.6), class: "arm-load" }),
      svg("text", { x: 8, y: 198 }, `${Math.round(conditions.payloadMassKg * 1000)} g · ${this.text("目標", "target")} ${degrees(conditions.targetAngleRad).toFixed(0)}°`),
      svg("text", { x: 273, y: 146 }, "0°"));
    const metrics = armMetrics(samples, conditions);
    this.#metrics.textContent = `${this.text("最大の行き過ぎ", "Maximum overshoot")}: ${metrics.overshoot === null ? this.text("対象外", "N/A") : degrees(metrics.overshoot).toFixed(2) + "°"} · ${this.text(this.#result ? "終了時の偏差（目標−角度）" : "最終観測の偏差（目標−角度）", this.#result ? "Final error (target−angle)" : "Latest error (target−angle)")}: ${metrics.finalError === null ? "—" : degrees(metrics.finalError).toFixed(2) + "°"} · ${this.text("飽和区間", "Saturated intervals")}: ${metrics.saturatedIntervals} · ${this.text("接触区間", "Contact intervals")}: ${metrics.contactIntervals}`;
    this.#charts.replaceChildren();
    this.plot(this.text("角度（°）", "Angle (°)"), samples, [p => degrees(p.angle)], conditions, false, degrees(conditions.targetAngleRad));
    for (const id of this.#series) {
      const names = seriesNames[id];
      const unit = id === "speed" ? "°/s" : id === "acceleration" ? "°/s²" : "N·m";
      const values: ((p: ArmSample) => number | null)[] = id === "speed" ? [p => degrees(p.speed)] : id === "acceleration" ? [p => p.acceleration === null ? null : degrees(p.acceleration)]
        : id === "torque" ? [p => p.requestedTorque, p => p.appliedTorque] : [p => p.gravity];
      this.plot(`${this.text(names[0], names[1])} (${unit})`, samples, values, conditions, id === "torque");
    }
  }
  private plot(title: string, samples: ArmSample[], values: ((p: ArmSample) => number | null)[], conditions: ArmControlConditions, intervals: boolean, target?: number): void {
    const figure = element("figure"); figure.append(element("figcaption", title));
    const chart = svg("svg", { viewBox: "0 0 320 135", role: "img", "aria-label": title, class: "arm-chart" });
    const domain = target !== undefined ? 150 : Math.max(intervals ? 1.2 : 1, ...samples.flatMap(sample => values.map(value => Math.abs(value(sample) ?? 0))));
    const x = (tick: number) => 42 + tick / (conditions.durationMs / 10) * 265;
    const y = (value: number) => target !== undefined ? 108 - value / domain * 92 : 62 - value / domain * 46;
    chart.append(svg("line", { x1: 42, y1: 16, x2: 42, y2: 108, class: "arm-axis" }),
      svg("line", { x1: 42, y1: target === undefined ? 62 : 108, x2: 307, y2: target === undefined ? 62 : 108, class: "arm-axis" }));
    for (const tick of [0, conditions.durationMs / 20, conditions.durationMs / 10]) chart.append(svg("text", { x: x(tick), y: 128, "text-anchor": "middle" }, `${tick / 100}s`));
    const number = (n: number) => Math.abs(n) >= 10000 ? n.toExponential(1) : Number(n.toPrecision(3)).toString();
    chart.append(svg("text", { x: 37, y: 20, "text-anchor": "end" }, number(domain)), svg("text", { x: 37, y: 109, "text-anchor": "end" }, target === undefined ? number(-domain) : "0"));
    if (target !== undefined) chart.append(svg("line", { x1: 42, x2: 307, y1: y(target), y2: y(target), class: "arm-target" }));
    values.forEach((value, index) => chart.append(svg("path", { d: armPlotPath(samples, value, x, y, intervals), class: intervals && index === 0 ? "arm-request" : "arm-observed", fill: "none" })));
    chart.append(svg("line", { x1: x(this.#selectedTick), x2: x(this.#selectedTick), y1: 16, y2: 108, class: "arm-cursor" }));
    chart.addEventListener("click", event => { const box = chart.getBoundingClientRect(); this.selectTick(Math.round(Math.max(0, Math.min(1, ((event.clientX - box.left) / box.width * 320 - 42) / 265)) * conditions.durationMs / 10)); });
    figure.append(chart); this.#charts.append(figure);
  }
  private button(text: string, action: () => void): HTMLButtonElement { const button = element("button", text); button.type = "button"; button.className = "quiet"; button.addEventListener("click", action); return button; }
}
