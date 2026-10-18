import { categoryDefinitions, localized, templateDefinitions, type CategoryId, type TemplateId } from "./catalog";
import type { ExperimentSet } from "./record";
import type { SupportedLocale } from "../i18n/i18n";

interface PaneOptions {
  locale: SupportedLocale;
  list(): Promise<ExperimentSet[]>;
  create(id: TemplateId): Promise<void>;
  open(id: string): Promise<void>;
  rename(title: string): Promise<void>;
  remove(record: ExperimentSet): Promise<void>;
  section(section: ExperimentSet["view"]["section"]): void;
  configure(): void;
  backup(): Promise<void>;
  repair(): Promise<void>;
  retry(): Promise<void>;
}

/** Presentation only: browsing never changes execution, project files or the selected set. */
export class ExperimentPane {
  readonly #name = document.createElement("p");
  readonly #status = document.createElement("p");
  readonly #retry = document.createElement("button");
  readonly #note = document.createElement("p");
  readonly #body = document.createElement("div");
  #record: ExperimentSet | null = null;
  #screen: "work" | "categories" | "saved" | CategoryId = "work";
  #navigation = 0;
  #busy = false;
  #running = false;
  #readOnly = false;
  #workScroll = 0;
  readonly #scrollRoot: HTMLElement;
  constructor(readonly root: HTMLElement, readonly deviceRoot: HTMLElement, readonly options: PaneOptions) {
    root.className = "experiment-pane";
    this.#scrollRoot = root.closest<HTMLElement>(".virtual-board-panel") ?? deviceRoot;
    const actions = document.createElement("div"); actions.className = "experiment-navigation";
    actions.append(this.button(this.text("題材を選ぶ", "Choose a topic"), () => this.show("categories"), "experiment-browse"),
      this.button(this.text("保存したセット", "Saved sets"), () => this.show("saved"), "experiment-saved"),
      this.button(this.text("作業へ戻る", "Back to work"), () => this.show("work"), "experiment-return"),
      this.button(this.text("データを退避", "Download recovery data"), () => this.action(this.options.backup), "experiment-emergency-backup"));
    this.#name.id = "experiment-set-name";
    this.#status.id = "experiment-set-status"; this.#status.setAttribute("aria-live", "polite");
    this.#note.id = "experiment-switch-note";
    this.#retry.id = "experiment-retry-save"; this.#retry.type = "button"; this.#retry.className = "quiet"; this.#retry.hidden = true;
    this.#retry.textContent = this.text("保存を再試行", "Retry saving");
    this.#retry.addEventListener("click", () => this.action(this.options.retry));
    root.append(this.#name, actions, this.#status, this.#retry, this.#note, this.#body);
    this.renderWork();
  }
  text(ja: string, en: string): string { return this.options.locale === "ja" ? ja : en; }
  update(record: ExperimentSet | null, readOnly = false): void {
    const changed = record?.id !== this.#record?.id || readOnly !== this.#readOnly;
    this.#record = record; this.#readOnly = readOnly;
    this.#name.textContent = record?.title ?? this.text("このページの作業", "Work on this page");
    if (changed && this.#screen === "work") this.renderWork();
    this.setBusy(this.#busy);
  }
  status(message: string, error = false): void {
    this.#status.textContent = message; this.#status.dataset.state = error ? "error" : "saved";
    this.#retry.hidden = !error;
  }
  execution(running: boolean): void {
    if (running !== this.#running) {
      for (const create of this.#body.querySelectorAll<HTMLButtonElement>("[data-create-experiment]")) {
        create.textContent = running ? this.text("保存して切り替える（実行は停止）", "Save and switch (stops running code)")
          : this.text("新しい実験セットを作る", "Create experiment set");
      }
    }
    this.#running = running;
    this.#note.textContent = running ? this.text("セットを開くと現在の実行を停止します。閲覧だけなら続行します。", "Opening a set stops the current run. Browsing keeps it running.") : "";
  }
  setBusy(busy: boolean): void {
    this.#busy = busy;
    this.#retry.disabled = busy || this.#readOnly || !this.#record;
    for (const button of this.#body.querySelectorAll<HTMLButtonElement>("[data-experiment-write]")) button.disabled = busy || this.#readOnly;
  }
  show(screen: "work" | "categories" | "saved" | CategoryId): void {
    if (this.#screen === "work") this.#workScroll = this.#scrollRoot.scrollTop;
    this.#screen = screen;
    if (screen !== "work") this.#scrollRoot.scrollTop = 0;
    const navigation = ++this.#navigation;
    this.deviceRoot.hidden = screen !== "work" || (this.#record?.view.section ?? "experience") !== "experience";
    this.#body.replaceChildren();
    if (screen === "work") { this.renderWork(); this.#scrollRoot.scrollTop = this.#workScroll; }
    else if (screen === "categories") {
      for (const category of categoryDefinitions) {
        const count = templateDefinitions.filter(entry => entry.categories.includes(category.id)).length;
        const card = document.createElement("article"); card.className = "experiment-card";
        const button = this.button(localized(category.title, this.options.locale), () => this.show(category.id));
        button.dataset.experimentCategory = category.id;
        card.append(button, this.paragraph(localized(category.description, this.options.locale)),
          this.paragraph(count ? `${count} ${this.text("題材", "topics")}` : this.text("準備中", "In preparation")));
        this.#body.append(card);
      }
    } else {
      this.#body.append(this.paragraph(this.text("読み込み中…", "Loading…")));
      void this.options.list().then(records => {
        if (navigation !== this.#navigation) return;
        this.#body.replaceChildren();
        if (screen === "saved") this.renderSaved(records);
        else this.renderTemplates(screen, records);
        this.setBusy(this.#busy);
      }).catch(error => {
        if (navigation !== this.#navigation) return;
        this.#body.replaceChildren(this.paragraph(String(error)));
        this.#body.append(this.button(this.text("データを退避", "Download recovery data"), () => this.action(this.options.backup)));
      });
    }
  }
  private renderWork(): void {
    if (this.#screen !== "work") return;
    const section = this.#record?.view.section ?? "experience";
    this.deviceRoot.hidden = section !== "experience";
    this.#body.replaceChildren();
    const tabs = document.createElement("div"); tabs.className = "experiment-view-tabs";
    for (const [id, ja, en] of [["experience", "体験", "Experience"], ["configuration", "構成", "Setup"], ["explanation", "解説", "Explanation"]] as const) {
      const button = this.button(this.text(ja, en), () => {
        this.options.section(id);
        if (this.#record) this.#record = { ...this.#record, view: { ...this.#record.view, section: id } };
        this.renderWork();
      });
      button.dataset.experimentView = id; button.setAttribute("aria-pressed", String(id === section)); tabs.append(button);
    }
    this.#body.append(tabs);
    if (this.#readOnly && this.#record?.environment.kind === "unavailable") {
      this.#body.append(this.button(this.text("既定の配線で復旧", "Recover with default wiring"), () => this.action(this.options.repair), "experiment-repair-wiring"));
    }
    if (section === "configuration") {
      this.#body.append(this.paragraph(this.text("適用中の配線と、編集中の候補は分けて保存します。", "Applied wiring and pending edits are saved separately.")),
        this.button(this.text("構成・配線を編集", "Edit devices and wiring"), this.options.configure));
    } else if (section === "explanation") {
      const origin = this.#record?.origin;
      const lesson = origin?.kind === "template" && origin.version === "1.0.0"
        ? templateDefinitions.find(entry => entry.id === origin.id)?.lesson : undefined;
      this.#body.append(this.paragraph(lesson ? localized(lesson, this.options.locale)
        : this.text("編集したバッファを実行し、importやopenは保存済みファイルを読みます。開くだけではコードを実行しません。", "Run executes the editor buffer; import and open read saved files. Opening a set does not execute code.")));
    }
    const details = document.createElement("details"); details.className = "experiment-management";
    const summary = document.createElement("summary"); summary.textContent = this.text("セット名・退避", "Name and backup");
    const form = document.createElement("form");
    const input = document.createElement("input"); input.maxLength = 120; input.value = this.#record?.title ?? "";
    input.setAttribute("aria-label", this.text("実験セット名", "Experiment set name"));
    const save = this.button(this.text("名前を保存", "Save name"), () => this.action(() => this.options.rename(input.value))); save.dataset.experimentWrite = "";
    form.addEventListener("submit", event => { event.preventDefault(); this.action(() => this.options.rename(input.value)); });
    form.append(input, save);
    details.append(summary, form, this.button(this.text("データを退避", "Download recovery data"), () => this.action(this.options.backup), "experiment-recovery-download"));
    this.#body.append(details); this.setBusy(this.#busy);
  }
  private renderSaved(records: ExperimentSet[]): void {
    if (!records.length) this.#body.append(this.paragraph(this.text("保存したセットはありません。", "No saved sets.")));
    for (const record of records) {
      const card = document.createElement("article"); card.className = "experiment-card"; card.dataset.savedExperiment = record.id;
      const title = document.createElement("h3"); title.textContent = record.title;
      const open = this.button(this.text("開く", "Open"), () => this.action(() => this.options.open(record.id))); open.dataset.experimentWrite = "";
      const remove = this.button(this.text("削除", "Delete"), () => this.action(async () => { await this.options.remove(record); this.show("saved"); }));
      if (record.id === this.#record?.id) { open.textContent = this.text("使用中", "Current"); delete open.dataset.experimentWrite; open.disabled = true; remove.disabled = true; }
      else remove.dataset.experimentWrite = "";
      card.append(title, this.paragraph(new Date(record.savedAt).toLocaleString(this.options.locale)), open, remove); this.#body.append(card);
    }
  }
  private renderTemplates(category: CategoryId, records: ExperimentSet[]): void {
    const templates = templateDefinitions.filter(entry => entry.categories.includes(category));
    if (!templates.length) this.#body.append(this.paragraph(this.text("この分野の実験は準備中です。", "Experiments in this category are in preparation.")));
    for (const template of templates) {
      const card = document.createElement("article"); card.className = "experiment-card"; card.dataset.experimentTemplate = template.id;
      const title = document.createElement("h3"); title.textContent = localized(template.title, this.options.locale);
      card.append(title, this.paragraph(localized(template.description, this.options.locale)));
      const copies = records.filter(record => record.origin.kind === "template" && record.origin.id === template.id);
      if (copies[0]) {
        const open = this.button(this.text("保存したセットを開く", "Open saved set"), () => this.action(() => this.options.open(copies[0]!.id)));
        open.dataset.experimentWrite = ""; card.append(open);
      }
      const create = this.button(this.#running ? this.text("保存して切り替える（実行は停止）", "Save and switch (stops running code)")
        : this.text(copies.length ? "新しく作る" : "新しい実験セットを作る", copies.length ? "Create another" : "Create experiment set"), () => this.action(() => this.options.create(template.id)));
      create.dataset.experimentWrite = ""; create.dataset.createExperiment = template.id; card.append(create); this.#body.append(card);
    }
  }
  private action(action: () => Promise<void>): void {
    void action().catch(error => this.status(error instanceof Error ? error.message : String(error), true));
  }
  private button(label: string, action: () => void, id?: string): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.className = "quiet"; button.textContent = label;
    if (id) button.id = id; button.addEventListener("click", action); return button;
  }
  private paragraph(text: string): HTMLParagraphElement { const p = document.createElement("p"); p.textContent = text; return p; }
}
